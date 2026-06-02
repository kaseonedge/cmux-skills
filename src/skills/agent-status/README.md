# agent-status

Voice-first Hermes/OpenClaw blocked-action state machine for cmux.

cmux native Hermes hooks (`cmux hooks hermes-agent install`) own lifecycle: running, idle, approvals, feed events, and restore. This module only adds the signal cmux cannot infer: **Hermes knows why it needs a human and what action the human should take**.

## States

| Call | Effect |
| --- | --- |
| `apply('blocked', cfg, {reason, action, details})` | sticky red tab + reason/action description + notify + flash + sound + brokered voice |
| `apply('clear', cfg)` | clear the blocked signal and reset counters |
| `apply('working', cfg)` | legacy compatibility: clear blocked marker, increment active-run counter, set green |
| `apply('done', cfg)` | legacy compatibility: decrement active-run counter, set yellow only when not blocked |
| `apply('normalize', cfg)` | legacy compatibility: drop stale non-blocked state, preserve a genuine block |

All calls no-op with `{state:'skipped', reason:'not-in-cmux'}` when `CMUX_WORKSPACE_ID` is unset.

## Design notes

- **Hermes/OpenClaw scope**: docs/install paths should point to `cmux-voice`; `hermes-cmux` and `cmux-skills` remain backward-compatible binary aliases. Hermes is verified; OpenClaw is pending integration testing.
- **Sticky blocked**: a disk marker under `~/.local/state/cmux-hermes/` means cmux native idle state and legacy `done` cannot erase a real blocked state; only a new `working` run or explicit `clear` does.
- **Voice-first and action-bearing**: the default template is `Hermes needs you. {action}: {reason}. {details}` so smoke tests and live alerts say what the user should do, not just that something happened. ElevenLabs falls back to macOS `say`; legacy `none` is treated as `say`.
- **Brokered by default**: voice events go through the local cross-session queue under `~/.local/state/cmux-hermes/`, are ordered by priority then age, coalesce duplicate pending alerts, expire stale work by TTL, and are drained by a singleton worker so sessions speak one at a time.
- **Non-blocking caller**: the agent process only enqueues and starts the worker; the worker runs the selected TTS provider synchronously to serialize audio without delaying the agent.
- **Lifecycle is cmux's job**: use `cmux hooks hermes-agent install` for lifecycle and `cmux-voice block` / `cmux-voice clear` for human escalation.
