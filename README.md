# Mahmoudaly187/makefun-token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Mahmoudaly187/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Mahmoudaly187/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed DeFi snapshot, finds every protocol whose token does not exist yet, ranks them by an implied value grounded in the snapshot's own figures, and shows a reader how to farm each one. The implied value is the protocol's TVL times the median market-cap-to-TVL of the live-token protocols in its own category (falling back to the global median), then adjusted by its seven-day growth and how long it has run with no token. Every protocol gets a six-step farm plan with a cost and a time per step. The output is a ranked board, a static dashboard (sortable, filterable, with a detail view per protocol) and a dossier.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
