sap.ui.define([
  "rti/app/controller/BaseController", "sap/m/MessageBox", "rti/app/util/FormDialog",
  "sap/ui/model/Filter", "sap/ui/model/FilterOperator"
], function (BaseController, MessageBox, FormDialog, Filter, FilterOperator) {
  "use strict";

  var GROUP = "rtiGroup";

  return BaseController.extend("rti.app.controller.Warehouse", {
    onInit: function () {
      this.onMatched("warehouse", null, function () { this._load(this.byId("tabs").getSelectedKey() || "occupancy"); });
    },
    onTabSelect: function (e) { this._load(e.getParameter("key")); },
    _load: function (sKey) {
      var id = { occupancy: "occTable", warehouses: "whTable", carriers: "carrTable" }[sKey];
      if (!id) { return; }
      var b = this.byId(id).getBinding("items");
      if (b) { b.refresh(); }
    },
    onRefresh: function () { this.getODataModel().refresh(); },
    onOccSearch: function () {
      var q = this.byId("occSearch").getValue().trim();
      this.byId("occTable").getBinding("items").filter(q ? new Filter({ and: false, filters: [
        new Filter("warehouse/name", FilterOperator.Contains, q), new Filter("assetType/name", FilterOperator.Contains, q)] }) : []);
    },

    /* ---- warehouse CRUD ---- */
    _whFields: function () {
      return [
        { name: "code", label: "Code", type: "text", required: true },
        { name: "name", label: "Name", type: "text", required: true },
        { name: "plant", label: "Plant", type: "text" },
        { name: "city", label: "City", type: "text" }
      ];
    },
    onAddWh: function () {
      var that = this, oBinding = this.byId("whTable").getBinding("items"), oModel = this.getODataModel();
      FormDialog.open({
        view: this.getView(), title: "New warehouse", data: {}, fields: this._whFields(),
        onSubmit: async function (v) {
          var oCtx = oBinding.create(v, true);
          try { await Promise.all([oCtx.created(), oModel.submitBatch(GROUP)]); that.toast("Warehouse created"); that.refreshAll(); }
          catch (e) { if (oCtx.isTransient && oCtx.isTransient()) { oCtx.delete(); } oModel.resetChanges(GROUP); throw e; }
        }
      });
    },
    onEditWh: function (oEvent) {
      var that = this, oCtx = oEvent.getSource().getBindingContext(), oModel = this.getODataModel(), oData = oCtx.getObject();
      FormDialog.open({
        view: this.getView(), editing: true, title: "Edit warehouse", data: Object.assign({}, oData), fields: this._whFields(),
        onSubmit: async function (v) {
          var a = [];
          that._whFields().forEach(function (f) {
            var nv = v[f.name], ov = oData[f.name];
            if ((nv === undefined ? null : nv) !== (ov === undefined ? null : ov)) { a.push(oCtx.setProperty(f.name, nv === undefined ? null : nv, GROUP)); }
          });
          if (!a.length) { return; }
          try { await Promise.all(a.concat(oModel.submitBatch(GROUP))); that.toast("Warehouse updated"); that.refreshAll(); }
          catch (e) { oModel.resetChanges(GROUP); throw e; }
        }
      });
    },
    onDeleteWh: function (oEvent) {
      var that = this, oCtx = oEvent.getSource().getBindingContext();
      MessageBox.confirm("Delete this warehouse? This cannot be undone.", {
        actions: [MessageBox.Action.DELETE, MessageBox.Action.CANCEL], emphasizedAction: MessageBox.Action.DELETE,
        onClose: async function (a) {
          if (a !== MessageBox.Action.DELETE) { return; }
          try { await oCtx.delete("$auto"); that.toast("Warehouse deleted"); that.refreshAll(); }
          catch (e) { that.error(e); }
        }
      });
    },

    /* ---- carrier CRUD ---- */
    _carrFields: function () {
      return [
        { name: "code", label: "Code", type: "text", required: true },
        { name: "name", label: "Name", type: "text", required: true },
        { name: "contact", label: "Contact", type: "text" },
        { name: "active", label: "Active", type: "bool" }
      ];
    },
    onAddCarr: function () {
      var that = this, oBinding = this.byId("carrTable").getBinding("items"), oModel = this.getODataModel();
      FormDialog.open({
        view: this.getView(), title: "New carrier", data: { active: true }, fields: this._carrFields(),
        onSubmit: async function (v) {
          var oCtx = oBinding.create(v, true);
          try { await Promise.all([oCtx.created(), oModel.submitBatch(GROUP)]); that.toast("Carrier created"); that.refreshAll(); }
          catch (e) { if (oCtx.isTransient && oCtx.isTransient()) { oCtx.delete(); } oModel.resetChanges(GROUP); throw e; }
        }
      });
    },
    onEditCarr: function (oEvent) {
      var that = this, oCtx = oEvent.getSource().getBindingContext(), oModel = this.getODataModel(), oData = oCtx.getObject();
      FormDialog.open({
        view: this.getView(), editing: true, title: "Edit carrier", data: Object.assign({}, oData), fields: this._carrFields(),
        onSubmit: async function (v) {
          var a = [];
          that._carrFields().forEach(function (f) {
            var nv = v[f.name], ov = oData[f.name];
            if ((nv === undefined ? null : nv) !== (ov === undefined ? null : ov)) { a.push(oCtx.setProperty(f.name, nv === undefined ? null : nv, GROUP)); }
          });
          if (!a.length) { return; }
          try { await Promise.all(a.concat(oModel.submitBatch(GROUP))); that.toast("Carrier updated"); that.refreshAll(); }
          catch (e) { oModel.resetChanges(GROUP); throw e; }
        }
      });
    },
    onDeleteCarr: function (oEvent) {
      var that = this, oCtx = oEvent.getSource().getBindingContext();
      MessageBox.confirm("Delete this carrier? This cannot be undone.", {
        actions: [MessageBox.Action.DELETE, MessageBox.Action.CANCEL], emphasizedAction: MessageBox.Action.DELETE,
        onClose: async function (a) {
          if (a !== MessageBox.Action.DELETE) { return; }
          try { await oCtx.delete("$auto"); that.toast("Carrier deleted"); that.refreshAll(); }
          catch (e) { that.error(e); }
        }
      });
    }
  });
});
