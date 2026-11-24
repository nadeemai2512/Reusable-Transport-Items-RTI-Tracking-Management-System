sap.ui.define(["rti/app/controller/BaseController"], function (BaseController) {
  "use strict";
  return BaseController.extend("rti.app.controller.Ledger", {
    onInit: function () {
      this.onMatched("ledger", null, function () { this._load(this.byId("tabs").getSelectedKey() || "ledger"); });
    },
    onTabSelect: function (e) { this._load(e.getParameter("key")); },
    _load: function (sKey) {
      var b = this.byId(sKey === "audit" ? "t_audit" : "t_ledger").getBinding("items");
      if (b.isSuspended()) { b.resume(); } else { b.refresh(); }
    }
  });
});
