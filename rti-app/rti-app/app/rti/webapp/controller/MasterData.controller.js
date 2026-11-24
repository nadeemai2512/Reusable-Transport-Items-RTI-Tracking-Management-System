sap.ui.define([
  "rti/app/controller/BaseController", "sap/m/MessageBox", "rti/app/util/FormDialog", "rti/app/util/Backend"
], function (BaseController, MessageBox, FormDialog, Backend) {
  "use strict";

  var GROUP = "rtiGroup";
  var OPT = function (entity) { return { type: "select", entity: entity, itemText: "{code} - {name}" }; };

  /** Field definitions per entity - names are taken from db/schema.cds / srv/rti-service.cds. */
  var CFG = {
    Customers: { title: "Customer", fields: [
      { name: "code", label: "Code", type: "text", required: true },
      { name: "name", label: "Name", type: "text", required: true },
      { name: "city", label: "City", type: "text" }, { name: "country", label: "Country", type: "text" },
      { name: "defaultGraceDays", label: "Grace days (override)", type: "int" },
      { name: "active", label: "Active", type: "bool" }], defaults: { active: true } },
    AssetTypes: { title: "Asset type", fields: [
      { name: "code", label: "Code", type: "text", required: true },
      { name: "name", label: "Name", type: "text", required: true },
      { name: "category", label: "Category", type: "text" },
      { name: "serialized", label: "Serialized", type: "bool" },
      { name: "uom", label: "Unit of measure", type: "text" },
      { name: "purchaseValue", label: "Purchase value", type: "decimal" },
      { name: "replacementValue", label: "Replacement value", type: "decimal" },
      { name: "defaultGraceDays", label: "Default grace days", type: "int" },
      { name: "active", label: "Active", type: "bool" }], defaults: { active: true, uom: "EA", defaultGraceDays: 30 } },
    Warehouses: { title: "Warehouse", fields: [
      { name: "code", label: "Code", type: "text", required: true }, { name: "name", label: "Name", type: "text", required: true },
      { name: "plant", label: "Plant", type: "text" }, { name: "city", label: "City", type: "text" }], defaults: {} },
    Assets: { title: "Serialized asset", fields: [
      { name: "serialNo", label: "Serial no.", type: "text", required: true },
      Object.assign({ name: "assetType_ID", label: "Asset type", required: true }, OPT("AssetTypes")),
      { name: "qrCode", label: "QR code", type: "scan" }, { name: "barcode", label: "Barcode", type: "scan" }, { name: "rfidTag", label: "RFID tag", type: "text" },
      Object.assign({ name: "currentWarehouse_ID", label: "Warehouse" }, OPT("Warehouses")),
      { name: "purchaseDate", label: "Purchase date", type: "date" }, { name: "purchaseValue", label: "Purchase value", type: "decimal" }], defaults: { status: "AVAILABLE" } },
    PenaltyPolicies: { title: "Penalty slab", fields: [
      Object.assign({ name: "assetType_ID", label: "Asset type (blank = all)" }, OPT("AssetTypes")),
      Object.assign({ name: "customer_ID", label: "Customer (blank = all)" }, OPT("Customers")),
      { name: "fromDay", label: "From overdue day", type: "int", required: true }, { name: "toDay", label: "To overdue day", type: "int", required: true },
      { name: "rate", label: "Rate per unit per day", type: "decimal", required: true },
      { name: "currency", label: "Currency", type: "text" }, { name: "effectiveFrom", label: "Effective from", type: "date" }], defaults: { currency: "INR" } },
    Settings: { title: "Setting", fields: [
      { name: "code", label: "Setting", type: "text", lockOnEdit: true }, { name: "value", label: "Value", type: "text", required: true }], defaults: {} }
  };

  return BaseController.extend("rti.app.controller.MasterData", {
    onInit: function () {
      this.onMatched("masterdata", null, function () { this._load(this.byId("tabs").getSelectedKey() || "Customers"); });
    },
    onTabSelect: function (e) { this._load(e.getParameter("key")); },
    _load: function (sKey) {
      var t = this.byId("t_" + sKey);
      if (!t) { return; }
      var b = t.getBinding("items");
      if (b.isSuspended()) { b.resume(); } else { b.refresh(); }
    },
    _entity: function (oEvent) { return oEvent.getSource().data("cfg"); },

    /** CREATE: POST is sent only on Save (deferred group), then lists refresh from the backend. */
    onAdd: function (oEvent) {
      var that = this, sEntity = this._entity(oEvent), c = CFG[sEntity], oModel = this.getODataModel();
      var oBinding = this.byId("t_" + sEntity).getBinding("items");
      FormDialog.open({
        view: this.getView(), title: "New " + c.title, data: Object.assign({}, c.defaults), fields: c.fields,
        onSubmit: async function (v) {
          var oData = {};
          Object.keys(v).forEach(function (k) { if (v[k] !== undefined) { oData[k] = v[k]; } });
          Object.keys(c.defaults).forEach(function (k) { if (oData[k] === undefined) { oData[k] = c.defaults[k]; } });
          var oCtx = oBinding.create(oData, true);
          try {
            await Promise.all([oCtx.created(), oModel.submitBatch(GROUP)]);
          } catch (e) {
            if (oCtx.isTransient && oCtx.isTransient()) { oCtx.delete(); }
            oModel.resetChanges(GROUP);
            throw e;
          }
          that.toast(c.title + " created");
          that.refreshAll();
        }
      });
    },

    /** UPDATE: PATCH only the changed properties. */
    onEdit: function (oEvent) {
      var that = this, sEntity = this._entity(oEvent), c = CFG[sEntity], oModel = this.getODataModel();
      var oCtx = oEvent.getSource().getBindingContext(), oData = oCtx.getObject();
      FormDialog.open({
        view: this.getView(), editing: true, title: "Edit " + c.title, data: Object.assign({}, oData), fields: c.fields,
        onSubmit: async function (v) {
          var a = [];
          c.fields.forEach(function (f) {
            if (f.lockOnEdit) { return; }
            var nv = v[f.name], ov = oData[f.name];
            if ((nv === undefined ? null : nv) !== (ov === undefined ? null : ov)) { a.push(oCtx.setProperty(f.name, nv === undefined ? null : nv, GROUP)); }
          });
          if (!a.length) { return; }
          try { await Promise.all(a.concat(oModel.submitBatch(GROUP))); }
          catch (e) { oModel.resetChanges(GROUP); throw e; }
          that.toast(c.title + " updated");
          that.refreshAll();
        }
      });
    },

    /** DELETE with confirmation. Backend rejects the delete if the record is still referenced. */
    onDelete: function (oEvent) {
      var that = this, sEntity = this._entity(oEvent), oCtx = oEvent.getSource().getBindingContext();
      MessageBox.confirm("Delete this " + CFG[sEntity].title.toLowerCase() + "? This cannot be undone.", {
        actions: [MessageBox.Action.DELETE, MessageBox.Action.CANCEL], emphasizedAction: MessageBox.Action.DELETE,
        onClose: async function (a) {
          if (a !== MessageBox.Action.DELETE) { return; }
          try { await oCtx.delete("$auto"); that.toast(CFG[sEntity].title + " deleted"); that.refreshAll(); }
          catch (e) { that.error(e); }
        }
      });
    }
  });
});
