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
 * THE RULES' OUTREACH PREDICATE AGREES WITH THE PLAN TABLES (AGL-2974).
 *
 * `orgCarriesOutreach` in `cloud/firebase-firestore.rules` restates
 * `checkEntitlement(org, 'outreach')` in CEL, and restates it more briefly
 * than `crmSuiteCarried` restates the CRM suite: it reads the per-org
 * `entitlements.features.outreach` override and nothing else. That is the
 * resolver's whole answer only while no plan carries Outreach — the override
 * is spread over the plan row, so with every row `false` the override is all
 * that can grant it. The day a plan gains the feature, the console and the
 * routes open Outreach on that plan while the database goes on refusing every
 * read, and nothing in the rules file looks wrong.
 *
 * So both halves of that argument are held here: the helper reads the override
 * and names no plan, and no plan in `PLAN_ENTITLEMENTS` carries the feature. A
 * predicate nobody calls enforces nothing, so every Outreach read — and
 * the writes and the credential collection that must stay closed — are read
 * out of the same file.
 *
 * Read from the FILE with its comments stripped, the way every rules guard in
 * this directory reads it: the prose above the helper talks about plans and
 * seat add-ons, and must not be mistaken for the rule.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  PLAN_ENTITLEMENTS,
  checkEntitlement,
} from '../../app-utils/plan-entitlements'
import {
  normalizePathVariables,
  rawBlockBody,
  stripComments,
} from './write-deny-coverage.util'

const REPO_ROOT = resolve(__dirname, '../../../../../..')
const SOURCE = readFileSync(
  resolve(REPO_ROOT, 'cloud/firebase-firestore.rules'),
  'utf8',
)
const RULES = normalizePathVariables(stripComments(SOURCE))

const PLANS = Object.keys(PLAN_ENTITLEMENTS) as Array<
  keyof typeof PLAN_ENTITLEMENTS
>

/** Every status a Stripe subscription can be in. */
const SUBSCRIPTION_STATUSES = [
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
]

/** The org collections Outreach's routes write, by path variable. */
const OUTREACH_COLLECTIONS: ReadonlyArray<readonly [string, string]> = [
  ['outreachMailboxes', 'mailboxId'],
  ['outreachSequences', 'sequenceId'],
  ['outreachEnrollments', 'enrollmentId'],
  // The compliance settings and the do-not-contact list (AGL-2980).
  ['outreachSettings', 'settingsId'],
  ['outreachDoNotContact', 'key'],
]

/** Whitespace collapsed, so a re-wrapped expression reads the same. */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Every sign that `body` decides by PLAN: a quoted plan id, the `plan` field,
 * or the subscription status a plan list is always paired with.
 */
function planReadsIn(body: string): string[] {
  const words = new Set<string>([
    ...PLANS,
    'plan',
    'billingStatus',
    'subscription',
  ])
  const found = [...body.matchAll(/'([^']*)'/g)]
    .map((match) => match[1])
    .filter((word) => words.has(word))
  if (/\.plan\b/.test(body)) found.push('.plan')
  if (body.includes('orgSubscriptionStatus'))
    found.push('orgSubscriptionStatus')
  return [...new Set(found)].sort()
}

/** One `allow <verbs>:` statement of a block, up to its semicolon. */
function allowStatement(block: string, verbs: string): string {
  const at = block.indexOf(`allow ${verbs}:`)
  if (at < 0)
    throw new Error(`Guard cannot parse: no \`allow ${verbs}:\` in the block.`)
  return flat(block.slice(at, block.indexOf(';', at)))
}

/** The expression a `function … { return …; }` block returns. */
function returned(body: string): string {
  const at = body.indexOf('return ')
  if (at < 0) throw new Error('Guard cannot parse: the helper returns nothing.')
  return flat(body.slice(at + 'return '.length, body.lastIndexOf(';')))
}

const carries = rawBlockBody(RULES, 'function orgCarriesOutreach(orgId) {')
const override = rawBlockBody(RULES, 'function outreachOverride(org) {')
const orgs = rawBlockBody(RULES, 'match /orgs/<orgId> {')
const canRead = rawBlockBody(orgs, 'function canReadOutreach() {')

describe('the rules read Outreach off the per-org override alone (AGL-2974)', () => {
  it('finds the helpers at all — the guard can fail', () => {
    // A parse that matched the wrong text would make every "names no plan"
    // assertion below vacuously true. So the same check is run where a plan
    // list demonstrably exists — the CRM suite's twin, and this helper with
    // one spliced in — and must find it there.
    expect(returned(carries)).toContain('outreachOverride(')
    expect(
      planReadsIn(rawBlockBody(RULES, 'function crmSuiteCarried(org) {')),
    ).toEqual(
      expect.arrayContaining([
        'enterprise',
        'plan',
        'pro',
        'orgSubscriptionStatus',
      ]),
    )
    const spliced = carries.replace(
      '== true',
      "== true || org.get('plan', 'free') in ['enterprise']",
    )
    expect(spliced).not.toBe(carries)
    expect(planReadsIn(spliced)).toEqual(['enterprise', 'free', 'plan'])
  })

  it('reads entitlements.features.outreach, defensively typed', () => {
    const read = flat(override)
    expect(read).toContain(
      "org.get('entitlements', {}).get('features', {}).get('outreach', null)",
    )
    // A malformed `entitlements` or `features` must read as no grant rather
    // than erroring, which is what the two `is map` guards buy.
    expect(read).toContain("org.get('entitlements', {}) is map")
    expect(read).toContain(
      "org.get('entitlements', {}).get('features', {}) is map",
    )
  })

  it('grants only on an explicit true, from the org document', () => {
    const expression = returned(carries)
    expect(expression).toContain(
      'exists(/databases/$(database)/documents/orgs/$(orgId))',
    )
    expect(expression).toMatch(
      /outreachOverride\(get\(\/databases\/\$\(database\)\/documents\/orgs\/\$\(orgId\)\)\.data\) == true$/,
    )
  })

  it('names no plan and no subscription status', () => {
    expect(planReadsIn(carries)).toEqual([])
    expect(planReadsIn(override)).toEqual([])
  })
})

describe('no plan carries Outreach, so the override is the whole answer (AGL-2974)', () => {
  it('every plan in PLAN_ENTITLEMENTS has features.outreach === false', () => {
    // Strictly `false`: the day this fails, `orgCarriesOutreach` needs
    // `crmSuiteCarried`'s plan half, and the plans it must name are the ones
    // this assertion prints.
    expect(PLANS.length).toBeGreaterThanOrEqual(8)
    for (const plan of PLANS) {
      expect([plan, PLAN_ENTITLEMENTS[plan].features.outreach]).toEqual([
        plan,
        false,
      ])
    }
  })

  it('the override grants it on every plan, whatever the subscription is doing', () => {
    // Why the rule reads no status: a dead subscription resolves the plan to
    // Free, and the override is spread over Free's row just the same.
    for (const plan of PLANS) {
      for (const billingStatus of SUBSCRIPTION_STATUSES) {
        const org = {
          plan,
          billingStatus,
          entitlements: { features: { outreach: true } },
        }
        expect([
          plan,
          billingStatus,
          checkEntitlement(org as never, 'outreach'),
        ]).toEqual([plan, billingStatus, true])
      }
    }
  })

  it('its absence refuses it on Enterprise, and so does an override of false', () => {
    expect(checkEntitlement({ plan: 'enterprise' } as never, 'outreach')).toBe(
      false,
    )
    expect(
      checkEntitlement(
        {
          plan: 'enterprise',
          entitlements: { features: { outreach: false } },
        } as never,
        'outreach',
      ),
    ).toBe(false)
  })
})

describe('every Outreach read asks the entitlement, and no client writes (AGL-2974)', () => {
  it('asks for the entitlement LAST, after the reach and the permission', () => {
    // Last so a reader refused on role or permission never pays for the org
    // document's get(). CEL's `&&` short-circuits left to right.
    const expression = returned(canRead)
    expect(expression.startsWith('isOrgWideMember() &&')).toBe(true)
    expect(expression).toContain("memberStamps('outreach.use')")
    expect(expression).toContain("memberResolves('outreach.use')")
    expect(expression.endsWith('&& orgCarriesOutreach(orgId)')).toBe(true)
  })

  it.each(OUTREACH_COLLECTIONS)(
    '%s reads through canReadOutreach and denies every write',
    (name, id) => {
      const block = rawBlockBody(orgs, `match /${name}/<${id}> {`)
      expect(allowStatement(block, 'read')).toBe(
        'allow read: if canReadOutreach()',
      )
      expect(allowStatement(block, 'write')).toBe('allow write: if false')
    },
  )

  it('closes outreachMailboxCredentials to every client', () => {
    const block = rawBlockBody(
      RULES,
      'match /outreachMailboxCredentials/<credentialId> {',
    )
    expect(allowStatement(block, 'read, write')).toBe(
      'allow read, write: if false',
    )
    // Top-level, not under the org: it must not inherit an org-member read.
    expect(orgs).not.toContain('outreachMailboxCredentials')
  })
})
