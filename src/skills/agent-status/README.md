# agent-status

Hermes blocked-action state machine for cmux.

cmux native Hermes hooks (`cmux hooks hermes-agent install`) own lifecycle: running, idle, approvals, feed events, and restore. This module only adds the signal cmux cannot infer: **Hermes knows why it needs a human and what action the human should take**.

## States

| Call | Effect |
| --- | --- |
| `apply('blocked', cfg, {reason, details})` | sticky red tab + reason pill/description + notify + flash + sound + voice |
| `apply('clear', cfg)` | clear the blocked signal and reset counters |
| `apply('working', cfg)` | legacy compatibility: clear blocked marker, increment active-run counter, set green |
| `apply('done', cfg)` | legacy compatibility: decrement active-run counter, set yellow only when not blocked |
| `apply('normalize', cfg)` | legacy compatibility: drop stale non-blocked state, preserve a genuine block |

All calls no-op with `{state:'skipped', reason:'not-in-cmux'}` when `CMUX_WORKSPACE_ID` is unset.

## Design notes

- **Hermes-specific scope**: docs/install paths should point to `hermes-cmux`; `cmux-skills` remains only as a backward-compatible binary alias.
- **Sticky blocked**: a disk marker under `~/.local/state/cmux-hermes/` means cmux native idle state and legacy `done` cannot erase a real blocked state; only a new `working` run or explicit `clear` does.
- **Voice includes action**: the default template is `Hermes needs you. {action}: {reason}. {details}` so smoke tests and live alerts say what the user should do, not just that something happened.
- **Non-blocking**: sound and voice are detached, fire-and-forget, and bounded so they never delay Hermes.
- **Lifecycle is cmux's job**: use `cmux hooks hermes-agent install` for lifecycle and `hermes-cmux block` / `hermes-cmux clear` for human escalation.
