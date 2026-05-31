# cmux-skills

Signal your AI coding agent's state on its [cmux](https://cmux.com) terminal tab —
**green** while working, **yellow** when idle/done, **red** (with a concise reason,
a desktop notification, a sound, and an optional voice readout) when it's blocked
and needs you.

It's framework-agnostic. Hermes ships as a first-class adapter; everything else
wires up with a couple of CLI calls. When run outside a cmux pane every command
safely no-ops, so it's drop-in safe for headless/CI runs.

```
┌─ working ─┐   ┌─ done ─┐   ┌─ blocked ──────────────────────┐
│   🟢       │   │  🟡    │   │  🔴  "waiting on API key"  🔔🔊 │
└───────────┘   └────────┘   └────────────────────────────────┘
```

## Quick start

```bash
# Hermes
npx cmux-skills install hermes
hermes gateway restart        # activate the hook

# anything else
npx cmux-skills install generic   # prints the commands to wire up
```

Or install globally so the `cmux-skills` command is on your PATH (recommended):

```bash
npm i -g cmux-skills
```

## How it works

cmux authenticates its CLI **only from inside a cmux pane** (it injects
`CMUX_WORKSPACE_ID` + socket auth). So all signaling runs in-process inside the
agent's own pane and targets the *caller* workspace.

| State       | Tab            | Trigger                                            |
| ----------- | -------------- | -------------------------------------------------- |
| `working`   | green          | a run/turn starts                                  |
| `done`      | yellow         | the run/turn finishes (idle — *not* "goal done")   |
| `blocked`   | red + reason   | the agent calls `cmux-skills block "<reason>"`     |
| `clear`     | neutral        | explicit `cmux-skills clear`                       |
| `normalize` | recovery       | startup / session reset; drops stale, non-blocked state |

`done` means **idle after this turn**, not "goal achieved" — most agents have no
goal-complete signal, so yellow means *waiting for you*. A blocked marker is
**sticky**: `done` won't override red while it's set; the next `working` clears
it. Overlapping/nested runs are reference-counted so the tab doesn't flip early.

## CLI

```
cmux-skills init                     Create default config and show status
cmux-skills doctor                   Diagnose cmux install, config, workspace
cmux-skills status <state> [opts]    working | done | blocked | clear | normalize
cmux-skills block "<reason>" [opts]  Mark blocked (red + reason + notify + sound)
cmux-skills clear                    Clear all signals on the current tab
cmux-skills install <adapter>        hermes | generic   (--no-soul to skip prompt)
cmux-skills uninstall hermes
cmux-skills config <path|show>
cmux-skills version
```

Options for `status`/`block`: `--reason "<text>"`, `--details "<text>"`,
`--workspace <id>`.

## Hermes adapter

`cmux-skills install hermes` does two things:

1. Installs a Hermes hook at `~/.hermes/hooks/cmux-tab-state/` that maps the agent
   lifecycle to tab colors automatically (`agent:start`→working,
   `agent:end`→done, `session:end`→normalize, `gateway:startup`→normalize).
   `normalize` drops stale non-blocked state but preserves a genuine `block`
   across `/new` or `/reset`, so a "needs human" signal is never silently lost.
2. Appends a short, idempotent guidance block to `~/.hermes/SOUL.md` telling the
   agent to run `cmux-skills block "<reason>"` when it needs a human. Pass
   `--no-soul` to skip this.

Then reload Hermes: `hermes gateway restart`. Remove everything with
`cmux-skills uninstall hermes` (then restart again).

## Configuration

Config lives at `~/.config/cmux-skills/config.json` (created by
`cmux-skills init`). Env overrides: `CMUX_SKILLS_VOICE_PROVIDER`,
`CMUX_SKILLS_SOUND_MODE`, `CMUX_SKILLS_COLOR_{WORKING,DONE,BLOCKED}`.

```jsonc
{
  "colors":  { "working": "Green", "done": "#F1C40F", "blocked": "Red" },
  "blocked": { "notify": true, "flash": true, "sound": true,
               "setDescription": true, "renameTitle": false },
  "sound":   { "mode": "system", "file": "/System/Library/Sounds/Funk.aiff" },
  "voice":   { "provider": "none" }
}
```

Colors accept cmux named colors (`Red`, `Amber`, `Green`, …) or `#RRGGBB`.

### Voice (optional)

Off by default. Set `voice.provider` to:

- `say` — macOS built-in TTS.
- `elevenlabs` — ElevenLabs TTS. Needs an API key in the env var named by
  `voice.elevenlabs.apiKeyEnv` (default `ELEVEN_API_KEY`); tune `voiceId` /
  `modelId` (these must be plain `[A-Za-z0-9_-]` identifiers).
- `command` — any shell command, run via `/bin/sh -c`; the text arrives on
  stdin and as `$CMUX_SKILLS_TEXT`. **This executes arbitrary shell — only use
  config you trust.**

Voice is always fire-and-forget, detached, time-bounded, and de-duplicated
(`voice.dedupeSeconds`).

## License

MIT © kaseonedge
