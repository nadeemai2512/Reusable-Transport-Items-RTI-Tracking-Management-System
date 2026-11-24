'use strict';
/* Backend tests: unit (penalty engine) + integration (real CAP server, in-memory SQLite, mocked auth). */
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const cds = require('@sap/cds');
const { computePenalty, addDays } = require('../srv/lib/penalty');

/* ---------- UNIT TESTS ---------- */
const POL = [
  { fromDay: 1, toDay: 15, rate: 50, effectiveFrom: '2020-01-01' },
  { fromDay: 16, toDay: 30, rate: 100, effectiveFrom: '2020-01-01' }
];
const D = { quantity: 10, graceEndDate: '2026-01-31', customer_ID: 'c', assetType_ID: 'a' };
const calc = (asOf, returns = [], policies = POL) =>
  computePenalty({ dispatch: D, returns, policies, replacementValue: 1000, presumedLostDays: 30, asOf });

test('unit: no penalty on or before grace end', () => {
  assert.equal(calc('2026-01-31').accruedDemurrage, 0);
  assert.equal(calc('2026-01-31').daysOverdue, 0);
});
test('unit: slab boundary day 1, 15, 16, 30', () => {
  assert.equal(calc('2026-02-01').accruedDemurrage, 10 * 50);                       // day 1
  assert.equal(calc(addDays('2026-01-31', 15)).accruedDemurrage, 10 * 50 * 15);     // day 15
  assert.equal(calc(addDays('2026-01-31', 16)).accruedDemurrage, 10 * 50 * 15 + 10 * 100); // day 16
  assert.equal(calc(addDays('2026-01-31', 30)).accruedDemurrage, 10 * 50 * 15 + 10 * 100 * 15); // day 30
  assert.equal(calc(addDays('2026-01-31', 30)).replacementCharge, 0);
});
test('unit: day 31 => presumed lost with full replacement charge, demurrage capped', () => {
  const r = calc(addDays('2026-01-31', 31));
  assert.equal(r.isPresumedLost, true);
  assert.equal(r.replacementCharge, 10 * 1000);
  assert.equal(r.accruedDemurrage, 10 * 50 * 15 + 10 * 100 * 15);
  assert.equal(calc(addDays('2026-01-31', 60)).accruedDemurrage, r.accruedDemurrage); // no extra accrual
});
test('unit: partial return stops accrual from return date, no double charging', () => {
  const ret = [{ returnDate: addDays('2026-01-31', 5), quantity: 4 }];   // 4 back on overdue day 5
  const r = calc(addDays('2026-01-31', 10), ret);
  assert.equal(r.accruedDemurrage, 10 * 50 * 4 + 6 * 50 * 6);             // days1-4 x10, days5-10 x6
  assert.equal(r.outstandingNow, 6);
  assert.deepEqual(calc(addDays('2026-01-31', 10), ret), r);               // reproducible
});
test('unit: contract-specific policy takes precedence', () => {
  const pol = [...POL, { fromDay: 1, toDay: 30, rate: 5, customer_ID: 'c', effectiveFrom: '2020-01-01' }];
  assert.equal(calc('2026-02-01', [], pol).accruedDemurrage, 10 * 5);
});
test('unit: full return before presumed-lost day avoids replacement charge', () => {
  const r = calc(addDays('2026-01-31', 40), [{ returnDate: addDays('2026-01-31', 20), quantity: 10 }]);
  assert.equal(r.replacementCharge, 0);
  assert.equal(r.isPresumedLost, false);
});

/* ---------- INTEGRATION TESTS ---------- */
const { GET, POST, PATCH, DELETE, axios } = cds.test(path.join(__dirname, '..'));
const as = u => ({ auth: { username: u, password: 'rti' } });
const BASE = '/odata/v4/rti';
const IDS = {
  euro: '11111111-0000-0000-0000-000000000001', cage: '11111111-0000-0000-0000-000000000002',
  c1: '22222222-0000-0000-0000-000000000001', wh: '33333333-0000-0000-0000-000000000001',
  seedDisp: '77777777-0000-0000-0000-000000000001'
};
const fails = async (p, status, textPart) => {
  await assert.rejects(p, e => { assert.equal(e.response.status, status, JSON.stringify(e.response.data)); if (textPart) assert.match(JSON.stringify(e.response.data), textPart); return true; });
};

test('auth: anonymous rejected, wrong role forbidden', async () => {
  await fails(axios.get(`${BASE}/Customers`), 401);
  await fails(GET(`${BASE}/AuditLogs`, as('alice')), 403);
  await fails(POST(`${BASE}/Customers`, { code: 'X', name: 'X' }, as('alice')), 403);
  await fails(POST(`${BASE}/runPenaltyEngine`, {}, as('bob')), 403);
});
test('read seeded master data from real DB', async () => {
  const { data } = await GET(`${BASE}/Customers?$orderby=code`, as('alice'));
  assert.equal(data.value.length, 3);
  const st = await GET(`${BASE}/StockBalances?$select=netAvailable,totalOwned,atCustomer`, as('alice'));
  assert.ok(st.data.value.some(s => s.netAvailable === 400));   // 500 - 100 at customer
});
test('CRUD: create / update / delete customer persists', async () => {
  const c = await POST(`${BASE}/Customers`, { code: 'T-1', name: 'Temp Co', city: 'Pune' }, as('dave'));
  assert.equal(c.status, 201);
  await PATCH(`${BASE}/Customers(${c.data.ID})`, { city: 'Delhi' }, as('dave'));
  assert.equal((await GET(`${BASE}/Customers(${c.data.ID})`, as('dave'))).data.city, 'Delhi');
  await fails(POST(`${BASE}/Customers`, { code: 'T-1', name: 'Dup' }, as('dave')), 409, /already exists/);   // unique code
  await DELETE(`${BASE}/Customers(${c.data.ID})`, as('dave'));
  await fails(GET(`${BASE}/Customers(${c.data.ID})`, as('dave')), 404);
});
test('bulk dispatch: stock check, ledger, stock update', async () => {
  const body = { customer_ID: IDS.c1, warehouse_ID: IDS.wh, assetType_ID: IDS.euro, quantity: 50, dispatchDate: addDays(new Date().toISOString().slice(0, 10), -2), deliveryNo: '80009999' };
  await fails(POST(`${BASE}/dispatchAssets`, { ...body, quantity: 9999 }, as('alice')), 409, /Insufficient stock/);
  await fails(POST(`${BASE}/dispatchAssets`, { ...body, quantity: 0 }, as('alice')), 400);
  const r = await POST(`${BASE}/dispatchAssets`, body, as('alice'));
  assert.equal(r.data.status, 'OPEN');
  assert.match(r.data.dispatchNo, /^DSP-/);
  const st = await GET(`${BASE}/StockBalances?$filter=assetType_ID eq ${IDS.euro}`, as('alice'));
  assert.equal(st.data.value[0].atCustomer, 150);
  const led = await GET(`${BASE}/MovementLedger?$filter=reference eq '${r.data.dispatchNo}'`, as('alice'));
  assert.equal(led.data.value.length, 1);
});
let cageDispatch;
test('serialized dispatch: duplicate dispatch prevented, invalid serial rejected', async () => {
  const body = { customer_ID: IDS.c1, warehouse_ID: IDS.wh, assetType_ID: IDS.cage, quantity: 1, serialNo: 'CAGE-0001', graceDays: 5 };
  await fails(POST(`${BASE}/dispatchAssets`, { ...body, serialNo: 'NOPE' }, as('alice')), 404);
  await fails(POST(`${BASE}/dispatchAssets`, { ...body, serialNo: undefined }, as('alice')), 400);
  cageDispatch = (await POST(`${BASE}/dispatchAssets`, body, as('alice'))).data;
  await fails(POST(`${BASE}/dispatchAssets`, body, as('alice')), 409, /cannot be dispatched/);
  const a = await GET(`${BASE}/Assets?$filter=serialNo eq 'CAGE-0001'`, as('alice'));
  assert.equal(a.data.value[0].status, 'AT_CUSTOMER');
});
test('serialized return: wrong asset, duplicate scan, scrap -> WRITTEN_OFF', async () => {
  const ret = { dispatch_ID: cageDispatch.ID, quantity: 1, condition: 'SCRAP', serialNo: 'CAGE-0001' };
  await fails(POST(`${BASE}/registerReturn`, { ...ret, serialNo: 'CAGE-0002' }, as('alice')), 400, /does not match/);
  await POST(`${BASE}/registerReturn`, ret, as('alice'));
  await fails(POST(`${BASE}/registerReturn`, ret, as('alice')), 409);        // closed / exceeds outstanding
  const a = await GET(`${BASE}/Assets?$filter=serialNo eq 'CAGE-0001'`, as('alice'));
  assert.equal(a.data.value[0].status, 'WRITTEN_OFF');
  const st = await GET(`${BASE}/StockBalances?$filter=assetType_ID eq ${IDS.cage}`, as('alice'));
  assert.equal(st.data.value[0].scrapped, 1);
  assert.equal(st.data.value[0].netAvailable, 2);
});
test('partial return: cannot exceed outstanding, damage classification updates stock', async () => {
  const D = (await GET(`${BASE}/Dispatches(${IDS.seedDisp})`, as('alice'))).data;
  assert.equal(D.outstanding, 100);
  await fails(POST(`${BASE}/registerReturn`, { dispatch_ID: IDS.seedDisp, quantity: 101, condition: 'GOOD' }, as('alice')), 409, /exceeds outstanding/);
  await POST(`${BASE}/registerReturn`, { dispatch_ID: IDS.seedDisp, quantity: 30, condition: 'GOOD' }, as('alice'));
  await POST(`${BASE}/registerReturn`, { dispatch_ID: IDS.seedDisp, quantity: 10, condition: 'MINOR_DAMAGE' }, as('alice'));
  const after = (await GET(`${BASE}/Dispatches(${IDS.seedDisp})`, as('alice'))).data;
  assert.equal(after.status, 'PARTIALLY_RETURNED');
  assert.equal(after.outstanding, 60);
  const st = (await GET(`${BASE}/StockBalances?$filter=assetType_ID eq ${IDS.euro}`, as('alice'))).data.value[0];
  assert.equal(st.damaged, 10);
});
let penaltyId;
test('penalty engine: idempotent, only on outstanding qty', async () => {
  const run = async () => (await POST(`${BASE}/runPenaltyEngine`, { asOf: '2026-11-24' }, as('dave'))).data;
  const a = await run(); const b = await run();
  assert.deepEqual(a, b);
  const p = (await GET(`${BASE}/PenaltyTransactions?$filter=dispatch_ID eq ${IDS.seedDisp}`, as('bob'))).data.value;
  assert.equal(p.length, 1);                                  // no duplicate rows after 2 runs
  assert.equal(p[0].outstandingQty, 60);
  assert.equal(p[0].overdueDays, 15);
  assert.ok(Number(p[0].accruedDemurrage) > 0);
  penaltyId = p[0].ID;
});
test('penalty engine: presumed lost after 30 overdue days', async () => {
  const r = (await POST(`${BASE}/runPenaltyEngine`, { asOf: '2027-02-01' }, as('dave'))).data;
  assert.ok(r.presumedLost >= 1);
  const d = (await GET(`${BASE}/Dispatches(${IDS.seedDisp})`, as('bob'))).data;
  assert.equal(d.status, 'PRESUMED_LOST');
  const p = (await GET(`${BASE}/PenaltyTransactions?$filter=dispatch_ID eq ${IDS.seedDisp}`, as('bob'))).data.value[0];
  assert.equal(Number(p.replacementCharge), 60 * 1200);
  const led = await GET(`${BASE}/MovementLedger?$filter=type eq 'PRESUMED_LOST' and reference eq 'DSP-00001'`, as('bob'));
  assert.equal(led.data.value.length, 1);                      // ledger entry written once
  await POST(`${BASE}/runPenaltyEngine`, { asOf: '2027-02-01' }, as('dave'));
  assert.equal((await GET(`${BASE}/MovementLedger?$filter=type eq 'PRESUMED_LOST' and reference eq 'DSP-00001'`, as('bob'))).data.value.length, 1);
});
test('waivers: validation, within threshold auto-approved, above threshold needs head', async () => {
  const p = (await GET(`${BASE}/PenaltyTransactions(${penaltyId})`, as('bob'))).data;
  const net = Number(p.netPayable);
  await fails(POST(`${BASE}/requestWaiver`, { penalty_ID: penaltyId, amount: 100, comments: 'valid text' }, as('bob')), 400, /Reason/);
  await fails(POST(`${BASE}/requestWaiver`, { penalty_ID: penaltyId, amount: net + 1, reasonCode: 'DISPUTE', comments: 'too much' }, as('bob')), 409);
  await fails(POST(`${BASE}/requestWaiver`, { penalty_ID: penaltyId, amount: 100, reasonCode: 'DISPUTE', comments: 'x' }, as('alice')), 403);
  const small = (await POST(`${BASE}/requestWaiver`, { penalty_ID: penaltyId, amount: 500, reasonCode: 'DISPUTE', comments: 'goodwill gesture' }, as('bob'))).data;
  assert.equal(small.status, 'APPROVED');
  const big = (await POST(`${BASE}/requestWaiver`, { penalty_ID: penaltyId, amount: 20000, reasonCode: 'DISPUTE', comments: 'carrier delay proven' }, as('bob'))).data;
  assert.equal(big.status, 'PENDING_APPROVAL');
  await fails(POST(`${BASE}/decideWaiver`, { request_ID: big.ID, approve: true }, as('bob')), 403);
  const dec = (await POST(`${BASE}/decideWaiver`, { request_ID: big.ID, approve: true, comment: 'ok' }, as('dave'))).data;
  assert.equal(dec.status, 'APPROVED');
  const after = (await GET(`${BASE}/PenaltyTransactions(${penaltyId})`, as('bob'))).data;
  assert.equal(Number(after.waivedAmount), 20500);
  assert.equal(Number(after.netPayable), net - 20500);
  await fails(POST(`${BASE}/decideWaiver`, { request_ID: big.ID, approve: true }, as('dave')), 409);
  // engine re-run must not erase the waiver
  await POST(`${BASE}/runPenaltyEngine`, { asOf: '2027-02-01' }, as('dave'));
  assert.equal(Number((await GET(`${BASE}/PenaltyTransactions(${penaltyId})`, as('bob'))).data.waivedAmount), 20500);
});
test('replenishment: alert, request, receipt updates stock', async () => {
  const sb = (await GET(`${BASE}/StockBalances?$filter=assetType_ID eq ${IDS.cage}`, as('carol'))).data.value[0];
  await PATCH(`${BASE}/StockBalances(${sb.ID})`, { safetyStock: 5 }, as('carol'));   // net 2 < 5 => alert
  const alerts = (await GET(`${BASE}/ReplenishmentAlerts`, as('carol'))).data.value;
  assert.ok(alerts.length >= 1);
  const a = alerts[0];
  await fails(POST(`${BASE}/createReplenishmentRequest`, { assetType_ID: a.assetType_ID, warehouse_ID: a.warehouse_ID, quantity: 0 }, as('carol')), 400);
  const req = (await POST(`${BASE}/createReplenishmentRequest`, { assetType_ID: a.assetType_ID, warehouse_ID: a.warehouse_ID, quantity: 500 }, as('carol'))).data;
  const rec = (await POST(`${BASE}/receiveReplenishment`, { request_ID: req.ID }, as('carol'))).data;
  assert.equal(rec.status, 'RECEIVED');
  await fails(POST(`${BASE}/receiveReplenishment`, { request_ID: req.ID }, as('carol')), 409);
  const left = (await GET(`${BASE}/ReplenishmentAlerts?$filter=ID eq ${a.ID}`, as('carol'))).data.value;
  assert.equal(left.length, 0);
});
test('dashboard + me + audit log', async () => {
  const d = (await GET(`${BASE}/getDashboard()`, as('admin'))).data;
  assert.ok(d.totalOwned > 0 && Array.isArray(d.statusDist) && d.statusDist.length > 0);
  assert.ok(d.totalPenalty > 0);
  const op = (await GET(`${BASE}/getDashboard()`, as('alice'))).data;
  assert.equal(op.totalPenalty, null);                          // operators do not see money
  const me = (await GET(`${BASE}/me()`, as('bob'))).data;
  assert.deepEqual(me.roles, ['LogisticsManager']);
  const logs = (await GET(`${BASE}/AuditLogs?$orderby=createdAt desc`, as('dave'))).data.value;
  const actions = new Set(logs.map(l => l.action));
  for (const a of ['DISPATCH', 'RETURN', 'WAIVER_REQUEST', 'WAIVER_APPROVED', 'PRESUMED_LOST', 'PENALTY_ENGINE_RUN']) assert.ok(actions.has(a), a);
});
