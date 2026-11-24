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
               { grant: ['CREATE','UPDATE','DELETE'], to: ['WarehouseOperator','LogisticsHead','Admin'] } ]
  entity Assets as projection on rti.Assets;

  /* ---- inventory ---- */
  @restrict: [ { grant: 'READ', to: ['WarehouseOperator','LogisticsManager','InventoryPlanner','LogisticsHead','Admin'] },
               { grant: ['CREATE','UPDATE','DELETE'], to: ['InventoryPlanner','LogisticsHead','Admin'] } ]
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

  /* ---- transactions: read-only, written by actions ---- */
  @readonly
  @restrict: [ { grant: 'READ', to: ['WarehouseOperator','LogisticsManager','InventoryPlanner','LogisticsHead','Admin'] } ]
  entity Dispatches as projection on rti.Dispatches {
    *, (quantity - returnedQuantity) as outstanding : Integer
  };

  @readonly
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
                        carrier: String, deliveryNo: String, shipmentNo: String, remarks: String) returns Dispatches;

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

  @(requires: ['LogisticsManager','LogisticsHead','Admin','InventoryPlanner','WarehouseOperator'])
  function getDashboard() returns DashboardData;

  function me() returns MeInfo;
}
