# agent-status

The first cmux-skill: drive the cmux workspace tab from an AI agent's lifecycle.

- **green** — a run is in progress (`working`)
- **yellow** — idle / finished this turn (`done`); not "goal achieved"
- **red** — blocked, needs a human (`blocked`) with the reason on the tab plus an
  optional notification, sound and voice readout
- **clear** / **normalize** — reset and recovery

See the [root README](../../../README.md) for install and configuration. The
state machine lives in [`index.js`](./index.js); framework wiring lives in
[`adapters/`](./adapters).

## States

| Call                              | Effect                                                    |
| --------------------------------- | --------------------------------------------------------- |
| `apply('working', cfg)`           | clears blocked marker, +1 run counter, tab → green        |
| `apply('done', cfg)`              | −1 run counter; tab → yellow when last run ends & not blocked |
| `apply('blocked', cfg, {reason})` | sticky red + pill + description + notify + flash + sound + voice |
| `apply('clear', cfg)`             | remove all signals, reset counters                        |
| `apply('normalize', cfg)`         | recovery: reset counters, keep a genuine blocked marker   |

All calls no-op (`{state:'skipped', reason:'not-in-cmux'}`) when
`CMUX_WORKSPACE_ID` is unset.

## Design notes

- **Sticky blocked**: a disk marker (`~/.local/state/cmux-skills/`) means `done`
  can't erase a real `blocked` state; only a new `working` run clears it.
- **Overlap-safe**: an active-run counter keeps the tab green until the *last* of
  several concurrent runs finishes.
- **Recovery**: `normalize` (run on gateway startup) drops stale green/yellow but
  preserves an outstanding blocked marker across restarts.
- **Non-blocking**: sound and voice are detached, fire-and-forget, and bounded so
  they never delay the host agent.
