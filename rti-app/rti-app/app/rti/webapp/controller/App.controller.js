sap.ui.define(["rti/app/controller/BaseController"], function (BaseController) {
  "use strict";

  var ROUTE_TO_NAV = { dispatchDetail: "dispatches" };

  return BaseController.extend("rti.app.controller.App", {
    onInit: function () {
      // keep side navigation in sync with the current route (also on browser refresh / back)
      this.getAppRouter().attachRouteMatched(function (oEvent) {
        var sName = oEvent.getParameter("name");
        this.byId("sideNav").setSelectedKey(ROUTE_TO_NAV[sName] || sName);
      }, this);
    },
    onToggleSide: function () {
      var oPage = this.byId("toolPage");
      oPage.setSideExpanded(!oPage.getSideExpanded());
    },
    onNavSelect: function (oEvent) {
      this.navTo(oEvent.getParameter("item").getKey());
    },
    onRefreshAll: function () {
      this.getODataModel().refresh();
      this.getOwnerComponent().getEventBus().publish("rti", "refresh");   // dashboard reloads its KPIs
      this.toast("Data reloaded from backend");
    }
  });
});
