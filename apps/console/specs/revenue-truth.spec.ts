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

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Revenue-truth guard (AGL-1070). `org.plan` is NOT revenue.
 *
 * A staff override sets `plan` and never writes `subscription`, so a comped
 * or dark-launched org resolves to a paid tier while billing nothing
 * (AGL-925). On production today THREE of four orgs are on paid tiers with
 * no subscription behind them — reading the plan column as revenue
 * overstates MRR by 4×.
 *
 * `isBillingSubscription` / `orgMonthlyRevenueUsd` encode that rule, and
 * `/api/admin/overview` uses them correctly. But the rule lived in exactly
 * one consumer with nothing keeping it there, and a second surface — a new
 * dashboard tile, a CSV export, an investor metric — summing
 * `PLAN_PRICING[org.plan]` would be quietly, confidently wrong. It would
 * look right in every environment, because the override case is invisible
 * unless you ask `subscription.status`.
 *
 * So: any file that talks about a revenue AGGREGATE and also reads `plan`
 * must go through the helpers, or be exempted here with a reason.
 *
 * Deliberately file-level rather than an AST walk, matching
 * `help-coverage.spec.ts`. It catches the real risk — a whole new revenue
 * surface computed from the wrong field — not partial misuse inside a file
 * that already imports the helpers.
 *
 * Deliberately NOT applied to files that read `PLAN_PRICING` to show a
 * customer the price they are about to pay (`www/pages/pricing.tsx`,
 * `billing-plan-cards`, `billing/page.tsx`, `billing-addons.ts`). Quoting a
 * price is a different question from aggregating revenue across orgs, and
 * folding them in would make this noisy enough that someone disables it.
 */

const REPO_ROOT = join(__dirname, '../../..')
const SCAN_ROOTS = ['apps', 'libs']

/**
 * The source with COMMENTS and STRING LITERALS blanked out, offsets preserved.
 *
 * AGL-2086/AGL-1939 are one defect in two guards: a scanner written to read a
 * rendered artifact was pointed at checked-in source, where it counts a
 * MENTION as a USE. `retired-colours.mjs` fixed its half by separating
 * assigned from merely named (`splitSourceComments` / `findSourceOccurrences`);
 * this is the same treatment for the same reason.
 *
 * Without it, the word "revenue" in an email body or a design-rationale
 * comment reads exactly like a revenue computation, and the only remedy on
 * offer is to exempt the file forever — which is how a guard stops meaning
 * anything. Prose is not an aggregate. Code is.
 *
 * Blanks rather than deletes so nothing shifts: line structure survives and
 * every offset still points where it did. `${…}` substitutions stay CODE —
 * `orgMonthlyRevenueUsd(org)` interpolated into a template is a real call and
 * must still count — which is why templates carry a brace-depth stack instead
 * of being blanked wholesale.
 *
 * Deliberately biased AGAINST blanking. A guard's only fatal failure is the
 * false negative, so an escape outside a string skips its pair (a regex
 * literal like `/['"]/` must not open a phantom string and blank the real
 * code after it), and anything unrecognised is left as code.
 */
function codeRegionOf(source: string): string {
  const out = source.split('')
  const blank = (at: number) => {
    if (source[at] !== '\n') out[at] = ' '
  }
  /** One frame per open template literal; `active` means inside `${…}`. */
  const templates: { braces: number; active: boolean }[] = []
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    const top = templates[templates.length - 1]

    // Literal text of a template — blanked, until a substitution opens.
    if (top && !top.active) {
      if (ch === '\\') {
        blank(i)
        blank(i + 1)
        i += 2
        continue
      }
      if (ch === '`') {
        blank(i)
        templates.pop()
        i += 1
        continue
      }
      if (source.startsWith('${', i)) {
        blank(i)
        blank(i + 1)
        top.active = true
        top.braces = 1
        i += 2
        continue
      }
      blank(i)
      i += 1
      continue
    }

    // Code: top level, or inside a substitution whose braces we are counting.
    if (top && top.active) {
      if (ch === '{') top.braces += 1
      else if (ch === '}') {
        top.braces -= 1
        if (top.braces === 0) {
          blank(i)
          top.active = false
          i += 1
          continue
        }
      }
    }
    if (ch === '\\') {
      i += 2
      continue
    }
    if (source.startsWith('//', i)) {
      while (i < source.length && source[i] !== '\n') {
        blank(i)
        i += 1
      }
      continue
    }
    if (source.startsWith('/*', i)) {
      while (i < source.length && !source.startsWith('*/', i)) {
        blank(i)
        i += 1
      }
      blank(i)
      blank(i + 1)
      i += 2
      continue
    }
    if (ch === '`') {
      blank(i)
      templates.push({ braces: 0, active: false })
      i += 1
      continue
    }
    if (ch === "'" || ch === '"') {
      // Only a quote that CLOSES on the same line opens a string. Without
      // this, the `'` in a regex literal like `/['\"]/` opens a string that
      // never ends and blanks the rest of the line — silently erasing real
      // code, which is the false-negative direction a guard cannot afford.
      let end = i + 1
      while (end < source.length && source[end] !== '\n') {
        if (source[end] === '\\') {
          end += 2
          continue
        }
        if (source[end] === ch) break
        end += 1
      }
      if (end >= source.length || source[end] !== ch) {
        i += 1 // not a string: leave it as code
        continue
      }
      while (i <= end) {
        blank(i)
        i += 1
      }
      continue
    }
    i += 1
  }
  return out.join('')
}

/** Words that mean "a revenue total", as opposed to one org's price. */
const AGGREGATE_WORD = /\b(mrr|arr|revenue)\b/i

/**
 * The same idea INSIDE an identifier: `mrrUsd`, `orgMonthlyRevenueUsd`,
 * `totalRevenueCents`.
 *
 * Added with the code-region fix, and not optional alongside it. Measuring
 * this guard while fixing AGL-2086 turned up something worse than the two
 * false positives: every `MRR`/`revenue` occurrence in
 * `api/admin/overview/route.ts` — the one surface that genuinely aggregates
 * money — is in a COMMENT. Real revenue code is camelCase, and `\brevenue\b`
 * cannot match `orgMonthlyRevenueUsd`. So the word-only guard was drawing
 * ALL of its signal from prose; restricting it to code without this would
 * have left it matching almost nothing and still green.
 *
 * Case-SENSITIVE, because casing is the only thing marking a segment
 * boundary. `ARR` is deliberately absent: it would match `ARRAY` and
 * `ARR_LIMIT` and mean nothing. Verified against the whole tree — this adds
 * zero new offenders today, so it is reach for what gets written next.
 */
const AGGREGATE_IDENT =
  /\b(?:mrr|revenue)(?=[A-Z0-9_])|(?<=[a-z0-9])(?:MRR|Revenue)(?![a-z])/

/** Either shape, read off whatever region the caller decided to trust. */
function mentionsAggregate(text: string): boolean {
  return AGGREGATE_WORD.test(text) || AGGREGATE_IDENT.test(text)
}

/** Reading the plan field in any of the shapes used in this repo. */
const READS_PLAN = /\.plan\b|\['plan'\]|\bplan:\s/

/** The sanctioned way to turn plan state into money. */
const USES_HELPERS = /isBillingSubscription|orgMonthlyRevenueUsd/

/**
 * Files that mention both and legitimately compute nothing. Each entry is a
 * repo-relative path with a reason; the list doubles as the record of
 * deliberate exemptions. Adding one asserts the file does not derive a
 * revenue figure from `plan`.
 */
const EXCEPTIONS: Record<string, string> = {
  'apps/console/app/(app)/admin/overview/page.tsx':
    'Renders metrics.mrrUsd straight from /api/admin/overview; its `plan` references are the broadcast-audience selector and a per-org label, not a computation.',
}

function walk(dir: string, out: string[] = []): string[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      if (entry.name.startsWith('.')) continue
      walk(full, out)
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.spec\.tsx?$/.test(entry.name) &&
      !/\.d\.ts$/.test(entry.name)
    ) {
      out.push(full)
    }
  }
  return out
}

/**
 * Whether a file looks like it derives a revenue aggregate from `plan`.
 *
 * Read off the CODE region only. `USES_HELPERS` is checked against the raw
 * source on purpose: an import is code, but a file that names the helpers
 * anywhere has already been reasoned about, and reading it loosely here can
 * only ever exempt — never accuse.
 */
function tripsGuard(source: string): boolean {
  // AGGREGATE off the CODE region — that is the mention-vs-use fix.
  if (!mentionsAggregate(codeRegionOf(source))) return false
  // READS_PLAN off the RAW source, deliberately. Two of its three shapes —
  // `org['plan']` and `plan: ` — are property accessors that live INSIDE
  // quotes, so blanking string literals would blind it. Unchanged from
  // before, so nothing here is loosened: the pair is strictly tighter.
  if (!READS_PLAN.test(source)) return false
  return !USES_HELPERS.test(source)
}

describe('revenue is derived from billing state, never from org.plan (AGL-1070)', () => {
  const offenders = SCAN_ROOTS.flatMap((root) =>
    walk(join(REPO_ROOT, root)),
  ).filter((file) => {
    return tripsGuard(readFileSync(file, 'utf8'))
      ? !(relative(REPO_ROOT, file) in EXCEPTIONS)
      : false
  })

  it('has no file computing a revenue total outside the helpers', () => {
    const named = offenders.map((file) => relative(REPO_ROOT, file))
    // Thrown rather than asserted so the guidance actually reaches whoever
    // tripped it — Jest's `expect` takes no message argument, and a bare
    // array diff would not say what to do about it. Name the fix, not the
    // rule: whoever hits this is mid-feature and needs the call.
    if (named.length > 0) {
      throw new Error(
        `These files mention a revenue aggregate AND read \`plan\`, but do ` +
          `not use isBillingSubscription/orgMonthlyRevenueUsd:\n\n` +
          `${named.map((n) => `  • ${n}`).join('\n')}\n\n` +
          `org.plan is NOT revenue — a staff override sets plan and writes ` +
          `no subscription, so comped orgs read as paying (AGL-925). Gate ` +
          `on isBillingSubscription(org) and sum orgMonthlyRevenueUsd(org). ` +
          `If the file genuinely computes nothing, add it to EXCEPTIONS in ` +
          `this spec with a reason.`,
      )
    }
    expect(named).toEqual([])
  })

  it('actually scanned the tree, so an empty result means something', () => {
    // Without this, a broken walk() or a bad regex yields zero offenders and
    // the guard above passes forever while checking nothing — the failure
    // mode this repo keeps rediscovering.
    const scanned = SCAN_ROOTS.flatMap((root) => walk(join(REPO_ROOT, root)))
    expect(scanned.length).toBeGreaterThan(500)
    // If this is false the guard is pointed at the wrong tree.
    expect(scanned.some((f) => /plan-entitlements\.ts$/.test(f))).toBe(true)
  })

  it('keeps the known revenue consumer honest', () => {
    // The one surface that legitimately sums money across orgs. If someone
    // rewrites it without the helpers, that is the exact regression this
    // issue exists to prevent, and it must not merely fall out of scope.
    const route = readFileSync(
      join(REPO_ROOT, 'apps/console/app/api/admin/overview/route.ts'),
      'utf8',
    )
    expect(USES_HELPERS.test(route)).toBe(true)
    // Read off the CODE region, so this doubles as proof that `codeRegionOf`
    // does not blank real code: the one file that genuinely aggregates money
    // must still look like it does after the extraction.
    expect(mentionsAggregate(codeRegionOf(route))).toBe(true)
    expect(READS_PLAN.test(route)).toBe(true)
  })

  it('counts a use and ignores a mention', () => {
    // The AGL-2086 defect itself, pinned. Without these the extraction could
    // regress to counting prose — or to blanking everything, which would make
    // the guard vacuous and still green.
    const prose = `
      // A quota warning nobody sees is revenue nobody collects.
      /* MRR is not derived here. */
      const message = 'so this is margin, not revenue'
      const body = \`your plan: \${tier} — no revenue is computed\`
      if (!orgData['plan']) return
    `
    expect(mentionsAggregate(prose)).toBe(true)
    expect(mentionsAggregate(codeRegionOf(prose))).toBe(false)
    // …and the file is therefore NOT an offender, with no exemption needed.
    expect(tripsGuard(prose)).toBe(false)

    const real = `
      // revenue lives here
      const mrrUsd = orgs.reduce((sum, o) => sum + PLAN_PRICING[o.plan], 0)
    `
    expect(mentionsAggregate(codeRegionOf(real))).toBe(true)
    expect(tripsGuard(real)).toBe(true)

    // The identifier reach, which is what stops the code-region fix from
    // making this guard vacuous. None of these has a standalone "revenue".
    expect(mentionsAggregate('const mrrUsd = 0')).toBe(true)
    expect(mentionsAggregate('sum += orgMonthlyRevenueUsd(o)')).toBe(true)
    expect(mentionsAggregate('const totalRevenueCents = 0')).toBe(true)
    // …without dragging in every array in the repo.
    expect(mentionsAggregate('const arrays = []')).toBe(false)
    expect(mentionsAggregate('const ARRAY_LIMIT = 10')).toBe(false)
    expect(mentionsAggregate('arrangement.plan')).toBe(false)

    // A substitution is code, not text: a helper called inside a template
    // must still be seen, or the guard could be evaded by interpolation.
    expect(
      codeRegionOf('const t = `total ${orgMonthlyRevenueUsd(org)}`'),
    ).toContain('orgMonthlyRevenueUsd(org)')
    // A regex literal holding a quote must not open a phantom string and
    // blank the code after it — the false-negative direction.
    expect(codeRegionOf("const q = /['\"]/; const mrr = sum(o.plan)")).toContain(
      'mrr = sum(o.plan)',
    )
  })

  it('has no stale EXCEPTIONS entry', () => {
    // An exemption list with no staleness check only ever grows, and every
    // entry silently widens what is permitted long after the reason expired
    // (the sibling no-community-naming guard has had this for a while; this
    // one did not, which is half of why AGL-2086 happened). An entry earns
    // its place only while the file would ACTUALLY trip the guard.
    const stale = Object.keys(EXCEPTIONS).filter((path) => {
      let source
      try {
        source = readFileSync(join(REPO_ROOT, path), 'utf8')
      } catch {
        return true // the file is gone
      }
      return !tripsGuard(source)
    })
    if (stale.length > 0) {
      throw new Error(
        `These EXCEPTIONS entries no longer exempt anything — the file is ` +
          `gone, or it stopped tripping the guard. Delete them; a stale ` +
          `exemption is a hole nobody is watching:\n\n` +
          `${stale.map((n) => `  • ${n}`).join('\n')}`,
      )
    }
    expect(stale).toEqual([])
  })
})
