sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/model/json/JSONModel",
  "rti/app/util/Backend"
], function (UIComponent, JSONModel, Backend) {
  "use strict";

  return UIComponent.extend("rti.app.Component", {
    metadata: { manifest: "json", interfaces: ["sap.ui.core.IAsyncContentCreation"] },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);
      this.setModel(new JSONModel({ id: "", roles: [], can: {} }), "me");
      // Resolved once the backend told us who the user is; controllers wait for it before guarding routes.
      this.meReady = this._loadMe();
      this.getRouter().initialize();
    },

    /** Loads the user's identity + roles from the CAP service and derives UI permissions (backend still enforces). */
    _loadMe: async function () {
      var oMe = this.getModel("me");
      try {
        var d = await Backend.fn(this.getModel(), "me");
        var roles = d.roles || [];
        var has = function () { return Array.prototype.slice.call(arguments).some(function (r) { return roles.indexOf(r) >= 0; }); };
        oMe.setData({
          id: d.id, roles: roles,
          can: {
            master: has("LogisticsHead", "Admin"),
            customers: has("LogisticsManager", "LogisticsHead", "Admin"),
            assets: has("WarehouseOperator", "LogisticsHead", "Admin"),
            dispatch: has("WarehouseOperator", "LogisticsHead", "Admin"),
            penalties: has("LogisticsManager", "LogisticsHead", "Admin"),
            runEngine: has("LogisticsHead", "Admin"),
            waiverRequest: has("LogisticsManager", "LogisticsHead", "Admin"),
            waiverDecide: has("LogisticsHead", "Admin"),
            stockEdit: has("InventoryPlanner", "LogisticsHead", "Admin"),
            alerts: has("InventoryPlanner", "LogisticsHead", "Admin"),
            plan: has("InventoryPlanner", "Admin"),
            audit: has("LogisticsHead", "Admin")
          }
        });
      } catch (e) {
        oMe.setProperty("/error", Backend.errText(e));
      }
    }
  });
});
