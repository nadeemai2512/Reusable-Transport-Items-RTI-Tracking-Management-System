sap.ui.define([
  "sap/m/Dialog", "sap/m/Button", "sap/m/Input", "sap/m/Label", "sap/m/CheckBox", "sap/m/Select", "sap/m/TextArea",
  "sap/m/DatePicker", "sap/m/MessageStrip", "sap/m/HBox", "sap/m/MessageToast", "sap/ui/core/Item",
  "sap/ui/layout/form/SimpleForm", "sap/ui/model/json/JSONModel", "rti/app/util/Backend"
], function (Dialog, Button, Input, Label, CheckBox, Select, TextArea, DatePicker, MessageStrip, HBox, MessageToast,
  Item, SimpleForm, JSONModel, Backend) {
  "use strict";

  /**
   * Generic data-entry dialog.
   * oCfg = { view, title, fields[], data, submitText, onSubmit(values) -> Promise, editing }
   * field = { name, label, type: text|int|decimal|bool|date|textarea|select|scan, required, entity, itemKey, itemText,
   *           filters, options:[{key,text}], lockOnEdit }
   */
  function open(oCfg) {
    var oModel = new JSONModel(Object.assign({}, oCfg.data || {}));
    var oStrip = new MessageStrip({ type: "Error", showIcon: true, visible: false });
    oStrip.addStyleClass("sapUiSmallMarginBottom");
    var oForm = new SimpleForm({ editable: true, layout: "ResponsiveGridLayout", labelSpanXL: 4, labelSpanL: 4, labelSpanM: 4, labelSpanS: 12 });

    oCfg.fields.forEach(function (f) {
      var sPath = "{f>/" + f.name + "}", oCtrl;
      var bLocked = !!(oCfg.editing && f.lockOnEdit);
      switch (f.type) {
        case "bool":
          oCtrl = new CheckBox({ selected: sPath, enabled: !bLocked }); break;
        case "date":
          oCtrl = new DatePicker({ value: sPath, valueFormat: "yyyy-MM-dd", displayFormat: "medium", enabled: !bLocked }); break;
        case "textarea":
          oCtrl = new TextArea({ value: sPath, rows: 3, width: "100%", maxLength: 500 }); break;
        case "select":
          oCtrl = new Select({ selectedKey: sPath, forceSelection: false, width: "100%", enabled: !bLocked });
          if (f.options) {
            f.options.forEach(function (o) { oCtrl.addItem(new Item({ key: o.key, text: o.text })); });
          } else {
            oCtrl.bindAggregation("items", {
              path: "/" + f.entity,
              filters: f.filters || [],
              template: new Item({ key: "{" + (f.itemKey || "ID") + "}", text: f.itemText })
            });
          }
          break;
        case "scan":
          oCtrl = new HBox({ width: "100%" });
          oCtrl.addItem(new Input({ value: sPath, placeholder: "Type or scan", width: "100%", enabled: !bLocked }));
          (function (box, field) {
            sap.ui.require(["sap/ndc/BarcodeScannerButton"], function (BSB) {
              box.addItem(new BSB({
                dialogTitle: field.label,
                scanSuccess: function (e) { oModel.setProperty("/" + field.name, e.getParameter("text")); },
                scanFail: function () { MessageToast.show("Scanning failed or camera unavailable - please type the code."); }
              }));
            }, function () { /* scanner library unavailable: manual entry still works */ });
          })(oCtrl, f);
          break;
        default:
          oCtrl = new Input({ value: sPath, type: (f.type === "int" || f.type === "decimal") ? "Number" : "Text", enabled: !bLocked });
      }
      oForm.addContent(new Label({ text: f.label, required: !!f.required }));
      oForm.addContent(oCtrl);
    });

    var oDialog = new Dialog({
      title: oCfg.title, contentWidth: "30rem", draggable: true, resizable: false,
      content: [oStrip, oForm],
      beginButton: new Button({
        text: oCfg.submitText || "Save", type: "Emphasized",
        press: async function () {
          var vals = {}, sMissing = "";
          oCfg.fields.forEach(function (f) {
            var v = oModel.getProperty("/" + f.name);
            if (f.type === "int" || f.type === "decimal") { v = (v === "" || v === null || v === undefined) ? undefined : Number(v); }
            if (f.type === "int" && v !== undefined && !Number.isInteger(v)) { sMissing = sMissing || (f.label + " must be a whole number"); }
            if (v === "") { v = (f.type === "text" || f.type === "textarea" || f.type === "scan") ? undefined : null; }
            if (f.required && (v === undefined || v === null)) { sMissing = sMissing || ("Please fill in: " + f.label); }
            vals[f.name] = v;
          });
          if (sMissing) { oStrip.setText(sMissing).setVisible(true); return; }
          oDialog.setBusy(true); oStrip.setVisible(false);
          try {
            await oCfg.onSubmit(vals);
            oDialog.close();
          } catch (e) {
            oStrip.setText(Backend.errText(e)).setVisible(true);
          } finally {
            oDialog.setBusy(false);
          }
        }
      }),
      endButton: new Button({ text: "Cancel", press: function () { oDialog.close(); } }),
      afterClose: function () { oDialog.destroy(); }
    });
    oDialog.setModel(oModel, "f");
    oCfg.view.addDependent(oDialog);   // inherits the default OData V4 model (for select lists)
    oDialog.open();
    return oDialog;
  }

  return { open: open };
});
