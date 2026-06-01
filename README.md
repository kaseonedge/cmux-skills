# cmux-skills

**Spoken, reasoned "needs-a-human" alerts for AI coding agents running in
[cmux](https://cmux.com).**

cmux already tells you which agent is running, idle, or waiting for approval —
its native hooks give you the blue ring, sidebar state, Feed approval cards, and
session restore. The one thing it can't infer is **why** an agent is stuck.

cmux-skills adds exactly that: when an agent decides it needs you — a missing
credential, a decision, an error it can't resolve — it runs one command and its
cmux tab turns **red with the reason**, plus a desktop notification, a sound, and
an optional **spoken voice readout**. When you run many agents at once, an
audible *"agent 3 is blocked waiting on an API key"* beats a ring you have to be
looking at.

```
┌─ cmux native ─────────────┐   ┌─ cmux-skills adds ───────────────────────┐
│ running · idle · approval │ + │ 🔴 "waiting on STRIPE_KEY"  🔔🔊  "…spoken" │
└───────────────────────────┘   └──────────────────────────────────────────┘
```

It runs in-process inside the agent's own cmux pane and, when run outside a cmux
pane, every command safely no-ops — so it's drop-in safe for headless/CI runs.

---

## 1. Foundation: let cmux own the lifecycle (native, no skill)

This step is **cmux's**, not ours — but it's the right base, so it's documented
here. cmux ships native agent hooks that handle running/idle state,
notifications, Feed approvals, and session restore for a fixed list of agents:

```bash
cmux hooks setup                 # install for every supported agent on your PATH
cmux hooks setup <agent>         # or just one, e.g. cmux hooks setup codex
cmux hooks <agent> uninstall     # remove one
```

Supported agents: `claude` (auto-injected by the cmux Claude wrapper when Claude
Code integration is on in **Settings**), `codex`, `grok`, `opencode`, `pi`,
`amp`, `cursor`, `gemini`, `kiro`, `rovodev`/`rovo`, `copilot`, `codebuddy`,
`factory`, `qoder`, and `hermes-agent`.

**Claude Code** needs nothing — the cmux Claude wrapper injects its hooks
automatically. **Hermes** is one command:

```bash
cmux hooks hermes-agent install
hermes gateway restart           # reload ~/.hermes/config.yaml so it takes effect
```

Relevant `~/.config/cmux/cmux.json` toggles (set in **Settings** too):

```jsonc
{
  // per-agent native integrations
  "claudeCodeIntegration": true,
  "cursorIntegration": true,
  "geminiIntegration": true
}
```

Verify it's live — native hooks record sessions under
`~/.cmuxterm/<agent>-hook-sessions.json`, and `cmux-skills doctor` reports which
it finds.

> Full native matrix (session-restore commands, Feed bridges, env overrides):
> `cmux docs agents`, or
> <https://raw.githubusercontent.com/manaflow-ai/cmux/main/docs/agent-hooks.md>

## 2. Layer cmux-skills on top (the voice/reason escalation)

```bash
# install globally so the `cmux-skills` command is on your PATH (recommended)
npm i -g cmux-skills
cmux-skills init                 # create config + show a health check

# Hermes: append block/clear guidance to SOUL.md so the agent knows to escalate
cmux-skills install hermes

# any other agent: print the exact wiring
cmux-skills install generic
```

The agent (or your loop) then calls, from inside its cmux pane:

```bash
cmux-skills block "<concise reason>"   # red tab + reason + notify + sound + voice
cmux-skills clear                      # once a human has unblocked you
```

For **Hermes**, `install hermes` adds idempotent guidance to `~/.hermes/SOUL.md`
telling the agent to do exactly that (and removes any legacy lifecycle hook from
older cmux-skills versions so it can't fight the native hooks). Pass `--no-soul`
to skip the SOUL.md edit.

## 3. Agents cmux doesn't support natively

For a custom loop, a shell-script agent, a CI pipeline, or a brand-new CLI cmux
hasn't added yet, there's no native lifecycle — so cmux-skills can drive the
whole tab. `cmux-skills install generic` prints the wiring; in short, bracket the
run and escalate on the blocked path:

```bash
cmux-skills status working      # run/turn starts  -> green
cmux-skills status done         # run/turn idle    -> yellow
cmux-skills block "<reason>"    # needs a human    -> red + reason + notify + voice
cmux-skills clear               # unblocked        -> neutral
cmux-skills status normalize    # startup recovery -> drop stale, keep a real block
```

`working`/`done`/`normalize` are only needed here — for natively-supported agents
cmux already does them.

## How the escalation works

cmux authenticates its CLI **only from inside a cmux pane** (it injects
`CMUX_WORKSPACE_ID` + socket auth), so everything runs in-process in the agent's
own pane and targets the *caller* workspace.

| State       | Tab          | Trigger                                              |
| ----------- | ------------ | --------------------------------------------------- |
| `blocked`   | red + reason | the agent calls `cmux-skills block "<reason>"`      |
| `clear`     | neutral      | explicit `cmux-skills clear`                        |
| `working`   | green        | (generic wiring) a run/turn starts                  |
| `done`      | yellow       | (generic wiring) the run/turn finishes (idle)       |
| `normalize` | recovery     | (generic wiring) startup; drops stale, non-blocked state |

A blocked marker is **sticky**: cmux's native idle state won't erase it, and
`done` won't override red while it's set — only `working` or `clear` does. So a
"needs human" signal is never silently lost. Overlapping/nested runs are
reference-counted so the tab doesn't flip early.

## CLI

```
cmux-skills init                     Create default config and show status
cmux-skills doctor                   Diagnose cmux install, native hooks, config, workspace
cmux-skills block "<reason>" [opts]  Mark blocked (red + reason + notify + sound + voice)
cmux-skills clear                    Clear all signals on the current tab
cmux-skills status <state> [opts]    working | done | blocked | clear | normalize
cmux-skills install <adapter>        hermes | generic   (--no-soul to skip SOUL.md)
cmux-skills uninstall hermes
cmux-skills config <path|show>
cmux-skills version
```

Options for `status`/`block`: `--reason "<text>"`, `--details "<text>"`,
`--workspace <id>`.

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

## How this relates to cmux's native hooks

cmux-skills used to reimplement lifecycle coloring; cmux now does that natively
(and better — with session restore and Feed approvals). So cmux-skills is
deliberately scoped to the gap: the **blocked-with-a-reason + voice** escalation
on top of native hooks, plus full coverage for agents cmux doesn't support yet.
Use `cmux hooks setup` for lifecycle; use cmux-skills for "I need a human, and
here's why."

## License

MIT © kaseonedge
