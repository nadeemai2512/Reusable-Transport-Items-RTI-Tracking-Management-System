sap.ui.define([
  "rti/app/controller/BaseController", "sap/ui/model/Filter", "sap/ui/model/FilterOperator",
  "rti/app/util/FormDialog", "rti/app/util/Backend"
], function (BaseController, Filter, FilterOperator, FormDialog, Backend) {
  "use strict";

  return BaseController.extend("rti.app.controller.Requisitions", {
    onInit: function () {
      this.onMatched("requisitions", "alerts", function () { this.byId("table").getBinding("items").refresh(); });
    },
    onSearch: function () {
      var q = this.byId("search").getValue().trim();
      this.byId("table").getBinding("items").filter(q ? new Filter({ and: false, filters: [
        new Filter("prNo", FilterOperator.Contains, q), new Filter("assetType/name", FilterOperator.Contains, q)] }) : []);
    },
    onRefresh: function () { this.byId("table").getBinding("items").refresh(); },

    onNew: function () {
      var that = this;
      FormDialog.open({
        view: this.getView(), title: "New Purchase Requisition", submitText: "Create", data: { quantity: 1, unitPrice: 0 },
        fields: [
          { name: "replenishment_ID", label: "From replenishment request (optional)", type: "select", entity: "ReplenishmentRequests", itemText: "{requestNo} ({status})" },
          { name: "assetType_ID", label: "Asset type", type: "select", entity: "AssetTypes", itemText: "{code} - {name}", required: true },
          { name: "warehouse_ID", label: "Warehouse", type: "select", entity: "Warehouses", itemText: "{code} - {name}", required: true },
          { name: "quantity", label: "Quantity", type: "int", required: true },
          { name: "unitPrice", label: "Unit price", type: "decimal", required: true },
          { name: "remarks", label: "Remarks", type: "textarea" }
        ],
        onSubmit: async function (v) {
          var r = await Backend.action(that.getODataModel(), "createPurchaseRequisition", v);
          that.toast("Purchase requisition " + r.prNo + " created");
          that.refreshAll();
        }
      });
    },

    onPost: function (oEvent) {
      var that = this, ctx = oEvent.getSource().getBindingContext();
      this.confirm("Post purchase requisition " + ctx.getProperty("prNo") + " to S/4HANA?", async function () {
        that.byId("page").setBusy(true);
        try {
          var r = await Backend.action(that.getODataModel(), "postPurchaseRequisitionToS4", { pr_ID: ctx.getProperty("ID") });
          that.toast("PR converted in S/4HANA: " + r.s4PrNumber);
          that.refreshAll();
        } catch (e) {
          that.error(e);
        } finally { that.byId("page").setBusy(false); }
      });
    }
  });
});
