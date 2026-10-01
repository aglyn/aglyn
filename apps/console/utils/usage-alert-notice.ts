/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * WHEN A USAGE NOTICE IS DUE, AND THE WORDS IT IS BUILT FROM (AGL-3431).
 *
 * Pure, and imported by `api/billing/usage-alerts` from here rather than
 * through a barrel: the route's specs stub the server barrels wholesale, and a
 * dedupe rule that a stub could replace is a dedupe rule nothing tests.
 */

/**
 * How often one quota may announce the same threshold.
 *
 * - `crossing` — a thing the workspace HAS: sites, pages on a site, datasets,
 *   stored bytes. Being at the limit is a state, not an event, and it can last
 *   for months. The notice goes out when the threshold is first reached and
 *   not again while usage stays at or above it — not the next day and not the
 *   next month. It RE-ARMS when usage falls back below, so a later
 *   re-crossing is announced like the first.
 * - `monthly` — a meter that resets on the 1st: email sends, runs, bandwidth,
 *   AI credits. Once per threshold per month IS once per crossing, because
 *   every month starts from zero.
 */
export type UsageAlertCadence = 'crossing' | 'monthly'

/** One entry of `orgs/{orgId}.usageAlerts`, as stored. */
export interface UsageAlertGuard {
  month?: string
  threshold?: number
}

/** The guard a send or a re-arm writes. */
export interface UsageAlertGuardEntry {
  month: string
  threshold: number
}

export type UsageAlertGuardDecision =
  /** Nothing to send and nothing to write. */
  | { action: 'none' }
  /** A threshold newly reached: announce it and record `guard`. */
  | { action: 'send'; guard: UsageAlertGuardEntry }
  /**
   * Usage fell below the threshold last announced. Nothing is sent; the
   * guard is lowered to the band usage is in now, or removed (`null`) when it
   * is below every band, so the next crossing is new again.
   */
  | { action: 'rearm'; guard: UsageAlertGuardEntry | null }

/**
 * Whether a quota's notice is due, and what its guard becomes.
 *
 * `threshold` is what `usageAlertThreshold` answered for today's reading: the
 * highest band reached (75, 80, 90 or 100), or 0 for below every band. The
 * stored guard is the highest band announced, so a step is sent only when it
 * is above that, and a reading that falls to a LOWER band lowers the guard to
 * it — 90 announced, 85% today, guard 80 — so climbing back announces 90
 * again. A quota whose limit is unlimited or absent passes 0, which re-arms a
 * `crossing` guard — the band it announced no longer exists.
 *
 * A guard written under the old two-step ladder (80 or 100) reads the same
 * way: 80 held with usage at 83% sends nothing, and usage at 92% sends 90.
 *
 * A LEGACY GUARD COUNTS. Before AGL-3431 every guard was month-scoped, so a
 * workspace sitting at its site limit since July holds a September guard at
 * threshold 100. For a `crossing` quota that month is ignored: the notice
 * went out, and a guard from an earlier month means "announced", not
 * "announced last month, so due again". Reading it any other way would mail
 * every workspace at a limit on the day this shipped.
 *
 * `measured: false` holds a `crossing` guard where it is. A reading that could
 * not be taken (a rollup without the figure) reads as 0, and re-arming on it
 * would announce the same limit again the day the figure came back.
 */
export function usageAlertGuardDecision(input: {
  cadence: UsageAlertCadence
  threshold: number
  guard: UsageAlertGuard | undefined
  month: string
  measured?: boolean
}): UsageAlertGuardDecision {
  const { cadence, threshold, guard, month } = input
  const held = Number(guard?.threshold)
  const announced = Number.isFinite(held) && held > 0 ? held : 0
  if (cadence === 'monthly') {
    if (!(threshold > 0)) return { action: 'none' }
    if (guard?.month === month && announced >= threshold) return { action: 'none' }
    return { action: 'send', guard: { month, threshold } }
  }
  if (threshold > announced) return { action: 'send', guard: { month, threshold } }
  if (threshold === announced || input.measured === false) return { action: 'none' }
  return {
    action: 'rearm',
    guard: threshold > 0 ? { month, threshold } : null,
  }
}

/**
 * The workspace, named the way a notice body opens.
 *
 * An owner who belongs to several workspaces must be able to tell from the
 * body alone which one the notice is about; the subject line and the footer
 * are not always read.
 */
export function workspacePhrases(name: string | null | undefined): {
  /** "The Acme workspace" — the subject of a sentence. */
  subject: string
  /** "the Acme workspace" — mid-sentence. */
  object: string
  /** "The Acme workspace's" */
  possessive: string
} {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) {
    return {
      subject: 'Your workspace',
      object: 'your workspace',
      possessive: "Your workspace's",
    }
  }
  return {
    subject: `The ${trimmed} workspace`,
    object: `the ${trimmed} workspace`,
    possessive: `The ${trimmed} workspace's`,
  }
}

/** A whole number with thousands separators. */
export function formatCount(value: number): string {
  return Math.round(Number(value) || 0).toLocaleString('en-US')
}

/** Stored bytes, in MB, as a person reads them: `250 MB`, `2 GB`, `10.5 GB`. */
export function formatStorageMb(mb: number): string {
  const value = Math.max(0, Number(mb) || 0)
  if (value < 1024) return `${formatCount(value)} MB`
  const gb = Math.round((value / 1024) * 10) / 10
  return `${gb.toLocaleString('en-US')} GB`
}

/** Bandwidth, to one decimal place: `2 GB`, `2.4 GB`. */
export function formatBandwidthGb(gb: number): string {
  const value = Math.round(Math.max(0, Number(gb) || 0) * 10) / 10
  return `${value.toLocaleString('en-US')} GB`
}

/**
 * "`used` of the `limit` `noun` your plan includes", or, past the limit,
 * "`used` `noun` — more than the `limit` your plan includes". `suffix` rides
 * at the end of either ("per site", "this month").
 *
 * The figures are pre-formatted by the caller, so one phrase serves counts,
 * storage and bandwidth alike.
 */
export function usagePhrase(input: {
  used: number
  limit: number
  usedText: string
  limitText: string
  noun: string
  suffix?: string
}): string {
  const tail = input.suffix ? ` ${input.suffix}` : ''
  if (input.used > input.limit) {
    return `${input.usedText} ${input.noun} — more than the ${input.limitText} your plan includes${tail}`
  }
  return `${input.usedText} of the ${input.limitText} ${input.noun} your plan includes${tail}`
}

/** `a`, `a and b`, `a, b and c`. */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
