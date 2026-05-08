// src/tools/profile.js — multi-account profile management.
//
// v1.3.9 SSOT: profiles live in ~/.feishu-user-plugin/credentials.json under
// `profiles[]`. Switching writes `active` field; cross-process MCP picks it up
// via dispatcher mtime hook (~10μs/call) within ms.
//
// Legacy LARK_PROFILES_JSON env still works as a back-compat fallback when
// credentials.json doesn't exist. New profiles should be added via
// `npx feishu-user-plugin setup --profile <name> --app-id ... --app-secret ... --cookie ...`,
// then optionally `npx feishu-user-plugin oauth --profile <name>` for UAT.

const { text, json } = require('./_registry');

const schemas = [
  {
    name: 'list_profiles',
    description: '[Plugin] List all available identity profiles (each profile has its own LARK_COOKIE / APP_ID / APP_SECRET / UAT). v1.3.9 SSOT: profiles live in ~/.feishu-user-plugin/credentials.json::profiles. Legacy fallback: LARK_PROFILES_JSON env var. Marks the currently active profile.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'switch_profile',
    description: '[Plugin v1.3.9] Switch the active identity profile. Atomically writes credentials.json::active; cached clients in this process are invalidated; cross-process MCPs (Codex / another Claude Code) auto-sync via dispatcher mtime check on next tool call (~10μs). To add a new profile, run `npx feishu-user-plugin setup --profile <name> --app-id ... --app-secret ... --cookie ...` then `npx feishu-user-plugin oauth --profile <name>` for UAT.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Profile name. Use "default" for the primary profile; other names come from credentials.json or LARK_PROFILES_JSON.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'manage_profile_hints',
    description: '[Plugin v1.3.8] Inspect / set / clear profileHints — the resourceKey → profileName cache the auto-switch middleware uses to remember which profile owns each Feishu resource. Useful when a hint goes stale (e.g., a profile lost access to a doc).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'set', 'clear'], description: 'list = show all hints; set = upsert one; clear = remove one or all.' },
        resource_key: { type: 'string', description: 'For set/clear: the resourceKey, e.g. "doc:doccnXXX" or "chat:oc_zzz". Omit on clear to wipe all hints.' },
        profile: { type: 'string', description: 'For set: the profile name to associate with the resource_key.' },
      },
      required: ['action'],
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
  async manage_profile_hints(args, _ctx) {
    const credentials = require('../auth/credentials');
    if (args.action === 'list') {
      return json({ hints: credentials.getProfileHints() });
    }
    if (args.action === 'set') {
      if (!args.resource_key) return text('manage_profile_hints(set): resource_key is required');
      if (!args.profile) return text('manage_profile_hints(set): profile is required');
      const ok = credentials.setProfileHint(args.resource_key, args.profile);
      return text(ok ? `Hint set: ${args.resource_key} → ${args.profile}` : 'Hint not set (no credentials.json — run `npx feishu-user-plugin migrate --confirm`)');
    }
    if (args.action === 'clear') {
      const ok = credentials.clearProfileHint(args.resource_key);
      const target = args.resource_key || '<all>';
      return text(ok ? `Hint cleared: ${target}` : `No hint to clear for: ${target}`);
    }
    return text(`manage_profile_hints: unknown action "${args.action}". Use list / set / clear.`);
  },
};

module.exports = { schemas, handlers };
