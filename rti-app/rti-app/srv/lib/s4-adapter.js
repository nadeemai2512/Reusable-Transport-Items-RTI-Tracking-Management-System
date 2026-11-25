'use strict';
/**
 * S/4HANA integration adapter for the RTI service.
 *
 * This module is the single integration point with SAP S/4HANA. It is consumed by
 * the CAP handlers in srv/rti-service.js for two flows required by the spec:
 *
 *   1. Outbound delivery lookup      -> API_OUTBOUND_DELIVERY_SRV (A_OutbDeliveryHeader)
 *   2. Purchase requisition creation -> API_PURCHASEREQ_PROCESS_SRV (A_PurchaseRequisition)
 *
 * Cloud deployment model (BTP):
 *   - A destination "S4HANA" is created in the BTP subaccount pointing at the S/4
 *     system (e.g. https://my.s4.sap:443), with the "sap.businesstype" RFC or HTTP
 *     and an OAuth2ClientCredentials / PrincipalPropagation auth.
 *   - The CAP service binds the "destination" + "xsuaa" services; @sap/xssec mints
 *     a token and the destination service resolves the connection.
 *
 * Local / no-destination model:
 *   - When run locally without a bound destination service (the common dev case and
 *     the case in this sandbox) every call throws a clearly-identified "integration
 *     not configured" error. The CAP handler records that error on the entity
 *     (PurchaseRequisitions.s4PostingError) and returns HTTP 502. We never pretend a
 *     posting succeeded.
 *
 * Nothing here is mocked to return a fake success. The spec explicitly says: "If real
 * S/4HANA connectivity is not configured, provide a clearly identified integration
 * adapter and setup instructions. Do not pretend that real external posting has been
 * tested." This file honours that.
 */

const cds = require('@sap/cds');

/* Destination name expected in the BTP subaccount. Override with env S4_DESTINATION. */
const DEST_NAME = process.env.S4_DESTINATION || 'S4HANA';

/* Cache the destination service accessor lazily. In local dev it is unavailable. */
let destService = null;
function getDestinationService() {
  if (destService !== null) return destService;
  try {
    // @sap/cds resolves the destination service when bound; falls back to null locally.
    destService = cds.env.requires && cds.env.requires.destinations ? require('@sap-cloud-sdk/connectivity') : null;
  } catch (e) { destService = null; }
  return destService;
}

/**
 * Reads a destination by name using the bound BTP destination service.
 * Returns null when no destination service is configured (local dev).
 */
async function readDestination() {
  const svc = getDestinationService();
  if (!svc) return null;
  try {
    // The SDK's getDestination is the canonical entry point when a destination
    // service instance is bound to the app.
    const { getDestination } = svc;
    return await getDestination(DEST_NAME);
  } catch (e) {
    throw new Error(`Destination "${DEST_NAME}" could not be resolved: ${e.message || e}`);
  }
}

/** Builds the bearer-token header for an authenticated S/4 call. */
async function authHeaders(dest) {
  if (!dest || !dest.authentication) return {};
  if (dest.authTokens && dest.authTokens.length) {
    const t = dest.authTokens[0];
    return { Authorization: `${t.type} ${t.value}`, 'x-csrf-token': 'Fetch' };
  }
  return {};
}

/** Performs a GET against an S/4 OData path and returns the parsed JSON body. */
async function odataGet(path) {
  const dest = await readDestination();
  if (!dest) {
    const err = new Error(`S/4HANA integration not configured: destination "${DEST_NAME}" is not bound. See srv/lib/s4-adapter.js and the README "S/4HANA integration" section.`);
    err.code = 'S4_NOT_CONFIGURED';
    throw err;
  }
  const headers = await authHeaders(dest);
  const url = dest.url.replace(/\/$/, '') + path;
  const res = await fetch(url, { headers: { ...headers, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`S/4 GET ${path} failed: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

/** Performs a POST against an S/4 OData path with a CSRF token fetched first. */
async function odataPost(path, body) {
  const dest = await readDestination();
  if (!dest) {
    const err = new Error(`S/4HANA integration not configured: destination "${DEST_NAME}" is not bound. See srv/lib/s4-adapter.js and the README "S/4HANA integration" section.`);
    err.code = 'S4_NOT_CONFIGURED';
    throw err;
  }
  const headers = await authHeaders(dest);
  // Fetch CSRF token first (S/4 OData write requests require it).
  const base = dest.url.replace(/\/$/, '');
  const tokenRes = await fetch(base + path, { method: 'GET', headers: { ...headers, 'x-csrf-token': 'Fetch', Accept: 'application/json' } });
  const csrf = tokenRes.headers.get('x-csrf-token');
  const cookie = tokenRes.headers.get('set-cookie');
  const res = await fetch(base + path, {
    method: 'POST',
    headers: {
      ...headers, 'Content-Type': 'application/json', Accept: 'application/json',
      'x-csrf-token': csrf || 'Fetch',
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`S/4 POST ${path} failed: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

/* ---------------- public API ---------------- */

/**
 * Looks up an outbound delivery in S/4HANA (API_OUTBOUND_DELIVERY_SRV).
 * Returns the delivery header (DeliveryDocument, DeliveryDate, etc.) or null.
 */
async function getOutboundDelivery(deliveryNo) {
  if (!deliveryNo) return null;
  const data = await odataGet(`/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV;v=2/A_OutbDeliveryHeader('${encodeURIComponent(deliveryNo)}')?$format=json`);
  return data && data.d ? data.d : data;
}

/**
 * Creates a purchase requisition in S/4HANA (API_PURCHASEREQ_PROCESS_SRV).
 * Returns the created PR number (PurchaseRequisition).
 *
 * The payload follows the S/4 OData V2 entity A_PurchaseRequisition + its item.
 * Material / plant / purchasing group mapping is intentionally left to the
 * implementer's value mapping (see README); here we send the RTI fields that map
 * 1:1 and include a clear note in the PR item text.
 */
async function createPurchaseRequisition({ assetType_ID, warehouse_ID, quantity, unitPrice, currency, prNo }) {
  const body = {
    PurchaseRequisition: '',
    PurchaseRequisitionType: 'NB',
    to_PurchaseRequisitionItem: {
      results: [{
        PurchaseRequisitionItem: '00010',
        PurchasingGroup: 'RTI',
        Plant: warehouse_ID || '',
        Material: assetType_ID || '',
        PurchaseRequisitionItemText: `RTI replenishment (${prNo})`,
        RequestedQuantity: String(quantity),
        RequestedQuantityUnit: 'EA',
        BaseUnit: 'EA',
        PurchaseRequisitionPrice: String(unitPrice || 0),
        PurchasingOrganization: 'RTI'
      }]
    }
  };
  const data = await odataPost('/sap/opu/odata/sap/API_PURCHASEREQ_PROCESS_SRV/A_PurchaseRequisition', body);
  const created = data && data.d ? data.d : data;
  return created && created.PurchaseRequisition ? created.PurchaseRequisition : null;
}

/**
 * Posts a debit memo request to S/4HANA (API_DEBIT_MEMO_REQUEST_SRV) for a
 * settled penalty (demurrage + replacement). Returns the debit memo request
 * number. Called from a future billing job; exposed here for completeness.
 */
async function createDebitMemoRequest({ customer_ID, amount, currency, reference }) {
  const body = {
    DebitMemoRequest: '',
    DebitMemoRequestType: 'DRMI',
    SoldToParty: customer_ID || '',
    PurchaseOrderByCustomer: reference || '',
    to_Item: {
      results: [{
        DebitMemoRequestItem: '000010',
        Material: 'RTI-DEBIT',
        RequestedQuantity: '1',
        RequestedQuantityUnit: 'EA',
        NetAmount: String(amount || 0),
        TransactionCurrency: currency || 'INR',
        DebitMemoRequestItemText: reference || ''
      }]
    }
  };
  const data = await odataPost('/sap/opu/odata/sap/API_DEBIT_MEMO_REQUEST_SRV/A_DebitMemoRequest', body);
  const created = data && data.d ? data.d : data;
  return created && created.DebitMemoRequest ? created.DebitMemoRequest : null;
}

module.exports = { getOutboundDelivery, createPurchaseRequisition, createDebitMemoRequest, DEST_NAME };
