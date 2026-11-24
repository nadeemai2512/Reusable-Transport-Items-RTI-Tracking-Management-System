# RTI Tracking & Management (SAP CAP + SAPUI5)

Reusable Transport Items (pallets, cages, totes, crates): dispatch, return/inspection, aging, demurrage penalties,
waiver approvals, safety-stock replenishment, ledger and audit trail.

## Run locally
```bash
npm install
npm test            # 6 unit + 12 integration tests against a real CAP server (in-memory SQLite)
npx cds watch       # then open http://localhost:4004/  (redirects to /rti/webapp/index.html)
```
Browser login (mocked auth, password for all users: `rti`):

| user  | roles |
|-------|-------|
| alice | WarehouseOperator |
| bob   | LogisticsManager |
| carol | InventoryPlanner |
| dave  | LogisticsHead |
| admin | all roles |

The UI loads SAPUI5 from `https://ui5.sap.com/1.120.0` (needs internet; `sap.viz` charts and `sap.ndc` barcode scanning
are SAPUI5-only). Change the version in `app/rti/webapp/index.html` if needed.
Local DB is in-memory SQLite and is re-seeded from `db/data/*.csv` on every start.

## Structure
- `db/schema.cds` – data model, `db/data/` – seed data
- `srv/rti-service.cds|js` – OData V4 service `/odata/v4/rti`, role restrictions, business logic
- `srv/lib/penalty.js` – pure penalty engine (day-count convention documented in the file header)
- `app/rti/webapp` – SAPUI5 app (manifest routing, views, controllers, `util/Backend.js`, `util/FormDialog.js`)
- `app/router`, `mta.yaml`, `xs-security.json` – Cloud Foundry deployment (XSUAA, HANA HDI, approuter)
- `test/run-tests.js`

## Deploy to SAP BTP Cloud Foundry (UNTESTED - no BTP account was available)
```bash
npm i -g mbt
mbt build
cf deploy mta_archives/rti-tracking_1.0.0.mtar
```
Then assign the generated role collections (WarehouseOperator, LogisticsManager, InventoryPlanner, LogisticsHead, Admin) to users in the BTP cockpit.

## Not implemented (be aware)
- S/4HANA integration (`API_OUTBOUND_DELIVERY_SRV`, `API_DEBIT_MEMO_REQUEST_SRV`, purchase requisitions): delivery numbers are
  entered manually; replenishment requests are internal only. Nothing is posted to S/4HANA.
- SAP Job Scheduling Service: the idempotent engine is the `runPenaltyEngine` action (button on the Penalties page);
  registering it as a scheduled job is not done.
- Not built: customer-balance page, customer damage-rate per customer page (only the dashboard table), CSV/Excel export,
  repair queue workflow, carriers/plants as separate entities, waiver attachments, approval delegation.
