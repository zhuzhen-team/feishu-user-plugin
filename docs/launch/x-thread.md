# X (Twitter) Long Thread

**Length**: 4 tweets
**Hashtag**: `#MCP` (single — algorithm penalises 2+ hashtags)
**Tag strategy**: post the main thread first, then **5-10 minutes later** reply tagging accounts (immediate tag = algorithm flags as spam)
**Targets to tag in reply**: `@alexalbert__` (Anthropic Claude Relations / DX), `@AI_Jasonyu` (Chinese MCP-related Twitter)
**Status**: 📄 Draft — pending user `发`

---

## Main thread (4 tweets)

### Tweet 1 (hook + repo link + image)

```
Send Feishu/Lark messages as your real user — not as a bot.

84 tools, 3 auth layers, MCP server for Claude Code / Codex / Cursor / Windsurf.

Cookie + protobuf protocol path for user-identity messaging, plus full official-API coverage of docs / bitable / wiki / drive / calendar / tasks / OKR.

github.com/EthanQC/feishu-user-plugin

#MCP
```

> Attach: `docs/og.png` (1200×630).

### Tweet 2 (the wedge)

```
Why this matters: Feishu's official API has NO `send_as_user` scope.

Even with OAuth user_access_token, every message is tagged sender_type:"app" — recipients see a bot avatar. Kills automation UX.

This plugin solves it via the cookie + protobuf path the web client uses.
```

### Tweet 3 (quick start)

```
60-second install:

  npx feishu-user-plugin setup --app-id <X> --app-secret <Y>
  npx feishu-user-plugin oauth
  → restart Claude Code

Then talk in natural language: "Send to Alice from me: review done, 3 nits"

→ tool call → message in chat shows your name, your avatar.
```

### Tweet 4 (compatibility + license)

```
Works with Claude Code (CLI/Desktop/Web/IDE), Codex, Cursor, Windsurf, OpenClaw.

MIT license. v1.3.9 just shipped with machine-level WS events SSOT, multi-account auto-switch, and user-identity image sending.

npm: npmjs.com/package/feishu-user-plugin
docs: ethanqc.github.io/feishu-user-plugin
```

---

## Reply tweet (post 5-10 min after thread)

```
@alexalbert__ @AI_Jasonyu thought you might find this interesting — full Feishu/Lark coverage in one MCP server, with the user-identity sending angle.

Happy to demo on a call if useful.
```

> Don't tag both in tweet 1 — algorithm flags it as spam. 5-10 min delay, then reply with tag.

---

## Pre-post checklist

- [ ] Main image attached and renders correctly in preview
- [ ] All 4 tweets fit within character limits (with thread numbering off)
- [ ] Repo URL clicks through correctly
- [ ] Posted from a warmed-up account (not a fresh one — fresh accounts get throttled)

## Post-post follow-up

| Hour | Action |
|---|---|
| +5 min | Post the reply tagging @alexalbert__ + @AI_Jasonyu |
| +1 hr | Check engagement: < 10 likes = repost in 24 hr with different hook; > 30 likes = ride the wave, RT yourself |
| +24 hr | If @alexalbert__ engaged or RT'd, send a polite DM offering a longer demo / collab |

## Tone notes

- Don't say "best Feishu MCP" / "the only solution that..." — competing MCPs exist (lark-openapi-mcp, cso1z/Feishu-MCP), just lead with the actual differentiator (send-as-user)
- Single hashtag only — `#MCP` is enough
