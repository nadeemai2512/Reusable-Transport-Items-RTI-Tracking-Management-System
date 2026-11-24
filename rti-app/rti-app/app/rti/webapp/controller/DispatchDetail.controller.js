sap.ui.define([
  "rti/app/controller/BaseController", "sap/ui/model/Filter", "sap/ui/model/FilterOperator", "sap/m/MessageBox",
  "rti/app/util/FormDialog", "rti/app/util/Backend"
], function (BaseController, Filter, FilterOperator, MessageBox, FormDialog, Backend) {
  "use strict";

  return BaseController.extend("rti.app.controller.DispatchDetail", {
    onInit: function () {
      this.onMatched("dispatchDetail", null, function (oEvent) {
        // the record is always loaded from the backend using the route parameter (works after browser refresh)
        this._id = oEvent.getParameter("arguments").id;
        var oView = this.getView();
        oView.bindElement({
          path: "/Dispatches(" + this._id + ")",
          events: {
            dataRequested: function () { oView.setBusy(true); },
            dataReceived: function (e) {
              oView.setBusy(false);
              if (e.getParameter("error")) {
                MessageBox.error("Dispatch could not be loaded: " + Backend.errText(e.getParameter("error")));
                this.navTo("dispatches", {}, true);
              }
            }.bind(this)
          }
        });
        var oBinding = this.byId("returns").getBinding("items");
        oBinding.filter(new Filter("dispatch_ID", FilterOperator.EQ, this._id));
        oBinding.resume();
      });
    },

    onBack: function () { this.navTo("dispatches"); },

    onRefresh: function () {
      this.getView().getElementBinding().refresh();
      this.byId("returns").getBinding("items").refresh();
    },

    onReturn: function () {
      var that = this, ctx = this.getView().getBindingContext();
      FormDialog.open({
        view: this.getView(), title: "Register Return - " + ctx.getProperty("dispatchNo"), submitText: "Register",
        data: { quantity: 1, condition: "GOOD", returnDate: this.today() },
        fields: [
          { name: "quantity", label: "Returned quantity (max " + ctx.getProperty("outstanding") + ")", type: "int", required: true },
          { name: "condition", label: "Inspection result", type: "select", required: true, options: [
            { key: "GOOD", text: "Good - back to available stock" }, { key: "MINOR_DAMAGE", text: "Minor damage - repair queue" }, { key: "SCRAP", text: "Scrap - write off" }] },
          { name: "serialNo", label: "Serial / QR / barcode", type: "scan" },
          { name: "returnDate", label: "Return date", type: "date" },
          { name: "remarks", label: "Remarks", type: "textarea" }
        ],
        onSubmit: async function (v) {
          v.dispatch_ID = that._id;
          var r = await Backend.action(that.getODataModel(), "registerReturn", v);
          that.toast("Return " + r.returnNo + " registered");
          that.refreshAll();
        }
      });
    }
  });
});
