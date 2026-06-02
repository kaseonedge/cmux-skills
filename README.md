# cmux-voice

**Voice-first cmux context and blocked-action alerts for Hermes Agent and OpenClaw.**

cmux already knows when a supported agent is running, idle, waiting for approval, and how to restore a session. Three higher-level signals are better owned by Hermes/OpenClaw itself:

1. **Voice** — every human-needed alert is spoken; ElevenLabs is preferred and macOS `say` is the fallback.
2. **What Hermes/OpenClaw is working on right now** — polished dynamic subtext under the tab.
3. **Why Hermes/OpenClaw needs a human and what action the human should take** — red blocked escalation with a spoken action.

`cmux-voice` adds those layers on top of cmux native hooks:

```text
cmux native hooks             cmux-voice agent context
running · idle · approval  +   “Reviewing README + testing ElevenLabs voice”
                           +   🔊 spoken action + 🔴 reason + notification + sound
```

This package is scoped to **Hermes Agent and OpenClaw**. Hermes is verified now; OpenClaw is the next integration target and should be tested before claiming parity. This is not a general cmux skills library, and it does not replace cmux native lifecycle hooks.

> Naming: `cmux-voice` is the primary CLI name because spoken, action-bearing escalation is the defining feature. `hermes-cmux` and the old `cmux-skills` binary names still work as compatibility aliases.

---

## 1. Install cmux native hooks

Let cmux own lifecycle state first. For Hermes:

```bash
cmux hooks hermes-agent install
hermes gateway restart           # reload ~/.hermes/config.yaml so hooks take effect
```

Claude Code is different: cmux injects Claude hooks through its Claude wrapper when Claude Code integration is enabled in Settings. There is no `cmux hooks claude install` target.

Verify native hook sessions with:

```bash
cmux hooks --help
cmux docs agents
cmux-voice doctor
```

Native hook session files live under `~/.cmuxterm/<agent>-hook-sessions.json`; `doctor` reports what it detects.

---

## 2. Install Hermes/OpenClaw voice guidance

```bash
npm i -g cmux-voice
cmux-voice init
cmux-voice install hermes
```

`install hermes` appends idempotent guidance to `~/.hermes/SOUL.md` telling Hermes to keep the tab subtext fresh and to use voice-first escalation when it needs a human:

```bash
cmux-voice summary "reviewing README and testing ElevenLabs voice"
cmux-voice block "<concise reason>" \
  --action "<what the human should do>" \
  --details "<URL, exact prompt, or longer context>"
cmux-voice clear
```

Use `--no-soul` if you only want the config/CLI and do not want to edit `SOUL.md`.

---

## 3. Dynamic subtext summaries

Hermes/OpenClaw can update the cmux workspace description with a polished one-line summary whenever the active plan changes:

```bash
cmux-voice summary "Reviewing cmux docs, patching Hermes voice tests, then running npm test"
cmux-voice summary clear
```

This is intentionally lightweight: the main Hermes process can emit summaries at turn boundaries or after major tool phases without starting a daemon. A dedicated summarizer sub-agent is possible later, but it should be event-driven and throttled — not a constantly polling LLM — to avoid token spend and stale racey updates.

Recommended summary style:

- present-tense, human-readable, under ~140 characters;
- include the concrete workstream, not generic “thinking”;
- update on meaningful phase changes, not every tool call;
- never include secrets, raw tokens, private message contents, or stack traces.

---

## 4. Test voice with an explicit mock action

Voice is a primary feature. Use the built-in smoke command before relying on live blocked events:

```bash
cmux-voice voice-test --dry-run
cmux-voice voice-test
```

The dry run prints the exact text that would be spoken. The live test speaks a sentence like:

```text
Hermes needs you. No real action required: ElevenLabs smoke test. This is a test of the Hermes/OpenClaw cmux voice-first blocked alert. If you hear this sentence, voice is working, fallback is available, and the spoken action is included.
```

Override fields for a more realistic mock:

```bash
cmux-voice voice-test \
  --reason "missing GitHub token" \
  --details "Open Bitwarden, sync the Hermes GitHub token, then say continue."
```

### Cross-session voice broker

By default, voice alerts route through a local broker under `~/.local/state/cmux-hermes/` before speaking. Every cmux pane appends an event to the same queue and lazily starts one singleton drain worker, which means multiple Hermes/OpenClaw sessions do not talk over each other.

Broker behavior in v1:

- priority ordered: blocked/action alerts default to priority `100`;
- TTL protected: stale voice events expire instead of speaking late;
- coalesced: duplicate pending events for the same workspace/action/reason/details collapse to the newest item;
- one-at-a-time: the drain worker runs the actual provider synchronously, including ElevenLabs download + `afplay` or macOS `say` fallback;
- safe fallback: if the broker queue cannot be written, `cmux-voice` speaks directly instead of silently dropping the alert.

Inspect the queue with:

```bash
cmux-voice broker status
```

Manually drain queued voice work, if needed:

```bash
cmux-voice broker drain
```

Disable the broker only for debugging:

```jsonc
{
  "voice": {
    "broker": { "enabled": false }
  }
}
```

Then test the actual cmux blocked path:

```bash
cmux-voice block "missing GitHub token" \
  --details "Open Bitwarden, sync the Hermes GitHub token, then say continue."
cmux-voice clear
```

---

## CLI

```text
cmux-voice init                     Create or migrate config and show status
cmux-voice doctor                   Diagnose cmux install, native hooks, config, workspace
cmux-voice summary "<text>" [opts]  Update dynamic cmux subtext/status
cmux-voice summary clear            Clear dynamic summary subtext
cmux-voice block "<reason>" [opts]  Mark blocked: red tab + reason + notify + sound + voice
cmux-voice clear                    Clear blocked signals on the current tab
cmux-voice voice-test [opts]        Speak a sample blocked-action sentence
cmux-voice broker <status|drain>    Inspect or drain the cross-session voice queue
cmux-voice install hermes           Add Hermes SOUL.md guidance (--no-soul to skip SOUL.md)
cmux-voice uninstall hermes         Remove Hermes SOUL.md guidance
cmux-voice config <path|show>       Inspect configuration
cmux-voice version
```

Options for `block`:

```text
--reason "<text>"     Why Hermes is blocked; shown on the tab
--action "<text>"     What the human should do next; included in subtext, notification title, and voice
--details "<text>"    Longer action/context; used in notification and voice
--workspace <id>      Target a workspace; defaults to the caller cmux pane
```

Options for `voice-test`:

```text
--reason "<text>"     Default: ElevenLabs smoke test
--details "<text>"    Default includes a clear no-op action
--provider <name>     Override configured provider for one test: say | elevenlabs | command (`none` is legacy and falls back to `say`)
--dry-run             Print the spoken text without playing audio
```

---

## Configuration

New config lives at:

```text
~/.config/cmux-hermes/config.json
```

On `init`, an existing legacy config is migrated from:

```text
~/.config/cmux-skills/config.json
```

Environment overrides prefer the Hermes/OpenClaw-specific `CMUX_HERMES_*` names, with legacy `CMUX_SKILLS_*` still accepted:

```text
CMUX_HERMES_VOICE_PROVIDER
CMUX_HERMES_SOUND_MODE
CMUX_HERMES_COLOR_WORKING
CMUX_HERMES_COLOR_DONE
CMUX_HERMES_COLOR_BLOCKED
```

Default summary + voice config:

```jsonc
{
  "summary": {
    "setDescription": true,
    "statusKey": "hermes_summary",
    "icon": "sparkles",
    "color": "#3498DB",
    "priority": 50,
    "maxLength": 140,
    "prefix": "Hermes: "
  },
  "voice": {
    "provider": "say",
    "template": "Hermes needs you. {action}: {reason}. {details}",
    "dedupeSeconds": 30,
    "timeoutSeconds": 30,
    "broker": {
      "enabled": true,
      "priority": 100,
      "ttlSeconds": 300,
      "lockStaleSeconds": 300
    },
    "elevenlabs": {
      "apiKeyEnv": "ELEVENLABS_API_KEY",
      "voiceId": "iP95p4xoKVk53GoZ742B",
      "modelId": "eleven_flash_v2_5"
    }
  }
}
```

Voice providers:

- `elevenlabs` — preferred voice. Requires the API key in `ELEVENLABS_API_KEY` by default; if the key or provider config is missing, it falls back to `say`.
- `say` — macOS built-in TTS and the default fallback.
- `command` — trusted shell command; receives text on stdin and `$CMUX_HERMES_TEXT` / `$CMUX_SKILLS_TEXT`.
- `none` — legacy alias only; treated as `say` so voice remains enabled.

Voice is fire-and-forget, detached, time-bounded, de-duplicated per workspace/message, and always has a fallback.

---

## Runtime behavior

`cmux-voice block` only works from inside a cmux pane because cmux authenticates its CLI with pane/workspace environment variables.

| State | Effect |
| --- | --- |
| `block` | spoken action, red tab, reason pill/description, notification, flash, sound |
| `clear` | clears blocked marker, status pill, description, and tab color |

A blocked marker is sticky: cmux native idle state will not erase it, and `done` from the legacy alias path will not override red while a real block exists. Only `clear` or a new `working` run clears it.

## License

MIT © kaseonedge
