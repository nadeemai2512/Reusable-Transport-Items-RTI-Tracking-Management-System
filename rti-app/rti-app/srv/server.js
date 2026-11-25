'use strict';
/**
 * CAP server bootstrap hook.
 *
 * In DEVELOPMENT (NODE_ENV !== 'production') we add a small middleware that authenticates
 * anonymous requests as the "admin" mocked user, so the SAPUI5 app boots end-to-end without
 * a browser basic-auth dialog. The browser basic-auth dialog is the default CAP dev behaviour,
 * but it breaks UI5's fetch() of manifest.json (URLs may carry credentials) and is poor UX for
 * local development.
 *
 * In PRODUCTION this hook is a no-op: XSUAA handles authentication and authorization, and the
 * @restrict / @requires annotations in rti-service.cds are fully enforced.
 *
 * The mocked users (admin/alice/bob/carol/dave) are still honoured: if a request carries an
 * Authorization header it is authenticated by CAP's built-in basic-auth middleware first, and
 * this middleware leaves it untouched.
 */
const cds = require('@sap/cds');

cds.on('bootstrap', (app) => {
  if (process.env.NODE_ENV === 'production') { return; }
  // Do NOT apply the dev auth bypass when running under the @cap-js/cds-test harness:
  // the integration tests explicitly assert that anonymous requests are rejected (401)
  // and that wrong-role requests are forbidden (403). The bypass is only for the
  // interactive dev server (cds watch / cds-serve) so the browser UI works without a
  // basic-auth dialog.
  if (process.env.cds_test_temp) { return; }

  // Mount before CAP's own middlewares so an already-authenticated request is untouched.
  app.use((req, res, next) => {
    if (req.headers.authorization) { return next(); }            // explicit credentials win
    // Default anonymous dev requests to the admin mocked user (all roles).
    // The mocked users are configured in package.json cds.requires.auth.[development].users.
    req.headers.authorization = 'Basic ' + Buffer.from('admin:rti').toString('base64');
    next();
  });

  cds.log('rti-auth').info('development mode: anonymous requests authenticated as "admin"');
});
