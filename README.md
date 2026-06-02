# hermes-cmux

**Hermes Agent blocked-reason alerts for [cmux](https://cmux.com).**

cmux already knows when Hermes is running, idle, waiting for approval, and how to restore a session. Two higher-level signals are better owned by Hermes itself:

1. **What Hermes is working on right now** — polished dynamic subtext under the tab.
2. **Why Hermes needs a human and what action the human should take** — red blocked escalation with optional voice.

`hermes-cmux` adds those layers on top of cmux native Hermes hooks:

```text
cmux native Hermes hooks        hermes-cmux Hermes context
running · idle · approval   +   “Reviewing README + testing ElevenLabs voice”
                            +   🔴 reason + notification + sound + voice
```

This package is **Hermes-specific**. It is not a general cmux skills library, and it does not try to replace cmux native lifecycle hooks.

> Backward compatibility: the old `cmux-skills` binary name still works as an alias, but new docs and installs should use `hermes-cmux`.

---

## 1. Install cmux native Hermes hooks

Let cmux own lifecycle state first:

```bash
cmux hooks hermes-agent install
hermes gateway restart           # reload ~/.hermes/config.yaml so hooks take effect
```

Claude Code is different: cmux injects Claude hooks through its Claude wrapper when Claude Code integration is enabled in Settings. There is no `cmux hooks claude install` target.

Verify native hook sessions with:

```bash
cmux hooks --help
cmux docs agents
hermes-cmux doctor
```

Native hook session files live under `~/.cmuxterm/<agent>-hook-sessions.json`; `doctor` reports what it detects.

---

## 2. Install Hermes blocked-action guidance

```bash
npm i -g hermes-cmux
hermes-cmux init
hermes-cmux install hermes
```

`install hermes` appends idempotent guidance to `~/.hermes/SOUL.md` telling Hermes to keep the tab subtext fresh and to escalate only when it needs a human:

```bash
hermes-cmux summary "reviewing README and testing ElevenLabs voice"
hermes-cmux block "<concise reason>"
hermes-cmux clear
```

Use `--no-soul` if you only want the config/CLI and do not want to edit `SOUL.md`.

---

## 3. Dynamic subtext summaries

Hermes can update the cmux workspace description with a polished one-line summary whenever the active plan changes:

```bash
hermes-cmux summary "Reviewing cmux docs, patching Hermes voice tests, then running npm test"
hermes-cmux summary clear
```

This is intentionally lightweight: the main Hermes process can emit summaries at turn boundaries or after major tool phases without starting a daemon. A dedicated summarizer sub-agent is possible later, but it should be event-driven and throttled — not a constantly polling LLM — to avoid token spend and stale racey updates.

Recommended summary style:

- present-tense, human-readable, under ~140 characters;
- include the concrete workstream, not generic “thinking”;
- update on meaningful phase changes, not every tool call;
- never include secrets, raw tokens, private message contents, or stack traces.

---

## 4. Test voice with an explicit mock action

Use the built-in voice smoke command before relying on live blocked events:

```bash
hermes-cmux voice-test --dry-run
hermes-cmux voice-test
```

The dry run prints the exact text that would be spoken. The live test speaks a sentence like:

```text
Hermes needs you. No real action required: ElevenLabs smoke test. This is a test of the Hermes cmux blocked-alert voice. If you hear this sentence, voice is working and the spoken action is included.
```

Override fields for a more realistic mock:

```bash
hermes-cmux voice-test \
  --reason "missing GitHub token" \
  --details "Open Bitwarden, sync the Hermes GitHub token, then say continue."
```

Then test the actual cmux blocked path:

```bash
hermes-cmux block "missing GitHub token" \
  --details "Open Bitwarden, sync the Hermes GitHub token, then say continue."
hermes-cmux clear
```

---

## CLI

```text
hermes-cmux init                     Create or migrate config and show status
hermes-cmux doctor                   Diagnose cmux install, native hooks, config, workspace
hermes-cmux summary "<text>" [opts]  Update dynamic cmux subtext/status
hermes-cmux summary clear            Clear dynamic summary subtext
hermes-cmux block "<reason>" [opts]  Mark blocked: red tab + reason + notify + sound + voice
hermes-cmux clear                    Clear blocked signals on the current tab
hermes-cmux voice-test [opts]        Speak a sample blocked-action sentence
hermes-cmux install hermes           Add Hermes SOUL.md guidance (--no-soul to skip SOUL.md)
hermes-cmux uninstall hermes         Remove Hermes SOUL.md guidance
hermes-cmux config <path|show>       Inspect configuration
hermes-cmux version
```

Options for `block`:

```text
--reason "<text>"     Why Hermes is blocked; shown on the tab
--details "<text>"    Longer action/context; used in notification and voice
--workspace <id>      Target a workspace; defaults to the caller cmux pane
```

Options for `voice-test`:

```text
--reason "<text>"     Default: ElevenLabs smoke test
--details "<text>"    Default includes a clear no-op action
--provider <name>     Override configured provider for one test: none | say | elevenlabs | command
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

Environment overrides prefer the Hermes-specific names, with legacy `CMUX_SKILLS_*` still accepted:

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
    "provider": "none",
    "template": "Hermes needs you. {action}: {reason}. {details}",
    "dedupeSeconds": 30,
    "timeoutSeconds": 30,
    "elevenlabs": {
      "apiKeyEnv": "ELEVENLABS_API_KEY",
      "voiceId": "iP95p4xoKVk53GoZ742B",
      "modelId": "eleven_flash_v2_5"
    }
  }
}
```

Voice providers:

- `none` — disabled.
- `say` — macOS built-in TTS.
- `elevenlabs` — ElevenLabs TTS. Requires the API key in `ELEVENLABS_API_KEY` by default.
- `command` — trusted shell command; receives text on stdin and `$CMUX_SKILLS_TEXT`.

Voice is fire-and-forget, detached, time-bounded, and de-duplicated per workspace/message.

---

## Runtime behavior

`hermes-cmux block` only works from inside a cmux pane because cmux authenticates its CLI with pane/workspace environment variables.

| State | Effect |
| --- | --- |
| `block` | red tab, reason pill/description, notification, flash, sound, optional voice |
| `clear` | clears blocked marker, status pill, description, and tab color |

A blocked marker is sticky: cmux native idle state will not erase it, and `done` from the legacy alias path will not override red while a real block exists. Only `clear` or a new `working` run clears it.

## License

MIT © kaseonedge
