sap.ui.define([
  "rti/app/controller/BaseController", "sap/ui/model/Filter", "sap/ui/model/FilterOperator"
], function (BaseController, Filter, FilterOperator) {
  "use strict";

  return BaseController.extend("rti.app.controller.Inspection", {
    onInit: function () {
      this.onMatched("inspection", null, function () { this.byId("table").getBinding("items").refresh(); });
    },
    onFilter: function () {
      var s = this.byId("condFilter").getSelectedKey();
      this.byId("table").getBinding("items").filter(s ? new Filter("condition", FilterOperator.EQ, s) : []);
    },
    onSearch: function () {
      var q = this.byId("search").getValue().trim();
      this.byId("table").getBinding("items").filter(q ? new Filter({ and: false, filters: [
        new Filter("returnNo", FilterOperator.Contains, q), new Filter("customer/name", FilterOperator.Contains, q)] }) : []);
    },
    onRefresh: function () { this.byId("table").getBinding("items").refresh(); }
  });
});
