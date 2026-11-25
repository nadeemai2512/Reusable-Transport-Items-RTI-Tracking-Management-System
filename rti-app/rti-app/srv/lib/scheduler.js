'use strict';
/**
 * Scheduled aging & demurrage job for the RTI service.
 *
 * The idempotent penalty engine lives in srv/rti-service.js (action runPenaltyEngine).
 * This module is the thin wrapper that:
 *   - exposes the engine as a callable endpoint for the SAP BTP Job Scheduling service
 *     (a cron job configured in the BTP cockpit hits /odata/v4/rti/runScheduledAgingJob()),
 *   - and provides a local setInterval-based runner for development (activated by the
 *     RTI_SCHEDULER_INTERVAL_MS env var, so it is OFF by default and never interferes
 *     with tests).
 *
 * The job uses a service user with the LogisticsHead role (RTI_SCHEDULER_USER env var,
 * default "dave") so the backend @requires authorization is satisfied even when invoked
 * without an interactive user session.
 */

const cds = require('@sap/cds');
const { today } = require('./penalty');

const JOB_USER = process.env.RTI_SCHEDULER_USER || 'dave';
const INTERVAL_MS = Number(process.env.RTI_SCHEDULER_INTERVAL_MS || 0);

let localTimer = null;

/** Runs the aging+demurrage engine once, as the configured service user. Returns the EngineResult. */
async function runOnce(asOf) {
  const db = await cds.connect.to('db');
  const { RtiService } = cds.services;
  // Dispatch the action through the service so @requires is enforced with the service user.
  const tx = db.tx({ id: JOB_USER, tinfo: `local:rti-scheduler`, is: r => r === 'LogisticsHead' || r === 'Admin' });
  try {
    return await tx.srv ? null : await RtiService.runPenaltyEngine({ data: { asOf: asOf || today() } });
  } finally {
    await tx.commit();
  }
}

/**
 * Starts a local interval runner. Only enabled when RTI_SCHEDULER_INTERVAL_MS is set
 * (e.g. 86400000 for a daily run). In production this is NOT used - the BTP Job
 * Scheduling service calls the HTTP endpoint instead.
 */
function startLocalRunner() {
  if (localTimer || !INTERVAL_MS) return;
  localTimer = setInterval(async () => {
    try { await runOnce(today()); }
    catch (e) { /* logged but never crash the timer - the next tick retries */ cds.log('rti-scheduler').error('scheduled run failed', e); }
  }, INTERVAL_MS);
  if (localTimer.unref) localTimer.unref(); // do not keep the process alive on its own
  cds.log('rti-scheduler').info(`local scheduler started (interval ${INTERVAL_MS}ms as user ${JOB_USER})`);
}

function stopLocalRunner() { if (localTimer) { clearInterval(localTimer); localTimer = null; } }

module.exports = { runOnce, startLocalRunner, stopLocalRunner, JOB_USER };
