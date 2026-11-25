sap.ui.define([
  "sap/ui/core/mvc/Controller", "sap/ui/core/UIComponent", "sap/m/MessageToast", "sap/m/MessageBox",
  "rti/app/util/Backend", "rti/app/util/formatter"
], function (Controller, UIComponent, MessageToast, MessageBox, Backend, formatter) {
  "use strict";

  return Controller.extend("rti.app.controller.BaseController", {
    formatter: formatter,

    /** Router of the owning component (the standard way - never this.getRouter() in a plain Controller). */
    getAppRouter: function () { return UIComponent.getRouterFor(this); },
    getODataModel: function () { return this.getOwnerComponent().getModel(); },
    getMe: function () { return this.getOwnerComponent().getModel("me"); },

    /**
     * Attach a route handler that first waits for the user's roles and blocks unauthorized screens.
     * (The backend enforces authorization independently - this only avoids opening screens that would fail.)
     */
    onMatched: function (sRoute, sPermission, fnHandler) {
      this.getAppRouter().getRoute(sRoute).attachPatternMatched(async function (oEvent) {
        await this.getOwnerComponent().meReady;
        if (sPermission && !this.getMe().getProperty("/can/" + sPermission)) {
          MessageBox.error("You are not authorized to open this screen.");
          this.getAppRouter().navTo("dashboard", {}, true);
          return;
        }
        fnHandler.call(this, oEvent);
      }, this);
    },

    navTo: function (sRoute, mArgs, mQuery) { this.getAppRouter().navTo(sRoute, mArgs || {}, mQuery); },
    onNavBack: function () { this.navTo("dashboard"); },
    toast: function (s) { MessageToast.show(s); },
    error: function (e) { MessageBox.error(Backend.errText(e)); },

    /** Refresh all OData bindings after a successful write (lists, details). */
    refreshAll: function () {
      var oModel = this.getODataModel();
      if (!oModel.hasPendingChanges()) { oModel.refresh(); }
    },

    confirm: function (sText, fnYes) {
      MessageBox.confirm(sText, {
        actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL], emphasizedAction: MessageBox.Action.OK,
        onClose: function (a) { if (a === MessageBox.Action.OK) { fnYes(); } }
      });
    },

    today: function () { return new Date().toISOString().slice(0, 10); }
  });
});
