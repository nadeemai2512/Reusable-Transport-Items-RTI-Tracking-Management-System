sap.ui.define([
  "rti/app/controller/BaseController", "sap/ui/model/Filter", "sap/ui/model/FilterOperator"
], function (BaseController, Filter, FilterOperator) {
  "use strict";

  return BaseController.extend("rti.app.controller.Aging", {
    onInit: function () {
      this.onMatched("aging", null, function () {
        // Only show outstanding dispatches on this page (closed ones have nothing to age).
        this.byId("bucketFilter").setSelectedKey("");
        this.byId("search").setValue("");
        this.onFilter();
      });
    },

    /** Aging buckets are derived client-side from dispatchDate + graceEndDate using $filter on the backend. */
    onFilter: function () {
      var a = [], t = this.today(), bucket = this.byId("bucketFilter").getSelectedKey();
      // Always exclude fully closed dispatches on the aging view.
      a.push(new Filter("outstanding", FilterOperator.GT, 0));
      if (bucket === "0-30") { a.push(new Filter("dispatchDate", FilterOperator.GE, this._addDays(t, -30))); }
      if (bucket === "31-60") { a.push(new Filter("dispatchDate", FilterOperator.BT, this._addDays(t, -60), this._addDays(t, -31))); }
      if (bucket === "61+") { a.push(new Filter("dispatchDate", FilterOperator.LE, this._addDays(t, -61))); }
      if (bucket === "overdue") { a.push(new Filter("status", FilterOperator.NE, "CLOSED"), new Filter("graceEndDate", FilterOperator.LT, t)); }
      if (bucket === "presumed") { a.push(new Filter("status", FilterOperator.EQ, "PRESUMED_LOST")); }
      var q = this.byId("search").getValue().trim();
      if (q) {
        a.push(new Filter({ and: false, filters: [
          new Filter("dispatchNo", FilterOperator.Contains, q), new Filter("customer/name", FilterOperator.Contains, q)] }));
      }
      this.byId("table").getBinding("items").filter(a);
    },

    _addDays: function (sDate, n) {
      var d = new Date(sDate + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    },

    onRefresh: function () { this.byId("table").getBinding("items").refresh(); },
    onOpen: function (oEvent) {
      this.navTo("dispatchDetail", { id: oEvent.getSource().getBindingContext().getProperty("ID") });
    }
  });
});
