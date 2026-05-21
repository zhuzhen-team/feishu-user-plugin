# Security Policy

## Supported Versions

Security fixes land on the latest published release on npm. Older minor versions are not back-patched.

| Version | Supported |
|---------|-----------|
| Latest 1.3.x | ✅ |
| < 1.3.0 | ❌ |

Check the latest:

```bash
npm view feishu-user-plugin version
```

## Reporting a Vulnerability

**Please do not file public GitHub issues for security vulnerabilities.**

Use GitHub's private security advisories: https://github.com/EthanQC/feishu-user-plugin/security/advisories/new

If you can't use the form, email **WatkinsWilliamfkb@bsdmail.com** with subject prefix `[security] feishu-user-plugin:` and include:

- Affected version (`npm view feishu-user-plugin version` if unsure)
- Reproduction steps or proof-of-concept
- Impact assessment (what an attacker can do)
- Whether the issue affects the cookie / app / OAuth UAT auth path

Expected response:

| Step | SLA |
|---|---|
| Acknowledge receipt | 72 hours |
| Triage + severity assessment | 1 week |
| Patch release (high / critical) | 2 weeks |
| Public disclosure (after patch) | Coordinated, typically 30 days post-fix |

## Scope

This project handles three credential types. The threat model differs per layer:

### `LARK_COOKIE` (cookie auth, user-identity messaging)

- **Stored at**: `~/.feishu-user-plugin/credentials.json` (mode 0600) and / or in MCP client config (`~/.claude.json`, etc).
- **Risk if leaked**: full account-level access — attacker can send / read messages as the user, read DMs, etc.
- **In scope**: any vulnerability that exposes the cookie via logs, error messages, or process arguments; any path traversal that reads the credentials file; any prompt injection that exfiltrates the cookie via tool calls.

### `LARK_APP_ID` + `LARK_APP_SECRET` (Official API, bot identity)

- **Risk if leaked**: bot-level access to the configured Feishu tenant — limited to scopes granted to the app.
- **In scope**: same as above for credential exposure.

### `LARK_USER_ACCESS_TOKEN` + `LARK_USER_REFRESH_TOKEN` (OAuth UAT)

- **Risk if leaked**: user-level OAuth access subject to granted scopes; refresh token gives 7-day rotation window.
- **Auto-refresh path**: `~/.feishu-user-plugin/uat-refresh.lock` cross-process file lock (`O_CREAT|O_EXCL`, 30s stale; v1.3.14+ — pre-v1.3.14 was at `~/.claude/feishu-uat-refresh.lock`) prevents concurrent refresh. Vulnerabilities in this path are in scope.

### Out of scope

- Vulnerabilities in Feishu's open API itself — please report to Feishu directly via the [Feishu Open Platform](https://open.feishu.cn).
- Vulnerabilities in upstream dependencies (`@larksuiteoapi/node-sdk`, `@modelcontextprotocol/sdk`, `protobufjs`, etc) — please report upstream first; we'll patch on our side once a fix is available.
- Issues only reproducible with intentional credential leakage or misconfiguration outside the documented setup paths.

## Disclosure Practice

- Private fix in branch + release in patch version
- Security advisory published on the GitHub repo after release
- CHANGELOG.md `### Security` section describes the issue + CVE if assigned
- Credit reporters by handle / name unless they request anonymity

## Supply Chain

- npm package published only via GitHub Actions `Publish to npm` workflow on `v*` tags (see `.github/workflows/publish.yml`).
- `prepublishOnly` runs `check-version`, `check-tool-count`, `sync-server-json check`, `check-docs-sync`, `check-changelog`, `confirm-version` — no publish bypasses these gates.
- `NPM_TOKEN` lives only in GitHub repo secrets; not in CI logs.
- Dependabot weekly updates for npm + monthly for GitHub Actions (see `.github/dependabot.yml`).
- `package.json::overrides` pins transitive deps when a direct dep ships a vulnerable version we can't replace (current: `axios ^1.16.0`).

## Credential Hygiene Reminders for Users

- `~/.feishu-user-plugin/credentials.json` is mode 0600 by default. Don't loosen.
- Never commit `LARK_*` to any public repo — it's in `.gitignore`, but check before pushing.
- Run `npm audit` periodically; this project keeps low-severity advisories under review.
- Refresh tokens auto-rotate; if you see unexpected refresh failures, check `~/.feishu-user-plugin/credentials.json` for unauthorized changes.
