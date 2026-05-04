// Back-compat barrel. The implementation now lives in clients/official/
// (split by domain in v1.3.7 phase A). This file exists so external callers
// importing './official' keep working until they migrate to './clients/official'.
// Will be deleted once all callers are migrated.
module.exports = require('./clients/official');
