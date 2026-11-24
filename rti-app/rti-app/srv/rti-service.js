'use strict';
const cds = require('@sap/cds');
const { computePenalty, addDays, diffDays, today } = require('./lib/penalty');

const ROLES = ['WarehouseOperator', 'LogisticsManager', 'InventoryPlanner', 'LogisticsHead', 'Admin'];
const CONDITIONS = ['GOOD', 'MINOR_DAMAGE', 'SCRAP'];
const num = v => Number(v || 0);

module.exports = class RtiService extends cds.ApplicationService {
  init() {
    const E = cds.entities('rti');
    const { SELECT, INSERT, UPDATE } = cds.ql;

    /* ------------ helpers ------------ */
    const setting = async (code, dflt) => {
      const r = await SELECT.one.from(E.Settings).where({ code });
      return r ? Number(r.value) : dflt;
    };
    const audit = (req, action, entityType, entityId, oldValue, newValue, comments) =>
      INSERT.into(E.AuditLogs).entries({
        userId: req.user.id, action, entityType, entityId: String(entityId || ''),
        oldValue: oldValue ? JSON.stringify(oldValue).slice(0, 1000) : null,
        newValue: newValue ? JSON.stringify(newValue).slice(0, 1000) : null, comments
      });
    const nextNo = async (prefix, entity) => {
      const r = await SELECT.one.from(entity).columns('count(*) as n');
      return `${prefix}-${String(num(r.n) + 1).padStart(5, '0')}`;
    };
    const ledger = (type, d) => INSERT.into(E.MovementLedger).entries({ movementDate: new Date().toISOString(), type, ...d });
    const getStock = async (assetType_ID, warehouse_ID) => {
      let s = await SELECT.one.from(E.StockBalances).where({ assetType_ID, warehouse_ID });
      if (!s) {
        await INSERT.into(E.StockBalances).entries({ assetType_ID, warehouse_ID, totalOwned: 0, atCustomer: 0, damaged: 0, scrapped: 0, safetyStock: 0 });
        s = await SELECT.one.from(E.StockBalances).where({ assetType_ID, warehouse_ID });
      }
      return s;
    };
    const must = async (entity, ID, name, req) => {
      const r = ID && await SELECT.one.from(entity).where({ ID });
      if (!r) req.reject(404, `${name} not found`);
      return r;
    };
    const validDate = (v, name, req) => {
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) req.reject(400, `${name} must be YYYY-MM-DD`);
      return v;
    };
    const findAsset = async serialNo => SELECT.one.from(E.Assets).where`serialNo = ${serialNo} or qrCode = ${serialNo} or barcode = ${serialNo}`;

    /* Recalculate and upsert the penalty transaction of one dispatch (keeps waived amounts). */
    const recalcPenalty = async (dispatch, asOf, presumedLostDays, policies) => {
      const returns = await SELECT.from(E.Returns).columns('returnDate', 'quantity').where({ dispatch_ID: dispatch.ID });
      const type = await SELECT.one.from(E.AssetTypes).where({ ID: dispatch.assetType_ID });
      const calc = computePenalty({ dispatch, returns, policies, replacementValue: type?.replacementValue, presumedLostDays, asOf });
      const existing = await SELECT.one.from(E.PenaltyTransactions).where({ dispatch_ID: dispatch.ID });
      if (!existing && calc.daysOverdue === 0) return { calc, txn: null };
      const waived = num(existing?.waivedAmount);
      const gross = calc.accruedDemurrage + calc.replacementCharge;
      const row = {
        dispatch_ID: dispatch.ID, customer_ID: dispatch.customer_ID, assetType_ID: dispatch.assetType_ID,
        outstandingQty: calc.outstandingNow, overdueDays: calc.daysOverdue,
        accruedDemurrage: calc.accruedDemurrage, replacementCharge: calc.replacementCharge,
        waivedAmount: waived, netPayable: Math.max(0, Math.round((gross - waived) * 100) / 100),
        currency: 'INR', calculatedOn: asOf,
        status: calc.isPresumedLost ? 'PRESUMED_LOST' : calc.outstandingNow === 0 ? 'CLOSED' : 'ACCRUING'
      };
      if (existing) await UPDATE(E.PenaltyTransactions).set(row).where({ ID: existing.ID });
      else await INSERT.into(E.PenaltyTransactions).entries(row);
      return { calc, txn: row };
    };

    /* ------------ validation on master data / stock ------------ */
    /* friendly business-key uniqueness errors instead of raw DB constraint failures */
    const uniq = (entity, field, label) => this.before(['CREATE', 'UPDATE'], entity, async req => {
      const v = req.data[field];
      if (v == null) return;
      const id = req.data.ID || req.params?.[0]?.ID || req.params?.[0];
      const dup = await SELECT.one.from(E[entity]).where({ [field]: v });
      if (dup && dup.ID !== id) req.reject(409, `${label} '${v}' already exists`);
    });
    uniq('Customers', 'code', 'Customer code'); uniq('AssetTypes', 'code', 'Asset type code');
    uniq('Warehouses', 'code', 'Warehouse code'); uniq('Assets', 'serialNo', 'Serial number');
    this.before(['CREATE', 'UPDATE'], 'StockBalances', req => {
      for (const f of ['totalOwned', 'atCustomer', 'damaged', 'scrapped', 'safetyStock'])
        if (req.data[f] != null && (!Number.isInteger(req.data[f]) || req.data[f] < 0)) req.reject(400, `${f} must be a non-negative integer`);
    });
    this.before(['CREATE', 'UPDATE'], 'Assets', async req => {
      const allowed = ['AVAILABLE', 'IN_TRANSIT', 'AT_CUSTOMER', 'RETURNED_INSPECTION', 'DAMAGED', 'WRITTEN_OFF', 'PRESUMED_LOST', 'UNDER_REPAIR'];
      if (req.data.status && !allowed.includes(req.data.status)) req.reject(400, `Invalid status ${req.data.status}`);
    });
    this.after(['CREATE', 'UPDATE', 'DELETE'], ['Assets', 'AssetTypes', 'Customers', 'Warehouses', 'StockBalances', 'PenaltyPolicies', 'Settings'],
      (res, req) => audit(req, req.event, req.target.name.replace('RtiService.', ''), res?.ID || req.data?.ID || req.params?.[0]?.ID || req.params?.[0], null, req.event === 'DELETE' ? null : req.data));

    /* ------------ me / dashboard ------------ */
    this.on('me', req => ({ id: req.user.id, roles: ROLES.filter(r => req.user.is(r)) }));

    /* ------------ dispatch ------------ */
    this.on('dispatchAssets', async req => {
      const d = req.data;
      const customer = await must(E.Customers, d.customer_ID, 'Customer', req);
      const wh = await must(E.Warehouses, d.warehouse_ID, 'Warehouse', req);
      const type = await must(E.AssetTypes, d.assetType_ID, 'Asset type', req);
      if (!customer.active) req.reject(400, 'Customer is inactive');
      if (!Number.isInteger(d.quantity) || d.quantity <= 0) req.reject(400, 'Quantity must be a positive whole number');
      const dispatchDate = validDate(d.dispatchDate, 'Dispatch date', req) || today();
      if (dispatchDate > today()) req.reject(400, 'Dispatch date cannot be in the future');
      validDate(d.expectedReturnDate, 'Expected return date', req);

      let asset = null;
      if (type.serialized) {
        if (!d.serialNo) req.reject(400, `${type.name} is serialized - scan or enter the asset serial number`);
        if (d.quantity !== 1) req.reject(400, 'Serialized assets are dispatched one at a time (quantity 1)');
        asset = await findAsset(d.serialNo);
        if (!asset) req.reject(404, `Asset ${d.serialNo} not found`);
        if (asset.assetType_ID !== type.ID) req.reject(400, `Asset ${d.serialNo} is not of type ${type.name}`);
        if (asset.status !== 'AVAILABLE') req.reject(409, `Asset ${asset.serialNo} cannot be dispatched - current status is ${asset.status}`);
        if (asset.currentWarehouse_ID && asset.currentWarehouse_ID !== wh.ID) req.reject(400, `Asset ${asset.serialNo} is not stored in warehouse ${wh.code}`);
      }
      const stock = await getStock(type.ID, wh.ID);
      const net = num(stock.totalOwned) - num(stock.atCustomer) - num(stock.damaged) - num(stock.scrapped);
      if (d.quantity > net) req.reject(409, `Insufficient stock: ${net} available in ${wh.code}, ${d.quantity} requested`);

      const graceDays = d.graceDays ?? customer.defaultGraceDays ?? type.defaultGraceDays ?? 30;
      if (!Number.isInteger(graceDays) || graceDays < 0) req.reject(400, 'Grace days must be zero or more');
      const graceEndDate = addDays(dispatchDate, graceDays);
      const dispatchNo = await nextNo('DSP', E.Dispatches);
      const ID = cds.utils.uuid();
      await INSERT.into(E.Dispatches).entries({
        ID, dispatchNo, dispatchDate, customer_ID: customer.ID, warehouse_ID: wh.ID, assetType_ID: type.ID, asset_ID: asset?.ID,
        quantity: d.quantity, returnedQuantity: 0, graceDays, graceEndDate, expectedReturnDate: d.expectedReturnDate || graceEndDate,
        carrier: d.carrier, deliveryNo: d.deliveryNo, shipmentNo: d.shipmentNo, status: 'OPEN', remarks: d.remarks
      });
      await UPDATE(E.StockBalances).set({ atCustomer: num(stock.atCustomer) + d.quantity }).where({ ID: stock.ID });
      if (asset) await UPDATE(E.Assets).set({ status: 'AT_CUSTOMER', currentCustomer_ID: customer.ID, currentWarehouse_ID: null }).where({ ID: asset.ID });
      await ledger('DISPATCH', { assetType_ID: type.ID, warehouse_ID: wh.ID, customer_ID: customer.ID, asset_ID: asset?.ID, quantity: d.quantity, reference: dispatchNo });
      await audit(req, 'DISPATCH', 'Dispatches', ID, null, { dispatchNo, qty: d.quantity, customer: customer.code }, d.remarks);
      return SELECT.one.from(E.Dispatches).where({ ID });
    });

    /* ------------ return ------------ */
    this.on('registerReturn', async req => {
      const d = req.data;
      const disp = await must(E.Dispatches, d.dispatch_ID, 'Dispatch', req);
      const outstanding = num(disp.quantity) - num(disp.returnedQuantity);
      if (!Number.isInteger(d.quantity) || d.quantity <= 0) req.reject(400, 'Returned quantity must be a positive whole number');
      if (d.quantity > outstanding) req.reject(409, `Returned quantity ${d.quantity} exceeds outstanding balance ${outstanding} of ${disp.dispatchNo}`);
      if (!CONDITIONS.includes(d.condition)) req.reject(400, `Condition must be one of ${CONDITIONS.join(', ')}`);
      const returnDate = validDate(d.returnDate, 'Return date', req) || today();
      if (returnDate > today()) req.reject(400, 'Return date cannot be in the future');
      if (returnDate < disp.dispatchDate) req.reject(400, 'Return date cannot be before the dispatch date');

      let asset = null;
      if (disp.asset_ID) {
        if (!d.serialNo) req.reject(400, 'Serialized dispatch - scan or enter the asset serial number');
        asset = await findAsset(d.serialNo);
        if (!asset || asset.ID !== disp.asset_ID) req.reject(400, `Asset ${d.serialNo} does not match dispatch ${disp.dispatchNo}`);
        if (!['AT_CUSTOMER', 'PRESUMED_LOST'].includes(asset.status)) req.reject(409, `Duplicate/invalid return: asset ${asset.serialNo} status is ${asset.status}`);
        if (d.quantity !== 1) req.reject(400, 'Serialized return quantity must be 1');
      }
      const stock = await getStock(disp.assetType_ID, disp.warehouse_ID);
      const patch = { atCustomer: Math.max(0, num(stock.atCustomer) - d.quantity) };
      let ledgerType = 'RETURN_GOOD', assetStatus = 'AVAILABLE';
      if (d.condition === 'MINOR_DAMAGE') { patch.damaged = num(stock.damaged) + d.quantity; ledgerType = 'RETURN_DAMAGED'; assetStatus = 'DAMAGED'; }
      if (d.condition === 'SCRAP') { patch.scrapped = num(stock.scrapped) + d.quantity; ledgerType = 'RETURN_SCRAP'; assetStatus = 'WRITTEN_OFF'; }

      const returnNo = await nextNo('RET', E.Returns);
      const ID = cds.utils.uuid();
      await INSERT.into(E.Returns).entries({
        ID, returnNo, returnDate, dispatch_ID: disp.ID, customer_ID: disp.customer_ID, assetType_ID: disp.assetType_ID, asset_ID: asset?.ID,
        quantity: d.quantity, condition: d.condition, inspectionDate: returnDate, remarks: d.remarks
      });
      const newReturned = num(disp.returnedQuantity) + d.quantity;
      await UPDATE(E.Dispatches).set({
        returnedQuantity: newReturned,
        status: newReturned >= num(disp.quantity) ? 'CLOSED' : (disp.status === 'PRESUMED_LOST' ? 'PRESUMED_LOST' : 'PARTIALLY_RETURNED')
      }).where({ ID: disp.ID });
      await UPDATE(E.StockBalances).set(patch).where({ ID: stock.ID });
      if (asset) await UPDATE(E.Assets).set({
        status: assetStatus, currentCustomer_ID: null, currentWarehouse_ID: assetStatus === 'WRITTEN_OFF' ? null : disp.warehouse_ID
      }).where({ ID: asset.ID });
      await ledger(ledgerType, { assetType_ID: disp.assetType_ID, warehouse_ID: disp.warehouse_ID, customer_ID: disp.customer_ID, asset_ID: asset?.ID, quantity: d.quantity, reference: returnNo });
      // partial/full return: recompute penalty so accrual stops from the return date (no duplicate charges)
      const updated = await SELECT.one.from(E.Dispatches).where({ ID: disp.ID });
      const policies = await SELECT.from(E.PenaltyPolicies);
      await recalcPenalty(updated, today(), await setting('PRESUMED_LOST_DAYS', 30), policies);
      await audit(req, 'RETURN', 'Returns', ID, null, { returnNo, qty: d.quantity, condition: d.condition, dispatch: disp.dispatchNo }, d.remarks);
      return SELECT.one.from(E.Returns).where({ ID });
    });

    /* ------------ penalty engine (idempotent, safe to run repeatedly) ------------ */
    this.on('runPenaltyEngine', async req => {
      const asOf = validDate(req.data.asOf, 'asOf', req) || today();
      const pld = await setting('PRESUMED_LOST_DAYS', 30);
      const policies = await SELECT.from(E.PenaltyPolicies);
      const open = await SELECT.from(E.Dispatches).where`status != 'CLOSED'`;
      let processed = 0, presumedLost = 0, total = 0;
      for (const disp of open) {
        const { calc, txn } = await recalcPenalty(disp, asOf, pld, policies);
        if (!txn) continue;
        processed++; total += txn.accruedDemurrage + txn.replacementCharge;
        if (calc.isPresumedLost) {
          presumedLost++;
          if (disp.status !== 'PRESUMED_LOST') {
            await UPDATE(E.Dispatches).set({ status: 'PRESUMED_LOST' }).where({ ID: disp.ID });
            if (disp.asset_ID) await UPDATE(E.Assets).set({ status: 'PRESUMED_LOST' }).where({ ID: disp.asset_ID });
            const done = await SELECT.one.from(E.MovementLedger).where({ type: 'PRESUMED_LOST', reference: disp.dispatchNo });
            if (!done) await ledger('PRESUMED_LOST', { assetType_ID: disp.assetType_ID, warehouse_ID: disp.warehouse_ID, customer_ID: disp.customer_ID, asset_ID: disp.asset_ID, quantity: calc.presumedLostQty, reference: disp.dispatchNo });
            await audit(req, 'PRESUMED_LOST', 'Dispatches', disp.ID, { status: disp.status }, { status: 'PRESUMED_LOST' }, `Overdue ${calc.daysOverdue} days`);
          }
        }
      }
      await audit(req, 'PENALTY_ENGINE_RUN', 'PenaltyTransactions', asOf, null, { processed, presumedLost, total }, 'Manual/scheduled run');
      return { processed, presumedLost, totalAccrued: Math.round(total * 100) / 100, asOf };
    });

    /* ------------ waivers ------------ */
    const applyWaiver = async (penalty, amount) => {
      const waived = num(penalty.waivedAmount) + amount;
      const net = Math.max(0, num(penalty.accruedDemurrage) + num(penalty.replacementCharge) - waived);
      await UPDATE(E.PenaltyTransactions).set({ waivedAmount: waived, netPayable: net }).where({ ID: penalty.ID });
      return net;
    };
    this.on('requestWaiver', async req => {
      const d = req.data;
      const p = await must(E.PenaltyTransactions, d.penalty_ID, 'Penalty', req);
      if (!d.reasonCode) req.reject(400, 'Reason code is mandatory');
      if (!d.comments || d.comments.trim().length < 5) req.reject(400, 'Please provide an explanation (min 5 characters)');
      const amount = num(d.amount);
      if (!(amount > 0)) req.reject(400, 'Waiver amount must be greater than zero');
      const pending = await SELECT.from(E.PenaltyWaiverRequests).where({ penalty_ID: p.ID, status: 'PENDING_APPROVAL' });
      const available = num(p.netPayable) - pending.reduce((s, r) => s + num(r.requestedAmount), 0);
      if (amount > available + 0.001) req.reject(409, `Waiver ${amount} exceeds the waivable balance ${available.toFixed(2)}`);
      const threshold = await setting('WAIVER_THRESHOLD', 10000);
      const gross = num(p.accruedDemurrage) + num(p.replacementCharge);
      const auto = amount <= threshold;
      const ID = cds.utils.uuid();
      let remaining = num(p.netPayable);
      if (auto) remaining = await applyWaiver(p, amount);
      await INSERT.into(E.PenaltyWaiverRequests).entries({
        ID, requestNo: await nextNo('WVR', E.PenaltyWaiverRequests), penalty_ID: p.ID, customer_ID: p.customer_ID,
        originalAmount: gross, requestedAmount: amount, remainingAmount: remaining,
        percentage: gross ? Math.round(amount / gross * 10000) / 100 : 0, reasonCode: d.reasonCode, comments: d.comments,
        status: auto ? 'APPROVED' : 'PENDING_APPROVAL', decidedBy: auto ? req.user.id : null, decisionDate: auto ? today() : null,
        decisionComment: auto ? `Auto-approved: within threshold ${threshold}` : null
      });
      await audit(req, 'WAIVER_REQUEST', 'PenaltyWaiverRequests', ID, null, { amount, status: auto ? 'APPROVED' : 'PENDING_APPROVAL' }, d.comments);
      return SELECT.one.from(E.PenaltyWaiverRequests).where({ ID });
    });
    this.on('decideWaiver', async req => {
      const r = await must(E.PenaltyWaiverRequests, req.data.request_ID, 'Waiver request', req);
      if (r.status !== 'PENDING_APPROVAL') req.reject(409, `Request is already ${r.status}`);
      let remaining = r.remainingAmount;
      if (req.data.approve) {
        const p = await SELECT.one.from(E.PenaltyTransactions).where({ ID: r.penalty_ID });
        if (num(r.requestedAmount) > num(p.netPayable) + 0.001) req.reject(409, 'Penalty balance has changed - requested waiver now exceeds the payable amount');
        remaining = await applyWaiver(p, num(r.requestedAmount));
      }
      await UPDATE(E.PenaltyWaiverRequests).set({
        status: req.data.approve ? 'APPROVED' : 'REJECTED', decidedBy: req.user.id, decisionDate: today(),
        decisionComment: req.data.comment, remainingAmount: remaining
      }).where({ ID: r.ID });
      await audit(req, req.data.approve ? 'WAIVER_APPROVED' : 'WAIVER_REJECTED', 'PenaltyWaiverRequests', r.ID, { status: r.status }, { amount: r.requestedAmount }, req.data.comment);
      return SELECT.one.from(E.PenaltyWaiverRequests).where({ ID: r.ID });
    });

    /* ------------ replenishment ------------ */
    this.on('createReplenishmentRequest', async req => {
      const d = req.data;
      await must(E.AssetTypes, d.assetType_ID, 'Asset type', req);
      await must(E.Warehouses, d.warehouse_ID, 'Warehouse', req);
      if (!Number.isInteger(d.quantity) || d.quantity <= 0) req.reject(400, 'Quantity must be a positive whole number');
      const ID = cds.utils.uuid();
      await INSERT.into(E.ReplenishmentRequests).entries({
        ID, requestNo: await nextNo('REQ', E.ReplenishmentRequests), assetType_ID: d.assetType_ID, warehouse_ID: d.warehouse_ID,
        quantity: d.quantity, status: 'OPEN', remarks: d.remarks
      });
      await audit(req, 'REPLENISHMENT_REQUEST', 'ReplenishmentRequests', ID, null, { qty: d.quantity }, d.remarks);
      return SELECT.one.from(E.ReplenishmentRequests).where({ ID });
    });
    this.on('receiveReplenishment', async req => {
      const r = await must(E.ReplenishmentRequests, req.data.request_ID, 'Replenishment request', req);
      if (r.status === 'RECEIVED') req.reject(409, 'Already received');
      const stock = await getStock(r.assetType_ID, r.warehouse_ID);
      await UPDATE(E.StockBalances).set({ totalOwned: num(stock.totalOwned) + num(r.quantity) }).where({ ID: stock.ID });
      await UPDATE(E.ReplenishmentRequests).set({ status: 'RECEIVED' }).where({ ID: r.ID });
      await ledger('RECEIPT', { assetType_ID: r.assetType_ID, warehouse_ID: r.warehouse_ID, quantity: r.quantity, reference: r.requestNo });
      await audit(req, 'REPLENISHMENT_RECEIVED', 'ReplenishmentRequests', r.ID, { status: r.status }, { status: 'RECEIVED' });
      return SELECT.one.from(E.ReplenishmentRequests).where({ ID: r.ID });
    });

    /* ------------ dashboard ------------ */
    this.on('getDashboard', async req => {
      const t = today();
      const stocks = await SELECT.from(E.StockBalances);
      const sum = f => stocks.reduce((s, x) => s + num(x[f]), 0);
      const net = x => num(x.totalOwned) - num(x.atCustomer) - num(x.damaged) - num(x.scrapped);
      const disp = await SELECT.from(E.Dispatches);
      const open = disp.filter(x => x.status !== 'CLOSED' && num(x.quantity) - num(x.returnedQuantity) > 0);
      const outst = x => num(x.quantity) - num(x.returnedQuantity);
      const overdue = open.filter(x => x.graceEndDate < t);
      const presumedLostQty = open.filter(x => x.status === 'PRESUMED_LOST').reduce((s, x) => s + outst(x), 0);
      const canSeeMoney = ['LogisticsManager', 'LogisticsHead', 'Admin'].some(r => req.user.is(r));
      const pens = canSeeMoney ? await SELECT.from(E.PenaltyTransactions) : [];
      const customers = await SELECT.from(E.Customers).columns('ID', 'name');
      const cname = id => customers.find(c => c.ID === id)?.name || id;
      const returns = await SELECT.from(E.Returns);

      const byCust = {};
      for (const x of overdue) {
        const c = (byCust[x.customer_ID] ||= { label: cname(x.customer_ID), count: 0, amount: 0 });
        c.count += outst(x);
        c.amount += num(pens.find(p => p.dispatch_ID === x.ID)?.netPayable);
      }
      const aging = [['0-30 days', 0, 30], ['31-60 days', 31, 60], ['61+ days', 61, 1e9]].map(([label, lo, hi]) => ({
        label, amount: 0, count: open.filter(x => { const a = diffDays(t, x.dispatchDate); return a >= lo && a <= hi; }).reduce((s, x) => s + outst(x), 0)
      }));
      const months = [];
      for (let i = 5; i >= 0; i--) { const dt = new Date(); dt.setUTCDate(1); dt.setUTCMonth(dt.getUTCMonth() - i); months.push(dt.toISOString().slice(0, 7)); }
      const monthly = months.map(m => ({
        label: m,
        dispatched: disp.filter(x => String(x.dispatchDate).startsWith(m)).reduce((s, x) => s + num(x.quantity), 0),
        returned: returns.filter(x => String(x.returnDate).startsWith(m)).reduce((s, x) => s + num(x.quantity), 0)
      }));
      const from90 = addDays(t, -90), damageLimit = await setting('DAMAGE_RATE_THRESHOLD', 10);
      const dmg = {};
      for (const r of returns.filter(x => x.returnDate >= from90)) {
        const c = (dmg[r.customer_ID] ||= { label: cname(r.customer_ID), count: 0, bad: 0 });
        c.count += num(r.quantity); if (r.condition !== 'GOOD') c.bad += num(r.quantity);
      }
      const atCust = sum('atCustomer');
      return {
        totalOwned: sum('totalOwned'), available: stocks.reduce((s, x) => s + net(x), 0), atCustomer: atCust,
        damaged: sum('damaged'), scrapped: sum('scrapped'),
        overdueDispatches: overdue.length, presumedLostQty,
        totalPenalty: canSeeMoney ? pens.reduce((s, p) => s + num(p.netPayable), 0) : null,
        pendingWaivers: canSeeMoney ? (await SELECT.from(E.PenaltyWaiverRequests).where({ status: 'PENDING_APPROVAL' })).length : 0,
        replenishmentAlerts: stocks.filter(x => net(x) < num(x.safetyStock)).length,
        todaysDispatches: disp.filter(x => x.dispatchDate === t).reduce((s, x) => s + num(x.quantity), 0),
        todaysReturns: returns.filter(x => x.returnDate === t).reduce((s, x) => s + num(x.quantity), 0),
        statusDist: [
          { label: 'Available', count: stocks.reduce((s, x) => s + net(x), 0) },
          { label: 'At customer', count: Math.max(0, atCust - presumedLostQty) },
          { label: 'Presumed lost', count: presumedLostQty },
          { label: 'Damaged / repair', count: sum('damaged') },
          { label: 'Written off', count: sum('scrapped') }
        ].filter(x => x.count > 0),
        topOverdue: Object.values(byCust).sort((a, b) => b.count - a.count).slice(0, 10),
        aging, monthly,
        highDamageCustomers: Object.values(dmg).map(c => ({ label: c.label, count: c.count, amount: Math.round(c.bad / c.count * 10000) / 100 }))
          .filter(c => c.amount > damageLimit).sort((a, b) => b.amount - a.amount)
      };
    });

    return super.init();
  }
};
