// Composer for LarkOfficialClient. base.js owns the cross-cutting infrastructure
// (constructor, UAT management, _safeSDKCall, _asUserOrApp, _uatREST, sender
// name resolution, helpers); each domain file owns its own methods. We splice
// them onto the prototype here so callers get a single class with everything.
//
// Adding a new domain: create clients/official/<x>.js exporting an object of
// async methods, then push it onto DOMAINS below. Domain order is purely
// cosmetic — Object.assign onto the prototype happens before any constructor
// runs, so cross-domain `this.*` calls work regardless of mixin order.
const { LarkOfficialClient } = require('./base');

const DOMAINS = [
  require('./contacts'),
  require('./calendar'),
  require('./tasks'),
  require('./groups'),
  require('./okr'),
  require('./wiki'),
  require('./drive'),
  require('./uploads'),
  require('./docs'),
  require('./bitable'),
  require('./im'),
];

for (const domain of DOMAINS) {
  Object.assign(LarkOfficialClient.prototype, domain);
}

module.exports = { LarkOfficialClient };
