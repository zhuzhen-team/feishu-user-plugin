// src/tools/profile.js — multi-account profile management (v1.3.6).
//
// LARK_PROFILES_JSON env var registers extra credential sets; this module
// exposes them via list_profiles + switch_profile so callers can hot-swap
// between accounts/tenants without restarting the MCP server.

const { text, json } = require('./_registry');

const schemas = [
  {
    name: 'list_profiles',
    description: '[Plugin] List all available identity profiles (sets of LARK_COOKIE/APP_ID/APP_SECRET/UAT). The "default" profile uses the top-level env vars; additional profiles come from LARK_PROFILES_JSON. Marks the currently active profile.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'switch_profile',
    description: '[Plugin] Switch the active identity profile. Subsequent tool calls use the new profile\'s credentials. Cached client instances are reset so the next call rebuilds against the new creds.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Profile name. "default" for top-level env vars; any key from LARK_PROFILES_JSON otherwise.' },
      },
      required: ['name'],
    },
  },
];

const handlers = {
  async list_profiles(_args, ctx) {
    return json({ active: ctx.getActiveProfile(), profiles: ctx.listProfiles() });
  },
  async switch_profile(args, ctx) {
    const target = args.name;
    const all = ctx.listProfiles();
    if (!all.includes(target)) {
      return text(`Profile "${target}" not found. Available: ${all.join(', ')}. To add more, set LARK_PROFILES_JSON in your MCP env.`);
    }
    ctx.setActiveProfile(target);
    return text(`Switched to profile: ${target}`);
  },
};

module.exports = { schemas, handlers };
