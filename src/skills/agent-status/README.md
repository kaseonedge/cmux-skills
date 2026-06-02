# agent-status

Drive the cmux workspace tab when an AI agent needs a human — the escalation
layer that sits on top of cmux's native agent hooks.

cmux's native hooks (`cmux hooks setup`) own the lifecycle (running / idle /
awaiting approval / restore). This skill adds the signal cmux can't infer:

- **red** — blocked, needs a human (`blocked`), with the **reason** on the tab
  plus a notification, sound and optional voice readout
- **clear** — dismiss the signal once unblocked

For agents cmux does **not** support natively, the same state machine can drive
the whole tab:

- **green** — a run is in progress (`working`)
- **yellow** — idle / finished this turn (`done`); not "goal achieved"
- **normalize** — startup recovery

See the [root README](../../../README.md) for setup and configuration. The state
machine lives in [`index.js`](./index.js); framework wiring lives in
[`adapters/`](./adapters).

## States

| Call                              | Effect                                                    |
| --------------------------------- | --------------------------------------------------------- |
| `apply('blocked', cfg, {reason})` | sticky red + pill + description + notify + flash + sound + voice |
| `apply('clear', cfg)`             | remove all signals, reset counters                        |
| `apply('working', cfg)`           | (generic) clears blocked marker, +1 run counter, tab → green |
| `apply('done', cfg)`              | (generic) −1 run counter; tab → yellow when last run ends & not blocked |
| `apply('normalize', cfg)`         | (generic) recovery: reset counters, keep a genuine blocked marker |

All calls no-op (`{state:'skipped', reason:'not-in-cmux'}`) when
`CMUX_WORKSPACE_ID` is unset.

## Design notes

- **Sticky blocked**: a disk marker (`~/.local/state/cmux-skills/`) means cmux's
  native idle state and our own `done` can't erase a real `blocked` state; only a
  new `working` run or an explicit `clear` does.
- **Overlap-safe**: an active-run counter keeps the tab green until the *last* of
  several concurrent runs finishes (generic wiring).
- **Recovery**: `normalize` drops stale green/yellow but preserves an outstanding
  blocked marker across restarts.
- **Non-blocking**: sound and voice are detached, fire-and-forget, and bounded so
  they never delay the host agent.
- **Lifecycle is cmux's job**: for natively-supported agents, prefer
  `cmux hooks setup` and use this skill only for `blocked`/`clear`.
