sap.ui.define([
  "rti/app/controller/BaseController", "sap/ui/model/Filter", "sap/ui/model/FilterOperator"
], function (BaseController, Filter, FilterOperator) {
  "use strict";

  return BaseController.extend("rti.app.controller.Ledger", {
    onInit: function () {
      this.onMatched("ledger", null, function () { this.byId("t_ledger").getBinding("items").refresh(); });
    },
    onFilter: function () {
      var a = [], s = this.byId("typeFilter").getSelectedKey();
      if (s) { a.push(new Filter("type", FilterOperator.EQ, s)); }
      var q = this.byId("search").getValue().trim();
      if (q) {
        a.push(new Filter({ and: false, filters: [
          new Filter("reference", FilterOperator.Contains, q),
          new Filter("customer/name", FilterOperator.Contains, q),
          new Filter("asset/serialNo", FilterOperator.Contains, q)] }));
      }
      this.byId("t_ledger").getBinding("items").filter(a);
    },
    onRefresh: function () { this.byId("t_ledger").getBinding("items").refresh(); }
  });
});
