// A protocol's future token is worth about what tokens of its own kind are worth,
// measured as market cap divided by TVL, taken from the snapshot's own live-token protocols.

import type { Snapshot } from './model.ts';

export interface CategoryComp {
  category: string;
  n: number;
  median_fdv_tvl: number;
}

/** Compute the median of an array of numbers. */
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

/**
 * Builds comparable category valuations from live-token protocols in the snapshot.
 * A protocol "has a token" when mcap_usd is a positive number AND tvl_usd is a positive number.
 */
export function buildComps(snapshot: Snapshot): Map<string, CategoryComp> {
  const groups = new Map<string, number[]>();

  for (const p of snapshot.protocols) {
    if (
      typeof p.mcap_usd === 'number' &&
      Number.isFinite(p.mcap_usd) &&
      p.mcap_usd > 0 &&
      typeof p.tvl_usd === 'number' &&
      Number.isFinite(p.tvl_usd) &&
      p.tvl_usd > 0
    ) {
      const ratio = p.mcap_usd / p.tvl_usd;
      const catKey = p.category === null ? 'Unknown' : p.category;
      let list = groups.get(catKey);
      if (!list) {
        list = [];
        groups.set(catKey, list);
      }
      list.push(ratio);
    }
  }

  const result = new Map<string, CategoryComp>();
  for (const [category, ratios] of groups.entries()) {
    if (ratios.length >= 3) {
      result.set(category, {
        category,
        n: ratios.length,
        median_fdv_tvl: round4(median(ratios)),
      });
    }
  }

  return result;
}

/**
 * Returns the multiple to apply for a category.
 * If the category is in the map, uses its median_fdv_tvl and basis 'category median FDV/TVL from N protocols'.
 * If absent or null, falls back to the global median over every protocol that has a token,
 * with basis 'global median FDV/TVL from N protocols'.
 */
export function compMultiple(
  comps: Map<string, CategoryComp>,
  category: string | null,
  globalMedian: number
): { multiple: number; basis: string; n: number } {
  const catKey = category === null ? 'Unknown' : category;
  const comp = comps.get(catKey);

  if (comp !== undefined) {
    return {
      multiple: round4(comp.median_fdv_tvl),
      basis: `category median FDV/TVL from ${comp.n} protocols`,
      n: comp.n,
    };
  }

  // Calculate global N by summing n across all comps or defaulting
  let globalN = 0;
  for (const c of comps.values()) {
    globalN += c.n;
  }

  return {
    multiple: round4(globalMedian),
    basis: `global median FDV/TVL from ${globalN} protocols`,
    n: globalN,
  };
}
