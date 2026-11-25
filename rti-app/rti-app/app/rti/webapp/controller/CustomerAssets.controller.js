sap.ui.define([
  "rti/app/controller/BaseController", "sap/ui/model/Filter", "sap/ui/model/FilterOperator"
], function (BaseController, Filter, FilterOperator) {
  "use strict";

  return BaseController.extend("rti.app.controller.CustomerAssets", {
    onInit: function () {
      this.onMatched("customerAssets", null, function () { this.byId("table").getBinding("items").refresh(); });
    },
    onSearch: function () {
      var q = this.byId("search").getValue().trim();
      this.byId("table").getBinding("items").filter(q ? new Filter({ and: false, filters: [
        new Filter("customer/name", FilterOperator.Contains, q), new Filter("assetType/name", FilterOperator.Contains, q)] }) : []);
    },
    onRefresh: function () { this.byId("table").getBinding("items").refresh(); }
  });
});
