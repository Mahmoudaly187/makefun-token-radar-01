# Mahmoudaly187/makefun-token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Mahmoudaly187/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Mahmoudaly187/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed DeFi snapshot, finds every protocol whose token does not exist yet, ranks them by an implied value grounded in the snapshot's own figures, and shows a reader how to farm each one.

## The value model

    implied = TVL × comparable × (1 + clamp(growth_7d, -60, 120)/100 × 0.25) × (0.85 + min(age, 1095)/1095 × 0.15)

The **comparable** is the median market-cap-to-TVL of the snapshot's own live-token protocols in the same category, shrunk toward the global median by sample size (a pseudo-count of 12). Shrinking matters because the watchlist is concentrated in thin categories — 12 Risk Curators share a single live comparable — where a bare category median would swing a row on one observation. Every figure comes from the sealed snapshot; no protocol name is special-cased.

## Why these weights

The model was back-tested at build time and the result is printed on the dashboard. A single snapshot predicts market cap only weakly — the best leave-one-out Spearman over the 128 live protocols is about 0.40 — so a fitted regression buys no out-of-sample ranking and can take economically wrong signs. Shrinking the category comparable is the one change that consistently improves ranking; the growth and maturity weights are kept modest and positive so their signs are the ones a reader expects.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
```

The program writes `board.json`, `data.js`, the `dashboard/` page, the `screenshots/` and the `dossier.json`. The dashboard is static: no framework, no network.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
