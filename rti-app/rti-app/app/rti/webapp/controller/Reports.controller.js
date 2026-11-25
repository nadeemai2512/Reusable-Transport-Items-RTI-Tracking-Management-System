sap.ui.define([
  "rti/app/controller/BaseController", "sap/ui/model/json/JSONModel", "rti/app/util/Backend"
], function (BaseController, JSONModel, Backend) {
  "use strict";

  return BaseController.extend("rti.app.controller.Reports", {
    onInit: function () {
      this.getView().setModel(new JSONModel({}), "rep");
      this.getView().setModel(new JSONModel({ error: "" }), "view");
      this.onMatched("reports", null, this.load);
    },

    /** All report figures are computed by the CAP service function getReports(asOf). */
    load: async function () {
      var oPage = this.byId("page");
      oPage.setBusy(true);
      this.getView().getModel("view").setProperty("/error", "");
      try {
        var d = await Backend.fn(this.getODataModel(), "getReports", { asOf: this.today() });
        this.getView().getModel("rep").setData(d);
      } catch (e) {
        this.getView().getModel("view").setProperty("/error", "Could not load reports: " + Backend.errText(e));
      } finally {
        oPage.setBusy(false);
      }
    },
    onRefresh: function () { this.load(); }
  });
});
