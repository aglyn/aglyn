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

// Pure logic for `check:decision-log` (AGL-1908). No filesystem, no git, no
// network — the check script reads the bytes and hands them in, so every
// failure shape below is reachable from the self-test.
//
// ## The rule this makes executable
//
// The Pricing Source of Truth's "Change-control rule" says a price or
// entitlement change must move TOGETHER across code → Stripe → Figma →
// `aglyn.com/pricing` → the Source of Truth → the Decision Log. Four of those
// six legs are outside the repo and cannot be checked from CI. The sixth —
// "there is a recorded decision" — can be, and until now nothing did: an agent
// declined a real fix on 2026-08-24 partly because "AGL-1908's change-control
// rule requires publication legs I cannot do", with no artifact anywhere
// saying what had been decided or by whom.
//
// So this guard answers exactly one question, and says so plainly: **did a
// charged price or a granted entitlement move without a Decision Log entry
// moving with it?** It does not and cannot prove Figma, Stripe or the
// hand-authored marketing page were updated. `check:pricing-drift` covers
// code ↔ pin ↔ Stripe live ↔ the Drive Source of Truth; this covers the
// paperwork leg that one leaves alone.
//
// ## Why it compares PARSED VALUES, not changed file paths
//
// A path-level guard ("`plan-entitlements.ts` is in the diff, where is the
// log entry?") reds on comment edits and refactors. `d393d34a9` — a docblock
// explaining what a margin figure excludes — would have demanded a pricing
// decision. A guard people learn to route around is worse than none, so this
// parses the price and entitlement tables at both refs and compares the
// VALUES. Comments, formatting and helper functions move freely; a number or
// a boolean that a customer is charged or granted does not.

import { parsePlanRecord, parseUnitRates } from './pricing-drift.mjs'

/** Where the repo-side Decision Log lives. */
export const DECISION_LOG_PATH = 'docs/DECISION_LOG.md'

/**
 * The price surface: every constant whose value decides what a customer is
 * CHARGED or GRANTED.
 *
 * `ORG_COGS_UNIT_RATES_USD` and `METERED_UNIT_RATES_USD` are both here even
 * though one is a cost table, because the published metered rate is
 * `cost × METERED_MARKUP` — moving the cost moves the price. That is the whole
 * lesson of 2026-08-09, when wrong unit costs made the "cost + 30%" claim
 * false without anyone editing a price.
 */
export const WATCHED = Object.freeze([
  Object.freeze({
    path: 'libs/aglyn/src/lib/app-utils/plan-entitlements.ts',
    records: Object.freeze(['PLAN_PRICING', 'PLAN_ENTITLEMENTS']),
    rateTables: Object.freeze(['ORG_COGS_UNIT_RATES_USD']),
    scalars: Object.freeze([
      'METERED_MARKUP',
      'EVENT_CALENDAR_ADDON_MONTHLY_USD',
      'POS_REGISTER_ADDON_MONTHLY_USD',
    ]),
  }),
  Object.freeze({
    path: 'apps/console/utils/usage-metering.ts',
    records: Object.freeze([]),
    rateTables: Object.freeze(['METERED_UNIT_RATES_USD']),
    scalars: Object.freeze([]),
  }),
])

/** The fields every Decision Log entry must carry to count as a decision. */
export const REQUIRED_FIELDS = Object.freeze(['Decided by', 'Scope', 'Evidence'])

/**
 * Flatten the watched constants at one ref into `key → value`.
 *
 * @param sources - path → file contents, or `null` when the file is absent
 * @returns `{ values, unreadable }`. A watched constant that cannot be parsed
 *   lands in `unreadable`, NEVER in `values` — an empty parse and an unchanged
 *   price must not render the same, which is the failure mode that lets a
 *   renamed constant sail through as "nothing moved".
 */
export function priceSurface(sources) {
  const values = {}
  const unreadable = []
  for (const spec of WATCHED) {
    const src = sources?.[spec.path]
    if (typeof src !== 'string' || src.length === 0) {
      unreadable.push({ key: spec.path, detail: 'not present or empty at this ref' })
      continue
    }
    for (const name of spec.records) {
      const record = parsePlanRecord(src, name)
      const plans = Object.keys(record)
      if (!plans.length) {
        unreadable.push({ key: `${name}`, detail: `could not be parsed in ${spec.path}` })
        continue
      }
      for (const plan of plans) {
        for (const [field, value] of Object.entries(record[plan])) {
          values[`${name}.${plan}.${field}`] = value
        }
      }
    }
    for (const name of spec.rateTables) {
      const rates = parseUnitRates(src, name)
      if (!rates) {
        unreadable.push({ key: `${name}`, detail: `could not be parsed in ${spec.path}` })
        continue
      }
      for (const [field, value] of Object.entries(rates)) {
        values[`${name}.${field}`] = value
      }
    }
    for (const name of spec.scalars) {
      const m = src.match(new RegExp(`export const ${name}\\s*=\\s*(-?[\\d._]+)`))
      if (!m) {
        unreadable.push({ key: `${name}`, detail: `could not be parsed in ${spec.path}` })
        continue
      }
      values[name] = Number(m[1].replace(/_/g, ''))
    }
  }
  return { values, unreadable }
}

/** Every key whose value differs between two surfaces, including add/remove. */
export function surfaceDelta(base, head) {
  const keys = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort()
  const moved = []
  for (const key of keys) {
    const from = Object.prototype.hasOwnProperty.call(base, key) ? base[key] : undefined
    const to = Object.prototype.hasOwnProperty.call(head, key) ? head[key] : undefined
    if (from === to) continue
    moved.push({ key, from, to })
  }
  return moved
}

/**
 * Parse the repo Decision Log.
 *
 * Entry shape — deliberately strict, because a log that records a GUESS as a
 * decision is worse than no log:
 *
 *     ## 2026-08-19 — Free tier hard-caps at 3 workspaces per person
 *
 *     - **Decided by:** decided …
 *     - **Scope:** packaging
 *     - **Evidence:** `81c432500`, AGL-2265
 *
 * "Decided by" is what separates a decision from an opinion; "Evidence" is
 * what lets the next reader check it rather than believe it; "Scope" routes
 * the entry to the Drive cross-check below.
 */
export function parseDecisionLog(md) {
  const entries = []
  const problems = []
  if (typeof md !== 'string') return { entries, problems }
  const lines = md.split('\n')
  let current = null
  const flush = () => {
    if (current) entries.push(current)
    current = null
  }
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].match(/^## (\d{4}-\d{2}-\d{2}) — (.+?)\s*$/)
    if (heading) {
      flush()
      current = { date: heading[1], title: heading[2], line: i + 1, fields: {}, scope: [] }
      continue
    }
    if (/^## /.test(lines[i])) {
      // A non-dated `##` section (the preamble, "Open decisions", …). It ends
      // the entry it follows and is not itself an entry.
      flush()
      continue
    }
    if (!current) continue
    const field = lines[i].match(/^-\s+\*\*([^:*]+):\*\*\s*(.+?)\s*$/)
    if (field) current.fields[field[1].trim()] = field[2].trim()
  }
  flush()
  for (const entry of entries) {
    for (const required of REQUIRED_FIELDS) {
      if (!entry.fields[required]) {
        problems.push({
          key: `entry:${entry.date}`,
          detail: `"${entry.title}" (line ${entry.line}) has no **${required}:** line`,
        })
      }
    }
    entry.scope = (entry.fields['Scope'] ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  }
  return { entries, problems }
}

const MAX_LISTED = 20

/**
 * The change-control verdict.
 *
 * @param input.baseRef        - label for the ref `base*` was read at
 * @param input.baseSources    - path → contents at the base ref
 * @param input.headSources    - path → contents at HEAD / the worktree
 * @param input.baseLog        - `docs/DECISION_LOG.md` at the base ref, or null
 * @param input.headLog        - `docs/DECISION_LOG.md` at HEAD, or null
 */
export function changeControlVerdicts(input) {
  const { baseRef = 'the base ref', baseSources, headSources, baseLog, headLog } = input
  const verdicts = []
  const note = (status, key, detail) => verdicts.push({ status, key, detail })

  const base = priceSurface(baseSources)
  const head = priceSurface(headSources)
  for (const u of [...base.unreadable, ...head.unreadable]) {
    note('unreadable', `surface:${u.key}`, u.detail)
  }
  if (base.unreadable.length || head.unreadable.length) return verdicts

  const parsed = parseDecisionLog(headLog)
  if (headLog === null || headLog === undefined) {
    note('differs', 'log:present', `${DECISION_LOG_PATH} does not exist`)
  } else if (!parsed.entries.length) {
    // Refuse to no-op: an empty log must not satisfy a rule about the log.
    note('differs', 'log:entries', `${DECISION_LOG_PATH} records no dated entry`)
  } else {
    note('in-sync', 'log:entries', `${parsed.entries.length} dated entries, newest ${parsed.entries[0].date}`)
  }
  for (const p of parsed.problems) note('differs', p.key, p.detail)

  const moved = surfaceDelta(base.values, head.values)
  if (!moved.length) {
    note('in-sync', 'change-control', `no watched price or entitlement value moved since ${baseRef}`)
    return verdicts
  }

  const shown = moved.slice(0, MAX_LISTED)
    .map((m) => `${m.key} ${JSON.stringify(m.from)} → ${JSON.stringify(m.to)}`)
    .join('; ')
  const suffix = moved.length > MAX_LISTED ? ` (+${moved.length - MAX_LISTED} more)` : ''

  if (headLog !== null && headLog !== undefined && headLog !== baseLog) {
    note('in-sync', 'change-control',
      `${moved.length} watched value(s) moved since ${baseRef} and ${DECISION_LOG_PATH} moved with them: ${shown}${suffix}`)
    return verdicts
  }

  note(
    'differs',
    'change-control',
    `${moved.length} watched value(s) moved since ${baseRef} with NO ${DECISION_LOG_PATH} edit in the same range: ` +
      `${shown}${suffix}. Append a dated entry (Decided by / Scope / Evidence) recording who decided this and on ` +
      'what basis, then carry the same decision to the Drive Pricing Decision Log and the Source of Truth. ' +
      '⛔ Do not revert the value to silence this — if the move is intended it needs a decision on record; if it ' +
      'is not, it is the drift the change-control rule exists to catch (AGL-1908).',
  )

  return verdicts
}

/**
 * The Drive leg: a repo entry scoped `pricing` must have a same-dated heading
 * in the authoritative Pricing Decision Log on the shared drive.
 *
 * The repo copy is an INDEX, not a replacement — the Drive document is the
 * gdoc-first source of truth and holds the reasoning, the alternatives and the
 * arithmetic. This only asserts the two have not lost sight of each other.
 *
 * @param driveMd - the Drive log's contents, or null when Drive is not mounted
 * @returns verdicts; `[]` when Drive is unavailable, so an unmounted drive is a
 *   printed note rather than a silent pass OR a spurious red.
 */
export function driveCrossCheckVerdicts(entries, driveMd) {
  if (typeof driveMd !== 'string' || !driveMd.length) return []
  const dates = new Set(
    [...driveMd.matchAll(/^## (\d{4}-\d{2}-\d{2}) —/gm)].map((m) => m[1]),
  )
  const verdicts = []
  for (const entry of entries) {
    if (!entry.scope.includes('pricing')) continue
    if (dates.has(entry.date)) {
      verdicts.push({ status: 'in-sync', key: `drive:${entry.date}`, detail: 'present in the Drive Pricing Decision Log' })
    } else {
      verdicts.push({
        status: 'differs',
        key: `drive:${entry.date}`,
        detail:
          `"${entry.title}" is scoped \`pricing\` here but the Drive Pricing Decision Log has no ${entry.date} entry. ` +
          'Write it there first — the Drive document is the source of truth and this file is its index.',
      })
    }
  }
  return verdicts
}
