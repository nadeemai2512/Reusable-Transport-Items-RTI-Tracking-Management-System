sap.ui.define([], function () {
  "use strict";
  var GOOD = ["AVAILABLE", "GOOD", "CLOSED", "APPROVED", "RECEIVED"];
  var WARN = ["OPEN", "PENDING_APPROVAL", "PARTIALLY_RETURNED", "ACCRUING", "ORDERED", "AT_CUSTOMER", "UNDER_REPAIR", "MINOR_DAMAGE"];
  var BAD = ["REJECTED", "PRESUMED_LOST", "SCRAP", "WRITTEN_OFF", "DAMAGED"];
  return {
    state: function (s) {
      if (GOOD.indexOf(s) >= 0) { return "Success"; }
      if (WARN.indexOf(s) >= 0) { return "Warning"; }
      if (BAD.indexOf(s) >= 0) { return "Error"; }
      return "None";
    },
    label: function (s) { return s ? String(s).replace(/_/g, " ") : ""; },
    yesNo: function (b) { return b ? "Yes" : "No"; }
  };
});
