sap.ui.define([
  "rti/app/controller/BaseController", "sap/m/MessageBox", "rti/app/util/FormDialog", "rti/app/util/Backend"
], function (BaseController, MessageBox, FormDialog, Backend) {
  "use strict";

  var GROUP = "rtiGroup";

  return BaseController.extend("rti.app.controller.Inventory", {
    onInit: function () {
      this.onMatched("inventory", null, function (oEvent) {
        var q = oEvent.getParameter("arguments")["?query"] || {};
        var sTab = q.tab === "alerts" && this.getMe().getProperty("/can/alerts") ? "alerts" : "stock";
        this.byId("tabs").setSelectedKey(sTab);
        this._load(sTab);
      });
    },

    /** Lazy-load the tab's binding (alerts/requests are suspended until first shown) and always refresh from backend. */
    _load: function (sKey) {
      var id = { stock: "stockTable", alerts: "alertTable", requests: "requestTable" }[sKey];
      var b = this.byId(id).getBinding("items");
      if (b.isSuspended()) { b.resume(); } else { b.refresh(); }
    },
    onTabSelect: function (e) { this._load(e.getParameter("key")); },
    onRefresh: function () { this.getODataModel().refresh(); },

    /* ---- stock CRUD (deferred group: nothing is sent until Save) ---- */
    onAddStock: function () {
      var that = this, oBinding = this.byId("stockTable").getBinding("items"), oModel = this.getODataModel();
      FormDialog.open({
        view: this.getView(), title: "Add stock record", data: { totalOwned: 0, safetyStock: 0 },
        fields: this._stockFields(false),
        onSubmit: async function (v) {
          var oCtx = oBinding.create(v, true);
          try {
            await Promise.all([oCtx.created(), oModel.submitBatch(GROUP)]);
            that.toast("Stock record created"); that.refreshAll();
          } catch (e) { if (oCtx.isTransient && oCtx.isTransient()) { oCtx.delete(); } oModel.resetChanges(GROUP); throw e; }
        }
      });
    },
    onEditStock: function (oEvent) {
      var that = this, oCtx = oEvent.getSource().getBindingContext(), oModel = this.getODataModel();
      var oData = oCtx.getObject();
      FormDialog.open({
        view: this.getView(), editing: true, title: "Edit stock - " + oData.assetType.name,
        data: { assetType_ID: oData.assetType_ID, warehouse_ID: oData.warehouse_ID, totalOwned: oData.totalOwned, atCustomer: oData.atCustomer,
          damaged: oData.damaged, scrapped: oData.scrapped, safetyStock: oData.safetyStock },
        fields: this._stockFields(true),
        onSubmit: async function (v) {
          try {
            var a = [];
            ["totalOwned", "atCustomer", "damaged", "scrapped", "safetyStock"].forEach(function (p) {
              if (v[p] !== undefined && v[p] !== oData[p]) { a.push(oCtx.setProperty(p, v[p], GROUP)); }
            });
            await Promise.all(a.concat(oModel.submitBatch(GROUP)));
            that.toast("Stock record updated"); that.refreshAll();
          } catch (e) { oModel.resetChanges(GROUP); throw e; }
        }
      });
    },
    _stockFields: function (bEdit) {
      return [
        { name: "assetType_ID", label: "Asset type", type: "select", entity: "AssetTypes", itemText: "{code} - {name}", required: true, lockOnEdit: true },
        { name: "warehouse_ID", label: "Warehouse", type: "select", entity: "Warehouses", itemText: "{code} - {name}", required: true, lockOnEdit: true },
        { name: "totalOwned", label: "Total owned", type: "int", required: true },
        { name: "atCustomer", label: "At customer (adjustment)", type: "int", lockOnEdit: false },
        { name: "damaged", label: "Damaged / under repair", type: "int" },
        { name: "scrapped", label: "Scrapped", type: "int" },
        { name: "safetyStock", label: "Safety stock threshold", type: "int", required: true }
      ].filter(function (f) { return bEdit || ["atCustomer", "damaged", "scrapped"].indexOf(f.name) < 0; });
    },

    /* ---- replenishment ---- */
    onRequisition: function (oEvent) {
      var that = this, o = oEvent.getSource().getBindingContext().getObject();
      FormDialog.open({
        view: this.getView(), title: "Replenishment request - " + o.assetType.name, submitText: "Create",
        data: { quantity: o.shortfall + o.safetyStock },
        fields: [
          { name: "quantity", label: "Quantity (shortfall " + o.shortfall + " + safety stock)", type: "int", required: true },
          { name: "remarks", label: "Remarks", type: "textarea" }
        ],
        onSubmit: async function (v) {
          v.assetType_ID = o.assetType_ID; v.warehouse_ID = o.warehouse_ID;
          var r = await Backend.action(that.getODataModel(), "createReplenishmentRequest", v);
          that.toast("Request " + r.requestNo + " created (internal; not posted to S/4HANA)");
          that.refreshAll();
        }
      });
    },
    onReceive: function (oEvent) {
      var that = this, oCtx = oEvent.getSource().getBindingContext();
      this.confirm("Confirm goods receipt of " + oCtx.getProperty("quantity") + " units? Stock will be increased.", async function () {
        try {
          await Backend.action(that.getODataModel(), "receiveReplenishment", { request_ID: oCtx.getProperty("ID") });
          that.toast("Receipt posted - stock updated"); that.refreshAll();
        } catch (e) { that.error(e); }
      });
    }
  });
});
