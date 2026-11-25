sap.ui.define([], function () {
  "use strict";

  /** Extracts a readable message from OData V4 / network errors. */
  function errText(e) {
    if (!e) { return "Unknown error"; }
    if (e.error && e.error.message) { return e.error.message; }
    if (e.message) { return e.message; }
    return String(e);
  }

  /** Calls an unbound OData V4 action and returns the response object. */
  async function action(oModel, sName, mParams) {
    var oCtx = oModel.bindContext("/" + sName + "(...)");
    Object.keys(mParams || {}).forEach(function (k) {
      var v = mParams[k];
      if (v !== undefined && v !== null && v !== "") { oCtx.setParameter(k, v); }
    });
    await oCtx.execute();
    return oCtx.getBoundContext().getObject();
  }

  /** Calls an unbound OData V4 function and returns the response object.
   *  mParams is optional; when provided the parameters are set on the bound context. */
  async function fn(oModel, sName, mParams) {
    var oCtx = oModel.bindContext("/" + sName + "(...)");
    Object.keys(mParams || {}).forEach(function (k) {
      var v = mParams[k];
      if (v !== undefined && v !== null && v !== "") { oCtx.setParameter(k, v); }
    });
    await oCtx.execute();
    return oCtx.getBoundContext().getObject();
  }

  return { errText: errText, action: action, fn: fn };
});
