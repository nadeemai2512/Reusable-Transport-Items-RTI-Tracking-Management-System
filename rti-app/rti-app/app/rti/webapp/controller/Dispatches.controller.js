sap.ui.define([
  "rti/app/controller/BaseController", "sap/ui/model/json/JSONModel", "sap/ui/model/Filter", "sap/ui/model/FilterOperator",
  "rti/app/util/FormDialog", "rti/app/util/Backend"
], function (BaseController, JSONModel, Filter, FilterOperator, FormDialog, Backend) {
  "use strict";

  var FILTER_TEXT = { open: "Filter: open dispatches", overdue: "Filter: overdue (grace period exceeded)", presumed: "Filter: presumed lost", today: "Filter: dispatched today" };

  return BaseController.extend("rti.app.controller.Dispatches", {
    onInit: function () {
      this.getView().setModel(new JSONModel({ filterText: "" }), "view");
      this._routeFilter = null;
      this.onMatched("dispatches", null, function (oEvent) {
        var q = oEvent.getParameter("arguments")["?query"] || {};
        this._routeFilter = q.filter || null;
        this.getView().getModel("view").setProperty("/filterText", FILTER_TEXT[this._routeFilter] || "");
        this.byId("statusFilter").setSelectedKey("");
        this.byId("search").setValue("");
        this.onFilter();
      });
    },

    /** Combines KPI-tile filter, status select and search into one OData $filter. */
    onFilter: function () {
      var a = [], t = this.today(), f = this._routeFilter;
      if (f === "open") { a.push(new Filter("status", FilterOperator.NE, "CLOSED")); }
      if (f === "overdue") { a.push(new Filter("status", FilterOperator.NE, "CLOSED"), new Filter("graceEndDate", FilterOperator.LT, t)); }
      if (f === "presumed") { a.push(new Filter("status", FilterOperator.EQ, "PRESUMED_LOST")); }
      if (f === "today") { a.push(new Filter("dispatchDate", FilterOperator.EQ, t)); }
      var s = this.byId("statusFilter").getSelectedKey();
      if (s) { a.push(new Filter("status", FilterOperator.EQ, s)); }
      var q = this.byId("search").getValue().trim();
      if (q) {
        a.push(new Filter({ and: false, filters: [
          new Filter("dispatchNo", FilterOperator.Contains, q), new Filter("customer/name", FilterOperator.Contains, q),
          new Filter("deliveryNo", FilterOperator.Contains, q)] }));
      }
      this.byId("table").getBinding("items").filter(a);
    },

    onRefresh: function () { this.byId("table").getBinding("items").refresh(); },

    onOpen: function (oEvent) {
      this.navTo("dispatchDetail", { id: oEvent.getSource().getBindingContext().getProperty("ID") });
    },

    onNew: function () {
      var oView = this.getView(), that = this;
      FormDialog.open({
        view: oView, title: "New Outbound Dispatch", submitText: "Dispatch",
        data: { quantity: 1, dispatchDate: this.today() },
        fields: [
          { name: "customer_ID", label: "Customer", type: "select", entity: "Customers", itemText: "{code} - {name}", required: true, filters: [new Filter("active", FilterOperator.EQ, true)] },
          { name: "warehouse_ID", label: "Warehouse", type: "select", entity: "Warehouses", itemText: "{code} - {name}", required: true },
          { name: "assetType_ID", label: "Asset type", type: "select", entity: "AssetTypes", itemText: "{code} - {name}", required: true },
          { name: "serialNo", label: "Serial / QR / barcode", type: "scan" },
          { name: "quantity", label: "Quantity", type: "int", required: true },
          { name: "dispatchDate", label: "Dispatch date", type: "date" },
          { name: "graceDays", label: "Grace days (blank = default)", type: "int" },
          { name: "expectedReturnDate", label: "Expected return", type: "date" },
          { name: "carrier", label: "Carrier", type: "text" },
          { name: "deliveryNo", label: "S/4 outbound delivery", type: "text" },
          { name: "shipmentNo", label: "Shipment no.", type: "text" },
          { name: "remarks", label: "Remarks", type: "textarea" }
        ],
        onSubmit: async function (v) {
          var r = await Backend.action(that.getODataModel(), "dispatchAssets", v);
          that.toast("Dispatch " + r.dispatchNo + " created");
          that.refreshAll();
        }
      });
    }
  });
});
