sap.ui.define([
  "rti/app/controller/BaseController", "sap/ui/model/Filter", "sap/ui/model/FilterOperator"
], function (BaseController, Filter, FilterOperator) {
  "use strict";

  return BaseController.extend("rti.app.controller.Audit", {
    onInit: function () {
      this.onMatched("audit", "audit", function () { this.byId("table").getBinding("items").refresh(); });
    },
    onFilter: function () {
      var a = [], s = this.byId("actionFilter").getSelectedKey();
      if (s) { a.push(new Filter("action", FilterOperator.EQ, s)); }
      var q = this.byId("search").getValue().trim();
      if (q) {
        a.push(new Filter({ and: false, filters: [
          new Filter("userId", FilterOperator.Contains, q),
          new Filter("entityType", FilterOperator.Contains, q),
          new Filter("entityId", FilterOperator.Contains, q),
          new Filter("comments", FilterOperator.Contains, q)] }));
      }
      this.byId("table").getBinding("items").filter(a);
    },
    onRefresh: function () { this.byId("table").getBinding("items").refresh(); }
  });
});
