# RTI Tracking & Management (SAP CAP + SAPUI5 + SAP HANA + SAP BTP)

Reusable Transport Items (pallets, cages, totes, crates): dispatch, return/inspection, aging,
demurrage penalties, waiver approvals, safety-stock replenishment, repair management, purchase
requisitions, reports & analytics, movement ledger and audit trail.

This is a complete SAP CAP (Node.js) + SAPUI5 (Fiori) application with an OData V4 backend,
real backend-driven UI, an idempotent penalty/aging engine, a scheduled-job endpoint, S/4HANA
integration adapters, and a 25-test suite (6 unit + 19 integration) that all pass against a real
CAP server.

## Runtime fixes (this delivery — verified in a headless browser)

The previous build passed static validation and backend tests but **failed to actually run in a
browser** — blank page, no data, broken modules. Four root causes were found and fixed by loading
the real app in a headless Chrome and reading the console:

1. **SAPUI5 bootstrap 404 (the blank-page blocker).** `index.html` loaded UI5 from
   `https://ui5.sap.com/1.120.0/resources/sap-ui-core.js`. The SAP UI5 CDN does NOT serve exact
   patch versions — `1.120.0` returns HTTP 404 (an HTML error page), so UI5 never loaded and every
   page was blank. **Fix:** use the version *branch* `1.120` (which resolves to the latest patch,
   currently 1.120.53), with a programmatic fallback to the unversioned CDN and a 15s safety-net
   that shows a clear "Unable to load SAPUI5" panel if both fail. The bootstrap URL is overridable
   via `?ui5=<base-url>` for air-gapped landscapes.

2. **Mocked basic-auth blocked every OData call (no login UI).** CAP's dev mocked auth requires
   HTTP Basic credentials on every request. The browser basic-auth dialog breaks UI5's
   `fetch("./manifest.json")` (URLs may carry credentials → `TypeError: Request cannot be
   constructed from a URL that includes credentials`), and there is no login screen in the app —
   so `me()`, `getDashboard()` and every entity binding returned 401 and the app hung on loading.
   **Fix:** added `srv/server.js` (a CAP `bootstrap` hook) that, **in development only**, defaults
   anonymous requests to the `admin` mocked user. The app now boots end-to-end with no dialog.
   The hook is automatically disabled under the `@cap-js/cds-test` harness (detected via
   `process.env.cds_test_temp`) so the integration tests still assert 401/403 behaviour, and it is
   a no-op in production (`NODE_ENV=production`) where XSUAA enforces authentication.

3. **`WarehouseOccupancy` missing flattened columns.** The Warehouse page bound
   `$orderby:'warehouseCode,assetTypeCode'` but the CDS view exposed `warehouse`/`assetType` only
   as associations — those scalar properties did not exist → HTTP 400 → cascading "previous request
   failed" errors on Carriers/Warehouses too. **Fix:** added `warehouseCode`, `warehouseName`,
   `plant`, `assetTypeCode`, `assetTypeName` as computed columns in the `WarehouseOccupancy`
   select.

4. **`MessageStrip` `class=` assert.** `FormDialog.js` passed `class: "sapUiSmallMarginBottom"`
   as a constructor setting (invalid — `class` is not a UI5 setting) and 7 views used
   `<MessageStrip class="...">`, both firing `ManagedObject.apply: encountered unknown setting
   'class'`. **Fix:** `FormDialog.js` now uses `addStyleClass()`; the `class` attribute was removed
   from all 7 views (cosmetic margin only).

**Verified after fixes (headless Chrome):** UI5 loads, dashboard shows real KPIs (Total owned
1505, Available 1405, At customers 100, Overdue 1), all 16 routes navigate with **0 console
errors**, sidebar `itemSelect` navigation works, a create operation (Add Customer → fill form →
submit) persists to the DB and the new row appears in the table after refresh.

## Run locally
```bash
npm install
npm test            # 6 unit + 19 integration tests against a real CAP server (in-memory SQLite) - 25 pass
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

The UI loads SAPUI5 from `https://ui5.sap.com/1.120.0` (needs internet; `sap.viz` charts and
`sap.ndc` barcode scanning are SAPUI5-only). Change the version in `app/rti/webapp/index.html`
if your landscape uses a different one. Local DB is in-memory SQLite and is re-seeded from
`db/data/*.csv` on every start.

## Modules (22 functional areas, all with a page + route + backend integration)
1. Control Tower Dashboard – backend KPIs (`getDashboard`), clickable tiles, analytical charts.
2. Asset Master Management – AssetTypes / Customers / Warehouses / Carriers CRUD.
3. Serialized Asset Tracking – Assets CRUD, status lifecycle, scan dispatch/return.
4. Bulk Asset Inventory – StockBalances with computed `netAvailable`.
5. Warehouse Management – `WarehouseOccupancy` view + warehouse/carrier master.
6. Outbound Dispatch Management – `dispatchAssets` action, stock validation, ledger.
7. Inbound Return Management – `registerReturn` action, outstanding-balance validation.
8. Quality Inspection – `InspectionSummary` view, GOOD/MINOR_DAMAGE/SCRAP grades.
9. Customer Asset Management – `CustomerAssetBalances` aggregated view.
10. Asset Movement History – MovementLedger with type filter + search.
11. Asset Aging Management – Aging page with 0-30/31-60/61+/overdue/presumed buckets.
12. Demurrage and Penalty Management – tiered slab engine, idempotent.
13. Penalty Disputes and Waivers – `requestWaiver` / `decideWaiver`, thresholds.
14. Approval Workflow – auto-approve within threshold, manual approval above.
15. Damaged Asset and Repair Management – `createRepairOrder` / `completeRepair` / `scrapFromRepair`.
16. Inventory Management – stock by location, edit total/damaged/scrapped/safety.
17. Safety Stock Management – safety stock per asset type x warehouse.
18. Replenishment Alerts – `ReplenishmentAlerts` computed view, no duplicate active alerts.
19. Purchase Requisition Management – `createPurchaseRequisition` + `postPurchaseRequisitionToS4`.
20. Reports and Analytics – `getReports` function (valuation, exposure, condition, movements, overdue).
21. Audit Log Management – `AuditLogs`, filterable by action, role-gated.
22. System Configuration – Settings (grace days, waiver threshold, damage-rate threshold).

## Structure
- `db/schema.cds` – data model (master, transactions, penalties, repair, purchase requisitions, audit).
- `db/data/` – seed CSV data (re-seeded on every local start).
- `srv/rti-service.cds` – OData V4 service `/odata/v4/rti`, role restrictions, actions/functions.
- `srv/rti-service.js` – business logic (dispatch, return, penalty engine, waivers, replenishment,
  repair, purchase requisitions, reports, scheduled job, dashboard).
- `srv/lib/penalty.js` – pure, unit-tested penalty/aging calculation engine.
- `srv/lib/s4-adapter.js` – S/4HANA integration adapter (outbound delivery, purchase requisition,
  debit memo). Clearly fails when no destination is bound (never fakes a posting).
- `srv/lib/scheduler.js` – scheduled aging/demurrage job wrapper (local dev interval + BTP Job
  Scheduler endpoint).
- `app/rti/webapp` – SAPUI5 app (manifest routing, 18 views + controllers, `util/Backend.js`,
  `util/FormDialog.js`, `util/formatter.js`, `css/style.css`, `i18n/i18n.properties`).
- `app/router`, `mta.yaml`, `xs-security.json` – Cloud Foundry deployment (XSUAA, HANA HDI, approuter).
- `test/run-tests.js` – 6 unit + 19 integration tests.

## Database setup
Local (in-memory SQLite, re-seeded each start):
```bash
npx cds watch          # auto-deploys schema + loads db/data/*.csv
```
Persistent local SQLite (optional):
```bash
export CDS_CONFIG='{"requires":{"db":{"kind":"sqlite","credentials":{"url":"file:./rti.db"}}}}'
npx cds deploy         # creates rti.db and loads seed data
npx cds-serve
```
SAP HANA Cloud (production): configured via `mta.yaml` (`rti-tracking-db` HDI container). The CAP
`[production]` profile switches `db` to `hana` and `auth` to `xsuaa` automatically.

## Application startup commands
```bash
npm install            # install dependencies
npm test               # run the 25-test suite
npx cds watch          # dev server with live reload (http://localhost:4004)
npm start              # production-style: cds-serve (no reload)
```

## S/4HANA integration
The adapter `srv/lib/s4-adapter.js` is the single integration point. It supports:
- `getOutboundDelivery(deliveryNo)` – `API_OUTBOUND_DELIVERY_SRV` (A_OutbDeliveryHeader).
- `createPurchaseRequisition({...})` – `API_PURCHASEREQ_PROCESS_SRV` (A_PurchaseRequisition).
- `createDebitMemoRequest({...})` – `API_DEBIT_MEMO_REQUEST_SRV` (A_DebitMemoRequest).

**Setup (BTP):**
1. In the BTP subaccount, create a destination named `S4HANA` (override with env `S4_DESTINATION`)
   pointing to your S/4 system, e.g. `https://my.s4.sap:443`, with OAuth2ClientCredentials or
   PrincipalPropagation auth and the `sap-client` property if needed.
2. Bind the `destination` and `xsuaa` service instances to the `rti-tracking-srv` module (add them
   to `mta.yaml` `requires` if not present in your landscape).
3. Map RTI asset types / warehouses to S/4 material / plant values in the adapter payload
   (see `createPurchaseRequisition` in `srv/lib/s4-adapter.js`).

**Without a bound destination (local dev / this sandbox):** every S/4 call throws a clear,
identified error (`S/4HANA integration not configured: destination "S4HANA" is not bound...`).
The `postPurchaseRequisitionToS4` action records that error on the PR (`s4PostingError`) and
returns the PR with `status` still `OPEN` — never a silent fake success. This is the honest
"integration not wired" state required by the spec.

## Scheduled aging & demurrage job
The idempotent engine is exposed two ways:
- **Interactive:** the "Run penalty engine" button on the Penalties page (action `runPenaltyEngine`).
- **Scheduled:** the function `runScheduledAgingJob(asOf)` — invoked daily by the SAP BTP Job
  Scheduling service.

**Setup (BTP Job Scheduling service):**
1. Create a Job Scheduling service instance and bind it to `rti-tracking-srv` (add to `mta.yaml`
   `requires`).
2. In the BTP cockpit → Job Scheduling, create a job:
   - HTTP method: `GET`
   - URL: `https://<srv-url>/odata/v4/rti/runScheduledAgingJob(asOf=<today>)`
   - Schedule: daily, e.g. `0 2 * * *` (02:00)
   - Auth: bind the job to the `rti-tracking-auth` XSUAA instance with a service user carrying the
     `LogisticsHead` role (the `@(requires: 'authenticated-user')` gate is satisfied by any
     authenticated user; the engine itself is idempotent and safe to repeat).

**Local dev interval (optional):** set `RTI_SCHEDULER_INTERVAL_MS=86400000` (and optionally
`RTI_SCHEDULER_USER=dave`) before `npx cds watch` to run the engine locally once a day. Off by
default so it never interferes with tests.

## Deploy to SAP BTP Cloud Foundry
```bash
npm i -g mbt
mbt build
cf deploy mta_archives/rti-tracking_1.0.0.mtar
```
Then assign the generated role collections (WarehouseOperator, LogisticsManager,
InventoryPlanner, LogisticsHead, Admin) to users in the BTP cockpit. (Deployment itself was not
exercised — no BTP account was available in this environment; the MTA descriptor, XSUAA config
and HANA HDI module are present and conform to the standard CAP production layout.)

## Test results
```
✔ 6 unit tests (penalty engine: slabs, presumed-lost, partial returns, precedence, idempotency)
✔ 19 integration tests against a real CAP server (in-memory SQLite, mocked auth):
    auth, CRUD, bulk + serialized dispatch/return, partial returns, penalty engine idempotency,
    presumed-lost, waivers (auto + manual approval), replenishment alerts + receipt,
    repair (create/complete/scrap), purchase requisitions (S/4 post fails clearly),
    reports, scheduled aging job, read-only analytical views, role gating, dashboard/me/audit.
ℹ tests 25  pass 25  fail 0
```
Tests that require an unavailable environment (real S/4HANA destination, real BTP Job Scheduler,
real HANA Cloud) are clearly identified in the code and README — they are not claimed to have run.

## Modified files (this delivery)
**Backend:**
- `package.json` – pinned compatible versions (`@sap/cds@^10`, `@cap-js/sqlite@^3`, `@sap/cds-dk@^10`,
  `@cap-js/cds-test@^1`, +chai deps); the stale lockfile caused an unresolvable peer conflict.
- `package-lock.json` – regenerated from the corrected `package.json`.
- `db/schema.cds` – added `contractRef` on Dispatches; added `Carriers`, `RepairOrders`,
  `PurchaseRequisitions` entities; extended MovementLedger types.
- `srv/rti-service.cds` – exposed Carriers/RepairOrders/PurchaseRequisitions + read-only views
  (`CustomerAssetBalances`, `InspectionSummary`, `WarehouseOccupancy`); added actions
  `createRepairOrder`/`completeRepair`/`scrapFromRepair`/`createPurchaseRequisition`/
  `postPurchaseRequisitionToS4`; added functions `getReports` and `runScheduledAgingJob`;
  marked redirection targets; added `contractRef` to `dispatchAssets`.
- `srv/rti-service.js` – implemented all new handlers (repair lifecycle with stock movements,
  purchase requisitions with S/4 adapter delegation + honest failure recording, reports
  aggregation, scheduled job, audit hook for new entities, `contractRef` persistence).
- `srv/lib/s4-adapter.js` – NEW: S/4HANA integration adapter (outbound delivery, PR, debit memo).
- `srv/lib/scheduler.js` – NEW: scheduled aging/demurrage job wrapper.
- `srv/server.js` – NEW (runtime fix): CAP `bootstrap` hook that authenticates anonymous dev
  requests as `admin` so the UI boots without a basic-auth dialog; disabled under `cds.test` and
  in production.
- `srv/rti-service.cds` – `WarehouseOccupancy` now exposes flattened `warehouseCode`/`warehouseName`/
  `plant`/`assetTypeCode`/`assetTypeName` columns (runtime fix for the Warehouse page 400 error).
- `db/data/rti-Dispatches.csv` – added `contractRef` column + seed value.
- `db/data/rti-Carriers.csv` – NEW: carrier seed data.
- `test/run-tests.js` – added 7 integration tests for the new modules.

**Frontend:**
- `app/rti/webapp/index.html` – **runtime fix**: corrected the UI5 CDN URL from the 404ing
  `1.120.0` patch path to the `1.120` branch; added a programmatic fallback to the unversioned CDN
  and a 15s safety-net error panel; made the bootstrap URL overridable via `?ui5=<base-url>`.
- `app/rti/webapp/util/FormDialog.js` – **runtime fix**: `MessageStrip` now uses `addStyleClass()`
  instead of the invalid `class:` constructor setting.
- `app/rti/webapp/view/{Aging,Dashboard,Inspection,Penalties,Repair,Reports,Requisitions}.view.xml`
  – **runtime fix**: removed the `class="sapUiSmallMargin"` attribute from `MessageStrip` (fires an
  `unknown setting 'class'` assert).
- `app/rti/webapp/manifest.json` – 8 new routes/targets (inspection, customerAssets, aging,
  warehouse, repair, requisitions, reports, audit).
- `app/rti/webapp/view/App.view.xml` – sidebar expanded to all 22 modules.
- `app/rti/webapp/util/Backend.js` – `fn()` now supports function parameters (for `getReports`/`runScheduledAgingJob`).
- `app/rti/webapp/view/Ledger.view.xml` + `controller/Ledger.controller.js` – ledger-only with
  filter/search (audit moved to its own page).
- 8 NEW view/controller pairs: `Inspection`, `CustomerAssets`, `Aging`, `Warehouse`, `Repair`,
  `Requisitions`, `Reports`, `Audit`.
- `app/rti/webapp/controller/Dispatches.controller.js` – added `contractRef` field.
- `app/rti/webapp/view/DispatchDetail.view.xml` – added contract reference display.

**Important root causes fixed:**
- Dependency conflict: `@cap-js/sqlite@^2` peer-requires `@sap/cds@^9.8` but `@sap/cds` resolved to
  10.x. Aligned SQLite driver to `^3` (cds 10 line) and regenerated the lockfile — install now
  succeeds cleanly.
- CDS `select ... .join` chained syntax is invalid in CDS projections; rewrote the analytical views
  with proper `select from <entity> as <alias>` form and added `@cds.redirection.target` to the
  canonical Dispatches/Returns/StockBalances projections so the additional selects on the same base
  entity redirect associations correctly.
- S/4 posting failure recording: `req.reject()` rolls back the request transaction, losing the
  `s4PostingError` write. Reworked the handler to persist the error and return the PR (status stays
  OPEN) so the failure is honestly recorded without a silent fake success.
- **SAPUI5 CDN 404 (blank page):** the CDN does not serve exact patch versions; `1.120.0` 404s.
  Switched to the `1.120` branch with a fallback chain.
- **Dev auth blocking the UI:** CAP mocked basic-auth has no login screen, and the browser dialog
  breaks UI5's `fetch` of the manifest. Added a dev-only `bootstrap` hook that authenticates
  anonymous requests as `admin`, gated off under `cds.test` and in production.
- **WarehouseOccupancy 400:** the view exposed associations only; `$orderby` on non-existent scalar
  properties caused HTTP 400 and cascaded to sibling bindings. Added flattened columns.
- **MessageStrip `class` assert:** `class` is not a valid UI5 constructor setting; switched to
  `addStyleClass` and removed the XML attribute.
