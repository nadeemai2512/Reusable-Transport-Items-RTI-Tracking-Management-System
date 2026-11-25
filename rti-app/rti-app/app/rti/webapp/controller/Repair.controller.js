sap.ui.define([
  "rti/app/controller/BaseController", "sap/ui/model/Filter", "sap/ui/model/FilterOperator",
  "rti/app/util/FormDialog", "rti/app/util/Backend"
], function (BaseController, Filter, FilterOperator, FormDialog, Backend) {
  "use strict";

  return BaseController.extend("rti.app.controller.Repair", {
    onInit: function () {
      this.onMatched("repair", null, function () { this.byId("table").getBinding("items").refresh(); });
    },
    onFilter: function () {
      var s = this.byId("statusFilter").getSelectedKey();
      this.byId("table").getBinding("items").filter(s ? new Filter("status", FilterOperator.EQ, s) : []);
    },
    onSearch: function () {
      var q = this.byId("search").getValue().trim();
      this.byId("table").getBinding("items").filter(q ? new Filter({ and: false, filters: [
        new Filter("repairNo", FilterOperator.Contains, q), new Filter("asset/serialNo", FilterOperator.Contains, q)] }) : []);
    },
    onRefresh: function () { this.byId("table").getBinding("items").refresh(); },

    onNew: function () {
      var that = this;
      FormDialog.open({
        view: this.getView(), title: "New Repair Order", submitText: "Create", data: { quantity: 1, damagedOn: this.today() },
        fields: [
          { name: "asset_ID", label: "Damaged asset (serialized)", type: "select", entity: "Assets", itemText: "{serialNo} ({assetType/name})" },
          { name: "assetType_ID", label: "Asset type", type: "select", entity: "AssetTypes", itemText: "{code} - {name}", required: true },
          { name: "warehouse_ID", label: "Warehouse", type: "select", entity: "Warehouses", itemText: "{code} - {name}", required: true },
          { name: "quantity", label: "Quantity", type: "int", required: true },
          { name: "damagedOn", label: "Damaged on", type: "date" },
          { name: "vendor", label: "Repair vendor", type: "text" },
          { name: "repairCost", label: "Repair cost", type: "decimal" },
          { name: "remarks", label: "Remarks", type: "textarea" }
        ],
        onSubmit: async function (v) {
          var r = await Backend.action(that.getODataModel(), "createRepairOrder", v);
          that.toast("Repair order " + r.repairNo + " created");
          that.refreshAll();
        }
      });
    },
    onComplete: function (oEvent) {
      var that = this, ctx = oEvent.getSource().getBindingContext();
      FormDialog.open({
        view: this.getView(), title: "Complete repair - " + ctx.getProperty("repairNo"), submitText: "Complete",
        data: { repairedOn: this.today(), repairCost: ctx.getProperty("repairCost") },
        fields: [
          { name: "repairedOn", label: "Repaired on", type: "date", required: true },
          { name: "repairCost", label: "Final repair cost", type: "decimal" },
          { name: "remarks", label: "Remarks", type: "textarea" }
        ],
        onSubmit: async function (v) {
          v.repair_ID = ctx.getProperty("ID");
          var r = await Backend.action(that.getODataModel(), "completeRepair", v);
          that.toast("Repair " + r.repairNo + " completed - stock restored");
          that.refreshAll();
        }
      });
    },
    onScrap: function (oEvent) {
      var that = this, ctx = oEvent.getSource().getBindingContext();
      this.confirm("Scrap repair " + ctx.getProperty("repairNo") + "? The quantity will be written off (moved to scrapped).", async function () {
        try {
          var r = await Backend.action(that.getODataModel(), "scrapFromRepair", { repair_ID: ctx.getProperty("ID"), remarks: "Scrapped from repair queue" });
          that.toast("Repair " + r.repairNo + " scrapped");
          that.refreshAll();
        } catch (e) { that.error(e); }
      });
    }
  });
});
