using { cuid, managed } from '@sap/cds/common';

namespace rti;

/* ---------- Master data ---------- */
@assert.unique: { code: [code] }
entity AssetTypes : cuid, managed {
  code             : String(20) @mandatory;
  name             : String(80) @mandatory;
  category         : String(40);
  serialized       : Boolean default false;
  uom              : String(10) default 'EA';
  purchaseValue    : Decimal(15,2) default 0;
  replacementValue : Decimal(15,2) default 0;
  defaultGraceDays : Integer default 30;
  active           : Boolean default true;
}

@assert.unique: { code: [code] }
entity Customers : cuid, managed {
  code             : String(20) @mandatory;
  name             : String(100) @mandatory;
  city             : String(60);
  country          : String(60);
  defaultGraceDays : Integer;            // overrides asset type grace period when set
  active           : Boolean default true;
}

@assert.unique: { code: [code] }
entity Warehouses : cuid, managed {
  code   : String(20) @mandatory;
  name   : String(80) @mandatory;
  plant  : String(20);
  city   : String(60);
}

/* ---------- Serialized assets ---------- */
@assert.unique: { serial: [serialNo] }
entity Assets : cuid, managed {
  serialNo         : String(40) @mandatory;
  assetType        : Association to AssetTypes @mandatory;
  qrCode           : String(80);
  barcode          : String(80);
  rfidTag          : String(80);
  status           : String(30) default 'AVAILABLE';
  currentWarehouse : Association to Warehouses;
  currentCustomer  : Association to Customers;
  purchaseDate     : Date;
  purchaseValue    : Decimal(15,2);
}

/* ---------- Stock (one row per asset type + warehouse) ---------- */
@assert.unique: { loc: [assetType, warehouse] }
entity StockBalances : cuid, managed {
  assetType   : Association to AssetTypes @mandatory;
  warehouse   : Association to Warehouses @mandatory;
  totalOwned  : Integer default 0;
  atCustomer  : Integer default 0;   // includes presumed-lost until written off
  damaged     : Integer default 0;   // includes under-repair
  scrapped    : Integer default 0;
  safetyStock : Integer default 0;
}

/* ---------- Dispatches / Returns ---------- */
entity Dispatches : cuid, managed {
  dispatchNo         : String(20);
  dispatchDate       : Date;
  customer           : Association to Customers;
  warehouse          : Association to Warehouses;
  assetType          : Association to AssetTypes;
  asset              : Association to Assets;
  quantity           : Integer;
  returnedQuantity   : Integer default 0;
  graceDays          : Integer;
  graceEndDate       : Date;
  expectedReturnDate : Date;
  carrier            : String(80);
  deliveryNo         : String(20);    // S/4HANA outbound delivery (manual entry; API not wired)
  shipmentNo         : String(20);
  status             : String(20) default 'OPEN';   // OPEN, PARTIALLY_RETURNED, CLOSED, PRESUMED_LOST
  remarks            : String(255);
}

entity Returns : cuid, managed {
  returnNo       : String(20);
  returnDate     : Date;
  dispatch       : Association to Dispatches;
  customer       : Association to Customers;
  assetType      : Association to AssetTypes;
  asset          : Association to Assets;
  quantity       : Integer;
  condition      : String(20);       // GOOD, MINOR_DAMAGE, SCRAP
  inspectionDate : Date;
  remarks        : String(255);
}

entity MovementLedger : cuid, managed {
  movementDate : Timestamp;
  type         : String(20);   // DISPATCH, RETURN_GOOD, RETURN_DAMAGED, RETURN_SCRAP, PRESUMED_LOST, RECEIPT
  assetType    : Association to AssetTypes;
  warehouse    : Association to Warehouses;
  customer     : Association to Customers;
  asset        : Association to Assets;
  quantity     : Integer;
  reference    : String(40);
}

/* ---------- Penalties ---------- */
entity PenaltyPolicies : cuid, managed {
  assetType     : Association to AssetTypes;   // null = all types
  customer      : Association to Customers;    // null = all customers
  fromDay       : Integer;
  toDay         : Integer;
  rate          : Decimal(15,2);               // per unit per day
  currency      : String(3) default 'INR';
  effectiveFrom : Date;
}

@assert.unique: { dispatch: [dispatch] }
entity PenaltyTransactions : cuid, managed {
  dispatch          : Association to Dispatches;
  customer          : Association to Customers;
  assetType         : Association to AssetTypes;
  outstandingQty    : Integer;
  overdueDays       : Integer;
  accruedDemurrage  : Decimal(15,2) default 0;
  replacementCharge : Decimal(15,2) default 0;
  waivedAmount      : Decimal(15,2) default 0;
  netPayable        : Decimal(15,2) default 0;
  currency          : String(3) default 'INR';
  calculatedOn      : Date;
  status            : String(20);   // ACCRUING, PRESUMED_LOST, CLOSED
}

entity PenaltyWaiverRequests : cuid, managed {
  requestNo       : String(20);
  penalty         : Association to PenaltyTransactions;
  customer        : Association to Customers;
  originalAmount  : Decimal(15,2);
  requestedAmount : Decimal(15,2);
  remainingAmount : Decimal(15,2);
  percentage      : Decimal(5,2);
  reasonCode      : String(20);
  comments        : String(500);
  status          : String(20);    // PENDING_APPROVAL, APPROVED, REJECTED
  decidedBy       : String(100);
  decisionDate    : Date;
  decisionComment : String(500);
}

/* ---------- Replenishment ---------- */
entity ReplenishmentRequests : cuid, managed {
  requestNo : String(20);
  assetType : Association to AssetTypes;
  warehouse : Association to Warehouses;
  quantity  : Integer;
  status    : String(20) default 'OPEN';   // OPEN, ORDERED, RECEIVED
  remarks   : String(255);
}

/* ---------- Config + audit ---------- */
entity Settings {
  key code  : String(40);
  value     : String(100);
  descr     : String(200);
}

entity AuditLogs : cuid, managed {
  userId     : String(100);
  action     : String(40);
  entityType : String(40);
  entityId   : String(60);
  oldValue   : String(1000);
  newValue   : String(1000);
  comments   : String(500);
}
