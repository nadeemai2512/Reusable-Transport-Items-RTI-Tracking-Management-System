sap.ui.define([
  "rti/app/controller/BaseController", "sap/ui/model/Filter", "sap/ui/model/FilterOperator", "sap/m/MessageBox",
  "rti/app/util/FormDialog", "rti/app/util/Backend"
], function (BaseController, Filter, FilterOperator, MessageBox, FormDialog, Backend) {
  "use strict";

  return BaseController.extend("rti.app.controller.Penalties", {
    onInit: function () {
      this.onMatched("penalties", "penalties", function () { this.byId("table").getBinding("items").refresh(); });
    },
    onSearch: function () {
      var q = this.byId("search").getValue().trim();
      this.byId("table").getBinding("items").filter(q ? new Filter({ and: false, filters: [
        new Filter("customer/name", FilterOperator.Contains, q), new Filter("dispatch/dispatchNo", FilterOperator.Contains, q)] }) : []);
    },
    onRefresh: function () { this.byId("table").getBinding("items").refresh(); },
    onOpenDispatch: function (oEvent) {
      this.navTo("dispatchDetail", { id: oEvent.getSource().getBindingContext().getProperty("dispatch_ID") });
    },

    onRun: function () {
      var that = this;
      this.confirm("Recalculate aging and penalties for all open dispatches as of today? The run is idempotent and can be repeated safely.", async function () {
        that.byId("page").setBusy(true);
        try {
          var r = await Backend.action(that.getODataModel(), "runPenaltyEngine", { asOf: that.today() });
          that.toast("Engine finished: " + r.processed + " dispatches, " + r.presumedLost + " presumed lost");
          that.refreshAll();
        } catch (e) { that.error(e); } finally { that.byId("page").setBusy(false); }
      });
    },

    onWaiver: function (oEvent) {
      var that = this, ctx = oEvent.getSource().getBindingContext();
      var net = ctx.getProperty("netPayable");
      FormDialog.open({
        view: this.getView(), title: "Request Penalty Waiver - " + ctx.getProperty("dispatch/dispatchNo"), submitText: "Submit",
        data: {},
        fields: [
          { name: "amount", label: "Waiver amount (max " + net + ")", type: "decimal", required: true },
          { name: "reasonCode", label: "Reason code", type: "select", required: true, options: [
            { key: "DISPUTE", text: "Customer dispute" }, { key: "CARRIER_DELAY", text: "Carrier delay" }, { key: "QUALITY_ISSUE", text: "Quality issue" },
            { key: "GOODWILL", text: "Goodwill" }, { key: "OTHER", text: "Other" }] },
          { name: "comments", label: "Explanation", type: "textarea", required: true }
        ],
        onSubmit: async function (v) {
          v.penalty_ID = ctx.getProperty("ID");
          var r = await Backend.action(that.getODataModel(), "requestWaiver", v);
          that.toast(r.status === "APPROVED" ? "Waiver approved (within threshold)" : "Waiver sent to Logistics Head for approval");
          that.refreshAll();
        }
      });
    }
  });
});
