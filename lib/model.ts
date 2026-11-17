// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and may add
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board.
//
// Implied value follows only from the snapshot's own figures:
//
//   comparable = the category's median market-cap-to-TVL from the snapshot's live-token protocols,
//                shrunk toward the global median by sample size (see lib/comps.ts, SHRINK_K)
//   base       = tvl_usd x comparable
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity   = MATURITY_FLOOR + min(age_days, 1095) / 1095 x MATURITY_RANGE   (age_days unknown: 365)
//   implied    = max(1, round(base x growthMult x maturity))
//
// Why these weights, and not a fitted regression: the snapshot was back-tested (see backtest() below,
// run at build time and reported on the dashboard). Implied value is only weakly predictable from a
// single snapshot - the best leave-one-out Spearman on this snapshot's live protocols is about 0.40 - so
// a fitted regression buys no out-of-sample ranking and can take economically wrong signs. What does help,
// consistently, is shrinking a thin category's comparable toward the global median; that is what the
// SHRINK_K pseudo-count does. The growth and maturity weights are kept modest and positive so the model
// is stable and its signs are the ones a reader expects: faster growth and longer life raise value. The
// maturity floor is high (0.85) because a protocol that has run for years with no token is not young; the
// range (0.15) is small so maturity refines the ranking without dominating the TVL and comparable terms.
//
// The constants are the house model's, stated in the dashboard and changeable in the model sandbox. No
// protocol name is ever special-cased: the same function scores every row.

import { buildComps, compMultiple, globalComparable } from './comps.ts';
import type { CategoryComp } from './comps.ts';

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.25,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.85,
  maturity_range: 0.15,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
    comp_basis: string;
    comp_multiple: number;
    comp_weight: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  comp_basis: string;
  comp_multiple: number;
  comp_weight: number;
  on_watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One calibration bucket the dashboard shows: a category and the comparable it carries. */
export interface CalibrationRow {
  category: string;
  n: number;
  median_fdv_tvl: number;
  weight: number;
  used: number;
}

/** The leave-one-out back-test the build runs against the snapshot's own live protocols. */
export interface Backtest {
  n: number;
  spearman: number;
  rmse_log: number;
  median_abs_pct_error: number;
  within_2x: number;
  within_5x: number;
  note: string;
}

/** Everything the dashboard needs: the board, the live set, the model it runs, and its calibration. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  calibration: CalibrationRow[];
  backtest: Backtest;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The clamped seven-day growth the model uses, in per cent. */
export function growthPct(protocol: SnapshotProtocol, model: ModelConstants): number {
  const rawGrowth = finite(protocol.change_7d, 0);
  return Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
}

/** The maturity multiplier for an age in days (null becomes the model's unknown-age default). */
export function maturityMultiplier(age: number | null, model: ModelConstants): number {
  const ageForModel = age ?? model.unknown_age_days;
  return model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  comps: Map<string, CategoryComp>,
  global: { value: number; n: number },
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null; comp_basis: string; comp_multiple: number; comp_weight: number } {
  const age = ageDays(asOf, protocol.listed_at);
  const growth = growthPct(protocol, model);
  const growthMult = 1 + (growth / 100) * model.growth_weight;
  const maturity = maturityMultiplier(age, model);
  const cm = compMultiple(comps, protocol.category, global);
  const base = protocol.tvl_usd * cm.multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturity));
  return {
    implied,
    growthPct: growth,
    growthMult,
    maturityMult: maturity,
    age,
    comp_basis: cm.basis,
    comp_multiple: cm.multiple,
    comp_weight: cm.weight,
  };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const comps = buildComps(snapshot);
  const global = globalComparable(snapshot);

  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, v: impliedValue(p, snapshot.as_of, model, comps, global) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      age_days: s.v.age,
      comp_basis: s.v.comp_basis,
      comp_multiple: round4(s.v.comp_multiple),
      comp_weight: round4(s.v.comp_weight),
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** A compact TVL string for the plan's prose, so each step names the protocol's own size. */
function tvlWords(tvl: number): string {
  if (tvl >= 1_000_000_000) return `$${(tvl / 1_000_000_000).toFixed(1)}B`;
  if (tvl >= 1_000_000) return `$${Math.round(tvl / 1_000_000)}M`;
  return `$${Math.round(tvl / 1_000)}K`;
}

/** How long the protocol has run with no token, in words. */
function ageWords(age: number | null): string {
  if (age === null) return 'an unrecorded time';
  if (age >= 730) return `${(age / 365).toFixed(1)} years`;
  if (age >= 365) return 'a year';
  if (age >= 60) return `${Math.round(age / 30)} months`;
  return `${age} days`;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `supply $${capital} of USDC to ${name} on ${chain} and keep the position open`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open`;
  if (c.includes('bridge')) return `bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app`;
  if (c.includes('staking') || c.includes('restak')) return `stake $${capital} of the chain's staking asset through ${name} and keep the receipt`;
  if (c.includes('perpetual') || c.includes('derivative')) return `deposit $${capital} of USDC as margin on ${name} and open one small hedge`;
  if (c.includes('prediction')) return `fund $${capital} and place one market position on ${name}`;
  if (c.includes('curator') || c.includes('allocator')) return `deposit $${capital} into a ${name} vault on ${chain} and keep the shares`;
  if (c.includes('stable')) return `mint or deposit $${capital} of the stable asset through ${name} on ${chain}`;
  if (c.includes('rwa')) return `mint $${capital} of the protocol's yield asset on ${chain} and hold it`;
  if (c.includes('insurance')) return `buy $${capital} of cover from ${name} on ${chain} and keep the policy`;
  return `deposit $${capital} of USDC into ${name} on ${chain} and keep the position open`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, each naming the
 * protocol's own figures (its TVL, chain, category and how long it has run with no token). The plan is
 * derived from the protocol's own record, never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const tvl = tvlWords(p.tvl_usd);
  const ran = ageWords(age);
  return [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline; never reuse a wallet that holds other assets.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: `On ${chain}, ${action}. ${p.name} holds ${tvl} of TVL, so $${capital} is a position that registers with it without risking much.`,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action every week — a deposit, a borrow, a swap or a vote — so the activity is counted in more than one weekly snapshot.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `${p.name} has run ${ran} with no token, so hold the position at least ${hold} days; a longer, unbroken record is what a launch rewards.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own docs or points page and confirm the current reward rule, because a season's rules change between rounds.`,
      cost: 'nothing to read the rules',
      time: '10 minutes',
    },
    {
      text: `Claim only from a link ${p.name} publishes on its own site or docs — never a link from a direct message or an advertisement.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log, so you can repeat the position or unwind it without guessing.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow, onWatchlist: boolean): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    comp_basis: row.model.comp_basis,
    comp_multiple: row.model.comp_multiple,
    comp_weight: row.model.comp_weight,
    on_watchlist: onWatchlist,
  };
}

/** The categories a board row actually uses, with the comparable each carries, for the dashboard. */
export function calibrationRows(snapshot: Snapshot, board: BoardRow[]): CalibrationRow[] {
  const comps = buildComps(snapshot);
  const global = globalComparable(snapshot);
  const seen = new Set<string>();
  const rows: CalibrationRow[] = [];
  for (const r of board) {
    const key = r.category ?? 'Unknown';
    if (seen.has(key)) continue;
    seen.add(key);
    const cm = compMultiple(comps, r.category, global);
    rows.push({ category: key, n: cm.n, median_fdv_tvl: round4(cm.categoryMedian), weight: round4(cm.weight), used: round4(cm.multiple) });
  }
  rows.sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return rows;
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, watchlist.has(r.slug))),
    live,
    calibration: calibrationRows(snapshot, board),
    backtest: backtest(snapshot, model),
  };
  return { board, radar };
}

/** Spearman's rank correlation between two equal-length arrays. */
export function spearman(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const rank = (v: number[]): number[] => {
    const order = v.map((value, i) => ({ value, i })).sort((a, b) => a.value - b.value);
    const r = new Array<number>(n);
    for (let i = 0; i < n; i++) r[order[i]!.i] = i + 1;
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const mean = (n + 1) / 2;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i]! - mean;
    const b = ry[i]! - mean;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

/**
 * The leave-one-out back-test: for every live-token protocol, predict its market cap from the model with
 * its own row held out of the comparables, then measure rank correlation and error against the truth.
 * This is the evidence the dashboard reports that the value model carries real signal, and it is honest
 * about the limit: a single snapshot predicts market cap only weakly.
 */
export function backtest(snapshot: Snapshot, model: ModelConstants = MODEL): Backtest {
  const live = snapshot.protocols.filter(
    (p) => typeof p.mcap_usd === 'number' && p.mcap_usd > 0 && typeof p.tvl_usd === 'number' && p.tvl_usd > 0,
  );
  if (live.length < 3) {
    return { n: live.length, spearman: 0, rmse_log: 0, median_abs_pct_error: 0, within_2x: 0, within_5x: 0, note: 'too few live protocols to back-test' };
  }
  const predicted: number[] = [];
  const actual: number[] = [];
  for (const held of live) {
    // Comparables are built from every live protocol but the one being scored, so a row never explains itself.
    const others: Snapshot = { ...snapshot, protocols: snapshot.protocols.filter((p) => p.slug !== held.slug) };
    const comps = buildComps(others);
    const global = globalComparable(others);
    const v = impliedValue(held, snapshot.as_of, model, comps, global);
    predicted.push(Math.log(Math.max(1, v.implied)));
    actual.push(Math.log(held.mcap_usd!));
  }
  const n = live.length;
  let sq = 0;
  const pctErrors: number[] = [];
  let within2 = 0;
  let within5 = 0;
  for (let i = 0; i < n; i++) {
    const diff = predicted[i]! - actual[i]!;
    sq += diff * diff;
    const ratio = Math.exp(Math.abs(diff));
    pctErrors.push(Math.abs(ratio - 1));
    if (ratio <= 2) within2++;
    if (ratio <= 5) within5++;
  }
  pctErrors.sort((a, b) => a - b);
  const median = pctErrors[Math.floor(n / 2)]!;
  return {
    n,
    spearman: round4(spearman(predicted, actual)),
    rmse_log: Math.round(Math.sqrt(sq / n) * 1e4) / 1e4,
    median_abs_pct_error: Math.round(median * 1e4) / 1e4,
    within_2x: round4(within2 / n),
    within_5x: round4(within5 / n),
    note: 'leave-one-out over the snapshot own live-token protocols; each row is held out of its own comparables',
  };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
