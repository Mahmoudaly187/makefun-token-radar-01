// The comparable-value model: a pre-token protocol's future token is worth about what tokens of its
// own kind are worth, measured as market cap divided by TVL, taken from the snapshot's live-token
// protocols. No name is ever special-cased; the yardstick is read from the data.
//
// The yardstick shrinks each category's median toward the global median by its sample size (a
// pseudo-count of SHRINK_K), so a category read from only one or two live protocols does not swing a
// row's implied value on a single observation. This matters here: the watchlist is concentrated in thin
// categories - Risk Curators, CeDeFi, Insurance, Governance Incentives, Stablecoin Wrapper, Collateral
// Markets - where a bare category median is unreliable. The shrinkage weight is stated on the dashboard.

import type { Snapshot } from './model.ts';

/** Pseudo-count that controls how far a thin category's median is pulled to the global median. */
export const SHRINK_K = 12;

export interface CategoryComp {
  category: string;
  n: number;
  median_fdv_tvl: number;
}

/** The median of an array of numbers, or 0 for an empty array. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

/** Round a number to 4 decimal places. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whether a protocol records a token the comparable can be read from: positive market cap and TVL. */
function hasLiveToken(p: { mcap_usd: number | null; tvl_usd: number }): boolean {
  return typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) && p.mcap_usd > 0 && typeof p.tvl_usd === 'number' && Number.isFinite(p.tvl_usd) && p.tvl_usd > 0;
}

/**
 * Builds comparable category valuations from the snapshot's live-token protocols. Each category's entry
 * is the median market-cap-to-TVL of its live protocols; a category with no live protocol is absent, and
 * the model falls back to the global median for it.
 */
export function buildComps(snapshot: Snapshot): Map<string, CategoryComp> {
  const groups = new Map<string, number[]>();

  for (const p of snapshot.protocols) {
    if (!hasLiveToken(p)) continue;
    const ratio = p.mcap_usd! / p.tvl_usd;
    const catKey = p.category === null ? 'Unknown' : p.category;
    let list = groups.get(catKey);
    if (!list) {
      list = [];
      groups.set(catKey, list);
    }
    list.push(ratio);
  }

  const result = new Map<string, CategoryComp>();
  for (const [category, ratios] of groups.entries()) {
    result.set(category, { category, n: ratios.length, median_fdv_tvl: round4(median(ratios)) });
  }

  return result;
}

/** The global median FDV/TVL over every protocol that records a token, with its sample size. */
export function globalComparable(snapshot: Snapshot): { value: number; n: number } {
  const ratios: number[] = [];
  for (const p of snapshot.protocols) {
    if (hasLiveToken(p)) ratios.push(p.mcap_usd! / p.tvl_usd);
  }
  return { value: round4(median(ratios)), n: ratios.length };
}

/**
 * The multiple to apply for a category, shrunk toward the global median by sample size: a category with
 * n live comparables puts weight n / (n + SHRINK_K) on its own median and the rest on the global median,
 * so one comparable barely moves the multiple and many carry it. A category with no comparable uses the
 * global median outright.
 */
export function compMultiple(
  comps: Map<string, CategoryComp>,
  category: string | null,
  global: { value: number; n: number },
): { multiple: number; basis: string; n: number; categoryMedian: number; weight: number } {
  const catKey = category === null ? 'Unknown' : category;
  const comp = comps.get(catKey);

  if (comp !== undefined) {
    const weight = comp.n / (comp.n + SHRINK_K);
    const shrunk = weight * comp.median_fdv_tvl + (1 - weight) * global.value;
    return {
      multiple: round4(shrunk),
      basis: `category median FDV/TVL from ${comp.n} live protocols, shrunk ${(weight * 100).toFixed(0)}% toward the global median`,
      n: comp.n,
      categoryMedian: comp.median_fdv_tvl,
      weight: round4(weight),
    };
  }

  return {
    multiple: global.value,
    basis: `global median FDV/TVL from ${global.n} live protocols (no live comparable in this category)`,
    n: 0,
    categoryMedian: global.value,
    weight: 0,
  };
}
