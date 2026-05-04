// Back-compat barrel — clients/official/base.js owns the full implementation.
// Phase A.4–A.11 will extract domain-specific methods from base.js into
// clients/official/{im,docs,bitable,...}.js, then clients/official/index.js
// will compose them via mixin and supersede this barrel.
//
// Once all callers (src/, scripts/, test/) point at './clients/official' instead
// of './official', this file can be deleted.
module.exports = require('./clients/official/base');
