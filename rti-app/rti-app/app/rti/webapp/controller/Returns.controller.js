sap.ui.define([
  "rti/app/controller/BaseController", "sap/ui/model/Filter", "sap/ui/model/FilterOperator",
  "rti/app/util/FormDialog", "rti/app/util/Backend"
], function (BaseController, Filter, FilterOperator, FormDialog, Backend) {
  "use strict";

  return BaseController.extend("rti.app.controller.Returns", {
    onInit: function () {
      this.onMatched("returns", null, function () { this.byId("table").getBinding("items").refresh(); });
    },
    onSearch: function () {
      var q = this.byId("search").getValue().trim();
      this.byId("table").getBinding("items").filter(q ? new Filter({ and: false, filters: [
        new Filter("returnNo", FilterOperator.Contains, q), new Filter("customer/name", FilterOperator.Contains, q),
        new Filter("dispatch/dispatchNo", FilterOperator.Contains, q)] }) : []);
    },
    onRefresh: function () { this.byId("table").getBinding("items").refresh(); },
    onOpenDispatch: function (oEvent) {
      this.navTo("dispatchDetail", { id: oEvent.getSource().getBindingContext().getProperty("dispatch_ID") });
    },
    onNew: function () {
      var that = this;
      FormDialog.open({
        view: this.getView(), title: "Register Inbound Return", submitText: "Register",
        data: { quantity: 1, condition: "GOOD", returnDate: this.today() },
        fields: [
          { name: "dispatch_ID", label: "Original dispatch", type: "select", entity: "Dispatches", required: true,
            itemText: "{dispatchNo} (outstanding {outstanding})", filters: [new Filter("status", FilterOperator.NE, "CLOSED")] },
          { name: "quantity", label: "Returned quantity", type: "int", required: true },
          { name: "condition", label: "Inspection result", type: "select", required: true, options: [
            { key: "GOOD", text: "Good - back to available stock" }, { key: "MINOR_DAMAGE", text: "Minor damage - repair queue" }, { key: "SCRAP", text: "Scrap - write off" }] },
          { name: "serialNo", label: "Serial / QR / barcode", type: "scan" },
          { name: "returnDate", label: "Return date", type: "date" },
          { name: "remarks", label: "Remarks", type: "textarea" }
        ],
        onSubmit: async function (v) {
          var r = await Backend.action(that.getODataModel(), "registerReturn", v);
          that.toast("Return " + r.returnNo + " registered");
          that.refreshAll();
        }
      });
    }
  });
});
