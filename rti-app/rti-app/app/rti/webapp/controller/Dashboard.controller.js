sap.ui.define([
  "rti/app/controller/BaseController", "sap/ui/model/json/JSONModel", "rti/app/util/Backend"
], function (BaseController, JSONModel, Backend) {
  "use strict";

  return BaseController.extend("rti.app.controller.Dashboard", {
    onInit: function () {
      this.getView().setModel(new JSONModel({}), "dash");
      this.getView().setModel(new JSONModel({ error: "" }), "view");
      this.onMatched("dashboard", null, this.load);
      this.getOwnerComponent().getEventBus().subscribe("rti", "refresh", this.load, this);
    },

    onExit: function () {
      this.getOwnerComponent().getEventBus().unsubscribe("rti", "refresh", this.load, this);
    },

    formatMoney: function (v) {
      return v === null || v === undefined ? "" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });
    },

    /** KPIs and chart data are calculated by the CAP service function getDashboard(). */
    load: async function () {
      var oPage = this.byId("page");
      oPage.setBusy(true);
      this.getView().getModel("view").setProperty("/error", "");
      try {
        var d = await Backend.fn(this.getODataModel(), "getDashboard");
        this.getView().getModel("dash").setData(d);
        ["recentDispatches", "recentReturns"].forEach(function (id) {
          var b = this.byId(id).getBinding("items");
          if (b) { b.refresh(); }
        }, this);
      } catch (e) {
        this.getView().getModel("view").setProperty("/error", "Could not load dashboard: " + Backend.errText(e));
      } finally {
        oPage.setBusy(false);
      }
    },

    onRefresh: function () { this.load(); },

    /** KPI tiles navigate to the detail page with the relevant filter. */
    onTile: function (oEvent) {
      var oTile = oEvent.getSource(), q = {};
      var sRoute = oTile.data("route");
      if (oTile.data("filter")) { q.filter = oTile.data("filter"); }
      if (oTile.data("tab")) { q.tab = oTile.data("tab"); }
      this.navTo(sRoute, {}, Object.keys(q).length ? q : undefined);
    },

    onOpenDispatch: function (oEvent) {
      this.navTo("dispatchDetail", { id: oEvent.getSource().getBindingContext().getProperty("ID") });
    }
  });
});
