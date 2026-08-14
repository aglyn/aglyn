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
 * `['active', 'trialing', 'past_due']` is written down ONCE (AGL-1715).
 *
 * That triple means "this org is already subscribed", and it decides whether a
 * workspace may open a SECOND subscription. Four copies existed and nothing
 * made them agree. The failure mode is asymmetric in the expensive direction:
 * if one copy ever narrows relative to another, the Billing page sends a
 * subscribed org to checkout and the route lets it through — two live
 * subscriptions on one Stripe customer, which the webhook then mirrors one
 * straight over the other, so the duplicate is invisible from every screen we
 * have while both bill. That is not hypothetical. It shipped twice in one day:
 * `/api/billing/checkout` (AGL-1697) and `/api/admin/enterprise-billing`
 * (AGL-1714).
 *
 * Converging the copies fixed the four that existed. This is the part that
 * stops a fifth, because "we converged them" is a state and the thing that
 * needs guarding is a rate.
 *
 * ## The property
 *
 * Every subscription-status SET in repo source is either the one in
 * `org-billing-doc.ts` or a documented exception. An exception has to be
 * declared twice, deliberately, in two different places:
 *
 * 1. an entry in `DOCUMENTED_COPIES` below, with the reason — so adding a copy
 *    is an edit to the guard and shows up in review as one;
 * 2. an `AGL-1715-EXEMPT:` line in the 25 source lines above the literal — so
 *    the next reader of THAT file learns why it is not the shared predicate,
 *    without having to find this spec.
 *
 * Neither alone. An allowlist on its own is invisible at the copy; a marker on
 * its own is a comment anyone can paste.
 *
 * ## What counts as a "set", and why not just `'trialing'`
 *
 * Grepping for the word over-fires: `status === 'active' ? 'Active' :
 * status === 'past_due' ? …` is a display mapping, and the dunning banner
 * compares against `'past_due'` alone. Neither is a copy of the list, and a
 * guard that flags them gets its exemptions rubber-stamped, which is worse
 * than no guard.
 *
 * So two shapes, both of which are a membership test:
 *
 * - a COLLECTION literal — `[…]` holding two or more of the triple. Covers the
 *   array, `new Set([…])` and the inline `[…].includes(x)` chain, which are
 *   the three spellings the four real copies used between them.
 * - a DISJUNCTION chain — `x === 'active' || x === 'trialing'`, the same test
 *   written without a collection.
 *
 * Subsets and supersets are caught by construction: the rule is "two or more
 * of the triple", not "equals the triple". A copy that drops `past_due` or
 * adds `unpaid` is exactly the drift this exists to see, so it must trip the
 * guard rather than slip past a whole-list comparison.
 *
 * ## Deliberately not covered
 *
 * `*.spec.ts` / `*.test.*`. Specs iterate status words constantly as table
 * data (`for (const status of ['active', 'trialing', 'past_due'])`), and that
 * is a fixture, not a decision. The cost is that a decision hidden in a spec
 * is invisible here; the benefit is that the guard has no noise. Route
 * behaviour is pinned by the route's own spec either way.
 *
 * The status VOCABULARY — `OrgSubscription['status']` in `org-billing.types.ts`
 * — is a union of literal types, not a collection literal, so declaring the
 * words is not flagged. Only grouping them into a set is.
 */

import { readdirSync, readFileSync } from 'fs'
import { join, relative, resolve, sep } from 'path'

const REPO_ROOT = resolve(__dirname, '../../../../..')

/** The one file allowed to declare the set. */
const CANONICAL = 'libs/aglyn/src/lib/app-utils/org-billing-doc.ts'

/** Where `plan-entitlements.ts` declares the complement. */
const ENTITLEMENTS = 'libs/aglyn/src/lib/app-utils/plan-entitlements.ts'

/**
 * Copies that answer a DIFFERENT question, each with the reason. A new entry
 * here is a claim that the set is not the "may this org subscribe" set, and
 * the reviewer's job is to disbelieve it.
 */
const DOCUMENTED_COPIES: Record<string, string> = {
  'apps/console/app/api/_lib/stripe-payment-method.ts':
    'A deliberate SUPERSET — it adds `unpaid`. The question is "which of this ' +
    "customer's subscriptions is Stripe billing against, so whose payment " +
    'method is the live one", and an unpaid subscription still has the card ' +
    'that failed on it. Answering it with the live-subscription list would ' +
    'show a stale method on exactly the orgs in dunning, who are the ones ' +
    'looking. Pinned by stripe-payment-method.spec.ts.',
  'libs/plugins/commerce/src/lib/server/gate.ts':
    "A TENANT's own site members' subscriptions to the TENANT's products " +
    '(`hosts/{hostId}/subscriptions`), not an Aglyn org subscription. ' +
    'Different Stripe account, different buyer, different decision — this one ' +
    'grants access to gated content (AGL-309/AGL-481). The words coincide ' +
    'because both are Stripe subscription statuses.',
  'libs/plugins/commerce/src/lib/server/member-post.ts':
    'Same as gate.ts — the tenant\'s live member subscribers, for who gets ' +
    'the member-post email (AGL-316). Not an Aglyn org subscription.',
  'tools/scripts/audit-metered-coverage.mjs':
    'A standalone `node` ops script that talks to the Stripe REST API ' +
    'directly. It is run with bare node and never built, so it cannot import ' +
    'a TypeScript lib. It reads Stripe, decides nothing and writes nothing — ' +
    'a drift here misreports an audit, it does not bill anyone twice.',
}

const MARKER = 'AGL-1715-EXEMPT:'

/** How far above a flagged literal the marker may sit. */
const MARKER_LOOKBACK_LINES = 25

const LIVE_STATUSES = ['active', 'trialing', 'past_due'] as const

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  '.nx',
  '.turbo',
  '.vercel',
  '.git',
  'coverage',
  'out-tsc',
  'tmp',
])

const SOURCE_EXT = /\.(ts|tsx|mjs|cjs|js|jsx)$/
const TEST_FILE = /\.(spec|test)\.[a-z]+$/

/**
 * Comments are stripped before matching. This file's own prose spells the
 * triple out repeatedly, and so does the docstring on every copy it guards —
 * parsing with comments in place would read the explanation of the rule as a
 * breach of it.
 */
function stripComments(source: string): string {
  // Newlines are preserved so a match's line number survives the strip.
  const blank = (text: string) => text.replace(/[^\n]/g, ' ')
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\/[^\n]*/g, blank)
}

function distinctLiveStatusesIn(text: string): string[] {
  return LIVE_STATUSES.filter((word) =>
    new RegExp(`['"]${word}['"]`).test(text),
  )
}

export interface StatusSetFinding {
  /** 1-based line of the literal. */
  line: number
  shape: 'collection' | 'disjunction'
  members: string[]
  excerpt: string
}

/**
 * Every subscription-status SET in one source text. Pure — takes source,
 * returns findings — so the detector itself is testable on a string literal
 * without touching the disk.
 */
export function findStatusSets(rawSource: string): StatusSetFinding[] {
  const source = stripComments(rawSource)
  const lineOf = (index: number) =>
    source.slice(0, index).split('\n').length
  const found: StatusSetFinding[] = []

  // A collection literal: the innermost `[…]`, so a nested array cannot smear
  // two unrelated lists into one match.
  for (const match of source.matchAll(/\[[^[\]]*\]/g)) {
    const members = distinctLiveStatusesIn(match[0])
    if (members.length < 2) continue
    found.push({
      line: lineOf(match.index ?? 0),
      shape: 'collection',
      members,
      excerpt: match[0].replace(/\s+/g, ' ').slice(0, 120),
    })
  }

  // A disjunction chain: two different statuses compared within one `||`
  // expression. `||` is required so a `? :` display mapping does not read as a
  // membership test.
  const comparisons = [
    ...source.matchAll(/[=!]==?\s*['"](active|trialing|past_due)['"]/g),
  ]
  for (let i = 0; i < comparisons.length; i += 1) {
    for (let j = i + 1; j < comparisons.length; j += 1) {
      const from = comparisons[i].index ?? 0
      const to = comparisons[j].index ?? 0
      if (to - from > 200) break
      if (comparisons[j][1] === comparisons[i][1]) continue
      if (!source.slice(from, to).includes('||')) continue
      found.push({
        line: lineOf(from),
        shape: 'disjunction',
        members: [comparisons[i][1], comparisons[j][1]],
        excerpt: source
          .slice(from, to + 40)
          .replace(/\s+/g, ' ')
          .slice(0, 120),
      })
      i = j
      break
    }
  }

  return found
}

/** Is `MARKER` within the lookback window above `line` (1-based)? */
export function hasExemptMarkerAbove(rawSource: string, line: number): boolean {
  const lines = rawSource.split('\n')
  const from = Math.max(0, line - 1 - MARKER_LOOKBACK_LINES)
  return lines.slice(from, line).some((text) => text.includes(MARKER))
}

function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (absolute: string) => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue
      const child = join(absolute, entry.name)
      if (entry.isDirectory()) walk(child)
      else if (SOURCE_EXT.test(entry.name) && !TEST_FILE.test(entry.name)) {
        out.push(relative(REPO_ROOT, child).split(sep).join('/'))
      }
    }
  }
  for (const root of ['apps', 'libs', 'tools', 'cloud']) {
    walk(resolve(REPO_ROOT, root))
  }
  return out
}

const read = (repoPath: string): string =>
  readFileSync(resolve(REPO_ROOT, repoPath), 'utf8')

describe('the live-subscription status list has one source (AGL-1715)', () => {
  // The sweep is done once: ~4k files off the disk per `it` would be the
  // slowest spec in the lib for no extra signal.
  const scanned = sourceFiles().map((repoPath) => ({
    repoPath,
    source: read(repoPath),
  }))
  const withSets = scanned
    .map(({ repoPath, source }) => ({
      repoPath,
      source,
      findings: findStatusSets(source),
    }))
    .filter((entry) => entry.findings.length > 0)

  it('the canonical file is where the guard thinks it is', () => {
    // Guards that silently stop finding their subject pass forever. If the
    // predicate moves, this fails and names the move rather than going quiet.
    const canonical = withSets.find((entry) => entry.repoPath === CANONICAL)
    expect(canonical?.repoPath).toBe(CANONICAL)
    expect(read(CANONICAL)).toContain('export function isLiveSubscriptionStatus')
    expect(read(CANONICAL)).toContain('export function isOrgSubscriptionLive')
  })

  it('declares the set nowhere but the canonical file and the documented copies', () => {
    const offenders = withSets
      .filter(
        (entry) =>
          entry.repoPath !== CANONICAL &&
          !(entry.repoPath in DOCUMENTED_COPIES),
      )
      .map(
        (entry) =>
          `${entry.repoPath}:${entry.findings[0].line} — ` +
          `${entry.findings[0].shape} ${JSON.stringify(
            entry.findings[0].members,
          )}  ${entry.findings[0].excerpt}`,
      )

    expect(offenders).toEqual([])
  })

  it('every documented copy still exists, and still carries its marker', () => {
    // The other direction: a stale allowlist entry is a licence nobody is
    // using, and the next copy at that path inherits it.
    const problems: string[] = []
    for (const repoPath of Object.keys(DOCUMENTED_COPIES)) {
      const entry = withSets.find((candidate) => candidate.repoPath === repoPath)
      if (!entry) {
        problems.push(
          `${repoPath} — allowlisted but declares no status set any more; ` +
            'drop the DOCUMENTED_COPIES entry.',
        )
        continue
      }
      for (const finding of entry.findings) {
        if (!hasExemptMarkerAbove(entry.source, finding.line)) {
          problems.push(
            `${repoPath}:${finding.line} — no \`${MARKER}\` line within ` +
              `${MARKER_LOOKBACK_LINES} lines above ${finding.excerpt}`,
          )
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('the live set and the dead set do not overlap', () => {
    // `plan-entitlements.ts` asks the same question from the other side —
    // `DEAD_SUBSCRIPTION_STATUSES`, the states that stop paying for the plan —
    // and a deny-list is not caught by a detector looking for the live triple.
    // The invariant that connects them is disjointness: a status the MRR
    // roll-up calls dead while checkout calls it live means one of the two is
    // wrong about a paying customer.
    const dead = /DEAD_SUBSCRIPTION_STATUSES\s*=\s*new Set\(\[([^\]]*)\]\)/.exec(
      read(ENTITLEMENTS),
    )
    expect(dead).not.toBeNull()
    const deadStatuses = [...(dead?.[1] ?? '').matchAll(/['"]([a-z_]+)['"]/g)].map(
      (match) => match[1],
    )
    expect(deadStatuses.length).toBeGreaterThan(0)
    expect(
      deadStatuses.filter((status) =>
        (LIVE_STATUSES as readonly string[]).includes(status),
      ),
    ).toEqual([])
  })
})

describe('the detector itself (non-vacuity)', () => {
  it('sees a planted array copy', () => {
    const planted = findStatusSets(
      `const LIVE = ['active', 'trialing', 'past_due']\n`,
    )
    expect(planted).toHaveLength(1)
    expect(planted[0].shape).toBe('collection')
    expect(planted[0].line).toBe(1)
  })

  it('sees a planted Set copy, and an inline includes chain', () => {
    expect(
      findStatusSets(`const S = new Set(['active', 'trialing', 'past_due'])`),
    ).toHaveLength(1)
    expect(
      findStatusSets(`if (['active', 'past_due'].includes(s)) return true`),
    ).toHaveLength(1)
  })

  it('sees a NARROWED copy — the drift that costs money', () => {
    // The AGL-1697 shape: a second list that forgot `past_due`. A guard that
    // only recognised the exact triple would wave this through.
    const planted = findStatusSets(`const LIVE = ['active', 'trialing']`)
    expect(planted).toHaveLength(1)
    expect(planted[0].members).toEqual(['active', 'trialing'])
  })

  it('sees a WIDENED copy', () => {
    expect(
      findStatusSets(
        `const LIVE = ['active', 'trialing', 'past_due', 'unpaid']`,
      ),
    ).toHaveLength(1)
  })

  it('sees the same test written without a collection', () => {
    const planted = findStatusSets(
      `const live = s === 'active' || s === 'trialing' || s === 'past_due'`,
    )
    expect(planted).toHaveLength(1)
    expect(planted[0].shape).toBe('disjunction')
  })

  it('does not fire on a display mapping or a single-status compare', () => {
    expect(
      findStatusSets(
        `const label = s === 'active' ? 'Active' : s === 'past_due' ? 'Past due' : '—'`,
      ),
    ).toEqual([])
    expect(findStatusSets(`if (status === 'past_due') showDunning()`)).toEqual([])
  })

  it('does not read the triple out of a comment', () => {
    expect(
      findStatusSets(
        `// live is ['active', 'trialing', 'past_due']\n` +
          `/* also ['active','past_due'] */\n` +
          `const x = 1`,
      ),
    ).toEqual([])
  })

  it('reports the line the literal is on, after comments are blanked', () => {
    const planted = findStatusSets(
      `/*\n * ['active', 'trialing']\n */\nconst LIVE = ['active', 'past_due']\n`,
    )
    expect(planted).toHaveLength(1)
    expect(planted[0].line).toBe(4)
  })

  it('requires the marker to sit near the literal, not anywhere in the file', () => {
    const near = `${MARKER} because\nconst LIVE = ['active', 'trialing']`
    expect(hasExemptMarkerAbove(near, 2)).toBe(true)

    const far = [`${MARKER} because`, ...Array(40).fill('// filler')].join('\n')
    expect(hasExemptMarkerAbove(`${far}\nconst LIVE = []`, 42)).toBe(false)
  })
})
