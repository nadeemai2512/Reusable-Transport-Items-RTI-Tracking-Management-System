'use strict';
/**
 * Pure, side-effect-free penalty calculation (unit-testable).
 *
 * DAY-COUNT CONVENTION (used everywhere in the app):
 *   graceEndDate  = dispatchDate + graceDays (calendar days)
 *   overdue day n = the n-th calendar day AFTER graceEndDate  (n = 1, 2, 3 ...)
 *   daysOverdue   = max(0, asOf - graceEndDate)
 *   A unit returned on date R is NOT charged for day R or any later day.
 *   Demurrage accrues for overdue days 1..presumedLostDays using the matching slab.
 *   On overdue day presumedLostDays+1 the outstanding units are presumed lost:
 *   replacementCharge = outstanding(at that day) x replacementValue, demurrage stops.
 *
 * The result is a pure function of (dispatch, returns, policies, asOf) so it is
 * reproducible, idempotent, and safe to re-run any number of times.
 */
const MS = 86400000;
const toUTC = d => { const [y, m, dd] = String(d).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, dd); };
const diffDays = (a, b) => Math.round((toUTC(a) - toUTC(b)) / MS);
const addDays = (d, n) => new Date(toUTC(d) + n * MS).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

function pickRate(policies, { customerId, assetTypeId, day, dayDate }) {
  const matches = policies.filter(p =>
    Number(p.fromDay) <= day && day <= Number(p.toDay) &&
    (!p.customer_ID || p.customer_ID === customerId) &&
    (!p.assetType_ID || p.assetType_ID === assetTypeId) &&
    (!p.effectiveFrom || String(p.effectiveFrom) <= dayDate));
  if (!matches.length) return 0;
  const score = p => (p.customer_ID ? 2 : 0) + (p.assetType_ID ? 1 : 0);   // contract-specific wins
  matches.sort((a, b) => score(b) - score(a) || String(b.effectiveFrom || '').localeCompare(String(a.effectiveFrom || '')));
  return Number(matches[0].rate);
}

function computePenalty({ dispatch, returns = [], policies = [], replacementValue = 0, presumedLostDays = 30, asOf = today() }) {
  const qty = Number(dispatch.quantity);
  const graceEnd = dispatch.graceEndDate;
  const outstandingOn = date => qty - returns.filter(r => String(r.returnDate) <= date).reduce((s, r) => s + Number(r.quantity), 0);
  const daysOverdue = Math.max(0, diffDays(asOf, graceEnd));
  const lastAccrualDay = Math.min(daysOverdue, presumedLostDays);

  let accrued = 0;
  for (let n = 1; n <= lastAccrualDay; n++) {
    const date = addDays(graceEnd, n);
    const out = outstandingOn(date) ;
    if (out <= 0) break;
    accrued += out * pickRate(policies, { customerId: dispatch.customer_ID, assetTypeId: dispatch.assetType_ID, day: n, dayDate: date });
  }

  let replacement = 0, presumedLostQty = 0;
  if (daysOverdue > presumedLostDays) {
    presumedLostQty = Math.max(0, outstandingOn(addDays(graceEnd, presumedLostDays + 1)));
    replacement = presumedLostQty * Number(replacementValue);
  }
  const outstandingNow = outstandingOn(asOf);
  return {
    daysOverdue, outstandingNow, presumedLostQty,
    accruedDemurrage: Math.round(accrued * 100) / 100,
    replacementCharge: Math.round(replacement * 100) / 100,
    isPresumedLost: outstandingNow > 0 && daysOverdue > presumedLostDays
  };
}

module.exports = { computePenalty, pickRate, diffDays, addDays, today };
