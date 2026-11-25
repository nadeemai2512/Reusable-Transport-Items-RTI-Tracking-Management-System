sap.ui.define([
  "rti/app/controller/BaseController", "sap/ui/model/Filter", "sap/ui/model/FilterOperator",
  "rti/app/util/FormDialog", "rti/app/util/Backend"
], function (BaseController, Filter, FilterOperator, FormDialog, Backend) {
  "use strict";

  return BaseController.extend("rti.app.controller.Waivers", {
    onInit: function () {
      this.onMatched("waivers", "penalties", function () { this.byId("table").getBinding("items").refresh(); });
    },
    onFilter: function () {
      var s = this.byId("statusFilter").getSelectedKey();
      this.byId("table").getBinding("items").filter(s ? new Filter("status", FilterOperator.EQ, s) : []);
    },
    onRefresh: function () { this.byId("table").getBinding("items").refresh(); },
    onDecide: function (oEvent) {
      var that = this, oBtn = oEvent.getSource();
      var bApprove = oBtn.data("approve") === "true" || oBtn.data("approve") === true;
      var ctx = oBtn.getBindingContext();
      FormDialog.open({
        view: this.getView(), title: (bApprove ? "Approve" : "Reject") + " waiver " + ctx.getProperty("requestNo"),
        submitText: bApprove ? "Approve" : "Reject", data: {},
        fields: [{ name: "comment", label: "Comment", type: "textarea", required: !bApprove }],
        onSubmit: async function (v) {
          await Backend.action(that.getODataModel(), "decideWaiver", { request_ID: ctx.getProperty("ID"), approve: bApprove, comment: v.comment });
          that.toast("Waiver " + (bApprove ? "approved" : "rejected"));
          that.refreshAll();
        }
      });
    }
  });
});
