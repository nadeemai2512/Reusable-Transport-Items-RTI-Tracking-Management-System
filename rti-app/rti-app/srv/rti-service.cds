using rti from '../db/schema';

type LabelCount  { label : String; count : Integer; amount : Decimal(15,2); }
type TrendPoint  { label : String; dispatched : Integer; returned : Integer; }
type MeInfo      { id : String; roles : many String; }
type EngineResult { processed : Integer; presumedLost : Integer; totalAccrued : Decimal(15,2); asOf : Date; }
type DashboardData {
  totalOwned : Integer; available : Integer; atCustomer : Integer; damaged : Integer; scrapped : Integer;
  overdueDispatches : Integer; presumedLostQty : Integer; totalPenalty : Decimal(15,2);
  pendingWaivers : Integer; replenishmentAlerts : Integer; todaysDispatches : Integer; todaysReturns : Integer;
  statusDist : many LabelCount; topOverdue : many LabelCount; aging : many LabelCount;
  monthly : many TrendPoint; highDamageCustomers : many LabelCount;
}

@path: '/odata/v4/rti'
@requires: 'authenticated-user'
service RtiService {

  /* ---- master data ---- */
  @restrict: [ { grant: 'READ', to: ['WarehouseOperator','LogisticsManager','InventoryPlanner','LogisticsHead','Admin'] },
               { grant: ['CREATE','UPDATE','DELETE'], to: ['LogisticsHead','Admin'] } ]
  entity AssetTypes as projection on rti.AssetTypes;

  @restrict: [ { grant: 'READ', to: ['WarehouseOperator','LogisticsManager','InventoryPlanner','LogisticsHead','Admin'] },
               { grant: ['CREATE','UPDATE','DELETE'], to: ['LogisticsManager','LogisticsHead','Admin'] } ]
  entity Customers as projection on rti.Customers;

  @restrict: [ { grant: 'READ', to: ['WarehouseOperator','LogisticsManager','InventoryPlanner','LogisticsHead','Admin'] },
               { grant: ['CREATE','UPDATE','DELETE'], to: ['LogisticsHead','Admin'] } ]
  entity Warehouses as projection on rti.Warehouses;

  @restrict: [ { grant: 'READ', to: ['WarehouseOperator','LogisticsManager','InventoryPlanner','LogisticsHead','Admin'] },
               { grant: ['CREATE','UPDATE','DELETE'], to: ['LogisticsManager','LogisticsHead','Admin'] } ]
  entity Carriers as projection on rti.Carriers;

  @restrict: [ { grant: 'READ', to: ['WarehouseOperator','LogisticsManager','InventoryPlanner','LogisticsHead','Admin'] },
               { grant: ['CREATE','UPDATE','DELETE'], to: ['WarehouseOperator','LogisticsHead','Admin'] } ]
  entity Assets as projection on rti.Assets;

  /* ---- inventory ---- */
  @restrict: [ { grant: 'READ', to: ['WarehouseOperator','LogisticsManager','InventoryPlanner','LogisticsHead','Admin'] },
               { grant: ['CREATE','UPDATE','DELETE'], to: ['InventoryPlanner','LogisticsHead','Admin'] } ]
  @cds.redirection.target
  entity StockBalances as projection on rti.StockBalances {
    *, (totalOwned - atCustomer - damaged - scrapped) as netAvailable : Integer
  };

  @readonly
  @restrict: [ { grant: 'READ', to: ['InventoryPlanner','LogisticsHead','Admin'] } ]
  entity ReplenishmentAlerts as select from rti.StockBalances {
    key ID, assetType, warehouse, safetyStock,
    (totalOwned - atCustomer - damaged - scrapped) as netAvailable : Integer,
    (safetyStock - (totalOwned - atCustomer - damaged - scrapped)) as shortfall : Integer
  } where (totalOwned - atCustomer - damaged - scrapped) < safetyStock;

  @restrict: [ { grant: 'READ', to: ['InventoryPlanner','LogisticsHead','Admin'] },
               { grant: ['CREATE','UPDATE'], to: ['InventoryPlanner','Admin'] },
               { grant: 'DELETE', to: ['Admin'] } ]
  entity ReplenishmentRequests as projection on rti.ReplenishmentRequests;

  /* ---- repair orders (Damaged Asset & Repair Management) ---- */
  @restrict: [ { grant: 'READ', to: ['WarehouseOperator','LogisticsManager','InventoryPlanner','LogisticsHead','Admin'] },
               { grant: ['CREATE','UPDATE'], to: ['WarehouseOperator','LogisticsManager','Admin'] },
               { grant: 'DELETE', to: ['Admin'] } ]
  entity RepairOrders as projection on rti.RepairOrders;

  /* ---- purchase requisitions (Purchase Requisition Management, S/4 PR) ---- */
  @restrict: [ { grant: 'READ', to: ['InventoryPlanner','LogisticsManager','LogisticsHead','Admin'] },
               { grant: ['CREATE','UPDATE'], to: ['InventoryPlanner','LogisticsManager','Admin'] },
               { grant: 'DELETE', to: ['Admin'] } ]
  entity PurchaseRequisitions as projection on rti.PurchaseRequisitions;

  /* ---- Customer Asset Balances: outstanding units per customer x asset type (read-only) ---- */
  @readonly
  @restrict: [ { grant: 'READ', to: ['WarehouseOperator','LogisticsManager','InventoryPlanner','LogisticsHead','Admin'] } ]
  entity CustomerAssetBalances as select from rti.Dispatches as D {
      key D.customer as customer,
      key D.assetType as assetType,
      sum(D.quantity) as dispatchedQty : Integer,
      sum(D.returnedQuantity) as returnedQty : Integer,
      sum(D.quantity - D.returnedQuantity) as outstandingQty : Integer,
      sum(case when D.status = 'PRESUMED_LOST' then D.quantity - D.returnedQuantity else 0 end) as presumedLostQty : Integer
    } group by D.customer, D.assetType
    having sum(D.quantity - D.returnedQuantity) > 0;

  /* ---- Quality Inspection Summary: returns with associations expanded (read-only) ---- */
  @readonly
  @restrict: [ { grant: 'READ', to: ['WarehouseOperator','LogisticsManager','InventoryPlanner','LogisticsHead','Admin'] } ]
  entity InspectionSummary as select from rti.Returns as R {
      key R.ID,
      R.returnNo,
      R.returnDate,
      R.condition,
      R.quantity,
      R.customer as customer,
      R.assetType as assetType,
      R.dispatch as dispatch
  };

  /* ---- Warehouse Occupancy: stock totals per warehouse x asset type (read-only) ---- */
  @readonly
  @restrict: [ { grant: 'READ', to: ['WarehouseOperator','LogisticsManager','InventoryPlanner','LogisticsHead','Admin'] } ]
  entity WarehouseOccupancy as select from rti.StockBalances as S {
      key S.ID,
      S.warehouse as warehouse,
      S.assetType as assetType,
      S.warehouse.code as warehouseCode,
      S.warehouse.name as warehouseName,
      S.warehouse.plant as plant,
      S.assetType.code as assetTypeCode,
      S.assetType.name as assetTypeName,
      S.totalOwned,
      S.atCustomer,
      S.damaged,
      S.scrapped,
      (S.totalOwned - S.atCustomer - S.damaged - S.scrapped) as netAvailable : Integer,
      S.safetyStock
  };

  /* ---- transactions: read-only, written by actions ---- */
  @readonly
  @cds.redirection.target
  @restrict: [ { grant: 'READ', to: ['WarehouseOperator','LogisticsManager','InventoryPlanner','LogisticsHead','Admin'] } ]
  entity Dispatches as projection on rti.Dispatches {
    *, (quantity - returnedQuantity) as outstanding : Integer
  };

  @readonly
  @cds.redirection.target
  @restrict: [ { grant: 'READ', to: ['WarehouseOperator','LogisticsManager','InventoryPlanner','LogisticsHead','Admin'] } ]
  entity Returns as projection on rti.Returns;

  @readonly
  @restrict: [ { grant: 'READ', to: ['WarehouseOperator','LogisticsManager','InventoryPlanner','LogisticsHead','Admin'] } ]
  entity MovementLedger as projection on rti.MovementLedger;

  @readonly
  @restrict: [ { grant: 'READ', to: ['LogisticsManager','LogisticsHead','Admin'] } ]
  entity PenaltyTransactions as projection on rti.PenaltyTransactions;

  @readonly
  @restrict: [ { grant: 'READ', to: ['LogisticsManager','LogisticsHead','Admin'] } ]
  entity PenaltyWaiverRequests as projection on rti.PenaltyWaiverRequests;

  @restrict: [ { grant: 'READ', to: ['LogisticsManager','LogisticsHead','Admin'] },
               { grant: ['CREATE','UPDATE','DELETE'], to: ['LogisticsHead','Admin'] } ]
  entity PenaltyPolicies as projection on rti.PenaltyPolicies;

  @restrict: [ { grant: 'READ', to: ['LogisticsHead','Admin'] },
               { grant: ['CREATE','UPDATE','DELETE'], to: ['LogisticsHead','Admin'] } ]
  entity Settings as projection on rti.Settings;

  @readonly
  @restrict: [ { grant: 'READ', to: ['LogisticsHead','Admin'] } ]
  entity AuditLogs as projection on rti.AuditLogs;

  /* ---- actions ---- */
  @(requires: ['WarehouseOperator','LogisticsHead','Admin'])
  action dispatchAssets(customer_ID: UUID, warehouse_ID: UUID, assetType_ID: UUID, quantity: Integer,
                        serialNo: String, dispatchDate: Date, graceDays: Integer, expectedReturnDate: Date,
                        carrier: String, deliveryNo: String, shipmentNo: String, contractRef: String, remarks: String) returns Dispatches;

  @(requires: ['WarehouseOperator','LogisticsHead','Admin'])
  action registerReturn(dispatch_ID: UUID, quantity: Integer, condition: String, serialNo: String,
                        returnDate: Date, remarks: String) returns Returns;

  @(requires: ['LogisticsHead','Admin'])
  action runPenaltyEngine(asOf: Date) returns EngineResult;

  @(requires: ['LogisticsManager','LogisticsHead','Admin'])
  action requestWaiver(penalty_ID: UUID, amount: Decimal(15,2), reasonCode: String, comments: String) returns PenaltyWaiverRequests;

  @(requires: ['LogisticsHead','Admin'])
  action decideWaiver(request_ID: UUID, approve: Boolean, comment: String) returns PenaltyWaiverRequests;

  @(requires: ['InventoryPlanner','Admin'])
  action createReplenishmentRequest(assetType_ID: UUID, warehouse_ID: UUID, quantity: Integer, remarks: String) returns ReplenishmentRequests;

  @(requires: ['InventoryPlanner','Admin'])
  action receiveReplenishment(request_ID: UUID) returns ReplenishmentRequests;

  /* ---- repair (Damaged Asset & Repair Management) ---- */
  @(requires: ['WarehouseOperator','LogisticsManager','Admin'])
  action createRepairOrder(asset_ID: UUID, assetType_ID: UUID, warehouse_ID: UUID, return_ID: UUID,
                           quantity: Integer, damagedOn: Date, vendor: String, repairCost: Decimal(15,2),
                           remarks: String) returns RepairOrders;

  @(requires: ['WarehouseOperator','LogisticsManager','Admin'])
  action completeRepair(repair_ID: UUID, repairedOn: Date, repairCost: Decimal(15,2), remarks: String) returns RepairOrders;

  @(requires: ['LogisticsHead','Admin'])
  action scrapFromRepair(repair_ID: UUID, remarks: String) returns RepairOrders;

  /* ---- purchase requisitions (Purchase Requisition Management) ---- */
  @(requires: ['InventoryPlanner','LogisticsManager','Admin'])
  action createPurchaseRequisition(replenishment_ID: UUID, assetType_ID: UUID, warehouse_ID: UUID,
                                   quantity: Integer, unitPrice: Decimal(15,2), remarks: String) returns PurchaseRequisitions;

  @(requires: ['InventoryPlanner','LogisticsManager','Admin'])
  action postPurchaseRequisitionToS4(pr_ID: UUID) returns PurchaseRequisitions;

  /* ---- reports ---- */
  type ReportLine { label : String; value : Decimal(15,2); qty : Integer; group : String; }
  type ReportData {
    generatedOn : Date;
    inventoryValuation : many ReportLine;
    customerExposure : many ReportLine;
    conditionBreakdown : many ReportLine;
    movementSummary : many ReportLine;
    topOverdueDispatches : many ReportLine;
  }

  @(requires: ['LogisticsManager','LogisticsHead','Admin','InventoryPlanner','WarehouseOperator'])
  function getReports(asOf: Date) returns ReportData;

  /* ---- scheduled aging & demurrage job (invoked by BTP Job Scheduling service) ---- */
  @(requires: ['authenticated-user'])
  function runScheduledAgingJob(asOf: Date) returns EngineResult;

  @(requires: ['LogisticsManager','LogisticsHead','Admin','InventoryPlanner','WarehouseOperator'])
  function getDashboard() returns DashboardData;

  function me() returns MeInfo;
}
