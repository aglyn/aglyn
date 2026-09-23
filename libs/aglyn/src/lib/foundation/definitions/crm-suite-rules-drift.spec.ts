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
 * THE RULES' CRM SUITE PREDICATE AGREES WITH THE PLAN TABLES (AGL-2801).
 *
 * `crmSuiteCarried` in `cloud/firebase-firestore.rules` restates
 * `resolveOrgEntitlements(org).features.crm` in CEL, which has no constants
 * and cannot import the table — so the plans that carry the suite, and the
 * subscription statuses that read a paid plan as Free, are retyped there. A
 * plan re-cut to gain or lose the suite, or a status the resolver starts
 * reading as dead, would move the console and the routes and leave the
 * database answering the old question: a paying workspace refused its own
 * writes, or a Free one let through.
 *
 * A predicate nobody calls enforces nothing, so the rules that must ask it —
 * the create and update of every client-written suite collection — are read
 * out of the same file, and so are the reads and deletes that must not.
 *
 * Read from the FILE with its comments stripped, the way every rules guard in
 * this directory reads it: the prose above each block names the predicate
 * too, and must not be mistaken for the rule.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  PLAN_ENTITLEMENTS,
  resolveEffectivePlan,
} from '../../app-utils/plan-entitlements'
import {
  normalizePathVariables,
  parseHostSubcollectionRules,
  rawBlockBody,
  stripComments,
} from './write-deny-coverage.util'

const REPO_ROOT = resolve(__dirname, '../../../../../..')
const SOURCE = readFileSync(resolve(REPO_ROOT, 'cloud/firebase-firestore.rules'), 'utf8')
const RULES = normalizePathVariables(stripComments(SOURCE))

/** The quoted names in the list that follows `marker`. */
function listAfter(body: string, marker: string): string[] {
  const at = body.indexOf(marker)
  if (at < 0) throw new Error(`Guard cannot parse: no \`${marker}\` in the predicate.`)
  const open = body.indexOf('[', at)
  const close = body.indexOf(']', open)
  return body
    .slice(open + 1, close)
    .split(',')
    .map((item) => item.trim().replace(/^'|'$/g, ''))
    .filter(Boolean)
    .sort()
}

/** One `allow <verbs>:` statement of a block, up to its semicolon. */
function allowStatement(block: string, verbs: string): string {
  const at = block.indexOf(`allow ${verbs}:`)
  if (at < 0) throw new Error(`Guard cannot parse: no \`allow ${verbs}:\` in the block.`)
  return block.slice(at, block.indexOf(';', at))
}

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

/** The org collections the console writes for the suite, by path variable. */
const SUITE_COLLECTIONS: ReadonlyArray<readonly [string, string]> = [
  ['companies', 'companyId'],
  ['pipelines', 'pipelineId'],
  ['deals', 'dealId'],
  ['crmTasks', 'taskId'],
  ['crmActivities', 'activityId'],
  ['contactFields', 'fieldId'],
  ['crmViews', 'viewId'],
  ['crmEmailTemplates', 'templateId'],
  ['crmPicklists', 'picklistId'],
]

describe('the rules carry the CRM suite on the plans the tables do (AGL-2801)', () => {
  const carried = rawBlockBody(RULES, 'function crmSuiteCarried(org) {')

  it('names exactly the plans whose entitlements include the suite', () => {
    const tables = Object.entries(PLAN_ENTITLEMENTS)
      .filter(([, entitlements]) => entitlements.features.crm === true)
      .map(([plan]) => plan)
      .sort()
    expect(listAfter(carried, "org.get('plan', 'free') in")).toEqual(tables)
  })

  it('reads as Free exactly the subscription statuses the resolver downgrades', () => {
    const dead = SUBSCRIPTION_STATUSES.filter(
      (status) =>
        resolveEffectivePlan({ plan: 'pro', billingStatus: status } as never) === 'free',
    ).sort()
    expect(listAfter(carried, 'orgSubscriptionStatus(org) in')).toEqual(dead)
  })
})

/**
 * A STAFF COMP OPENS THE SUITE WHERE THE RESOLVER SAYS IT DOES (AGL-3034).
 *
 * `resolveEffectivePlan` honors `entitlements.planComp` while the
 * subscription is dead or absent. Without the comp half here, a workspace
 * comped to Pro would be shown the CRM by the console and refused every write
 * to it by the database — the comp silently ignored in the one place staff
 * cannot see.
 */
describe('the rules honor a staff comp on the statuses the resolver does (AGL-3034)', () => {
  const carried = rawBlockBody(RULES, 'function crmSuiteCarried(org) {')
  const comp = rawBlockBody(RULES, 'function orgPlanComp(org) {')
  const flat = (text: string) => text.replace(/\s+/g, ' ')

  it('names the same plans for a comp as for a stored plan', () => {
    expect(listAfter(carried, 'orgPlanComp(org) in')).toEqual(
      listAfter(carried, "org.get('plan', 'free') in"),
    )
  })

  it('applies a comp on exactly the dead statuses and on none at all', () => {
    const compHalf = carried.slice(carried.indexOf('orgPlanComp(org) in'))
    const at = compHalf.indexOf('orgSubscriptionStatus(org) in')
    const statuses = compHalf
      .slice(compHalf.indexOf('[', at) + 1, compHalf.indexOf(']', at))
      .split(',')
      .map((item) => item.trim().replace(/^'|'$/g, ''))
      .sort()
    const applies = ['', ...SUBSCRIPTION_STATUSES].filter(
      (status) =>
        resolveEffectivePlan({
          plan: 'free',
          ...(status ? { billingStatus: status } : {}),
          entitlements: { planComp: { plan: 'pro' } },
        } as never) === 'pro',
    )
    expect(statuses).toEqual(applies.sort())
    // The absent status is in the list — without it a workspace that never
    // subscribed could be comped in the console and refused here.
    expect(statuses).toContain('')
  })

  it('reads the comp plan off entitlements.planComp, defensively typed', () => {
    expect(flat(comp)).toContain(
      "org.get('entitlements', {}).get('planComp', {}).get('plan', '')",
    )
    expect(flat(comp)).toContain("org.get('entitlements', {}) is map")
    expect(flat(comp)).toContain("org.get('entitlements', {}).get('planComp', {}) is map")
  })

  it('every plan a comp can name carries the suite, so OR-ing the halves keeps the order', () => {
    // The comp half is OR'd beside the stored-plan half instead of taking
    // precedence over it. The two orders agree only while no comp plan lacks
    // the suite: then the comp half is true whenever the comp is in force.
    const listed = new Set(listAfter(carried, 'orgPlanComp(org) in'))
    for (const plan of Object.keys(PLAN_ENTITLEMENTS).filter((key) => key !== 'free')) {
      expect(`${plan}: ${listed.has(plan)}`).toBe(`${plan}: true`)
    }
  })
})

describe('every client-written suite collection asks the plan (AGL-2801)', () => {
  const orgs = rawBlockBody(RULES, 'match /orgs/<orgId> {')

  it.each(SUITE_COLLECTIONS)('%s asks on create and update, and not on read or delete', (name, id) => {
    const block = rawBlockBody(orgs, `match /${name}/<${id}> {`)
    expect(allowStatement(block, 'create')).toContain('orgCarriesCrmSuite(orgId)')
    expect(allowStatement(block, 'update')).toContain('orgCarriesCrmSuite(orgId)')
    expect(allowStatement(block, 'read')).not.toContain('orgCarriesCrmSuite')
    expect(allowStatement(block, 'delete')).not.toContain('orgCarriesCrmSuite')
  })

  it("asks on a contact's client update and a segment's create and update, and not on their reads or deletes (AGL-2851)", () => {
    const contacts = rawBlockBody(orgs, 'match /contacts/<contactId> {')
    expect(allowStatement(contacts, 'update')).toContain('orgCarriesCrmSuite(orgId)')
    expect(allowStatement(contacts, 'read')).not.toContain('orgCarriesCrmSuite')
    expect(allowStatement(contacts, 'delete')).not.toContain('orgCarriesCrmSuite')
    // A client create is refused outright; only staff reach it.
    expect(allowStatement(contacts, 'create')).toBe('allow create: if isStaff()')
    const segments = rawBlockBody(orgs, 'match /contactSegments/<segmentId> {')
    expect(allowStatement(segments, 'create')).toContain('orgCarriesCrmSuite(orgId)')
    expect(allowStatement(segments, 'update')).toContain('orgCarriesCrmSuite(orgId)')
    expect(allowStatement(segments, 'read')).not.toContain('orgCarriesCrmSuite')
    expect(allowStatement(segments, 'delete')).not.toContain('orgCarriesCrmSuite')
  })

  it("asks on a lead's update, and refuses a client create, as a contact does (AGL-3277)", () => {
    /*
     * A LEAD IS AN ORG COLLECTION NOW.
     *
     * This read `hosts/{hostId}/leads` and asserted `hostOrgCarriesCrmSuite`
     * and the host catch-all's exclusions. AGL-3275 moved the collection and
     * AGL-3277 deleted the host block, so the host catch-all has nothing to
     * exclude and the plan is asked the org's way.
     */
    const leads = rawBlockBody(orgs, 'match /leads/<leadId> {')
    expect(allowStatement(leads, 'update')).toContain('orgCarriesCrmSuite(orgId)')
    // Created by the server, as a contact is: every door that files a lead is
    // an Admin-SDK path that judges the band and dedupes on the address.
    expect(allowStatement(leads, 'create')).toBe('allow create: if isStaff()')
    // Reading and removing stay open on every plan, as they do for a contact.
    expect(allowStatement(leads, 'read')).not.toContain('orgCarriesCrmSuite')
    expect(allowStatement(leads, 'delete')).not.toContain('orgCarriesCrmSuite')
    // `emailState` stays closed to clients (AGL-3245).
    expect(allowStatement(leads, 'update')).toContain('emailState')
    /*
     * THE HOST PATH IS CLOSED, NOT REOPENED.
     *
     * The dedicated `hosts/{hostId}/leads` block is gone, but `leads` STAYS
     * in the catch-all's create and update exclusions — dropping it there
     * would let the catch-all re-grant client writes to a collection nothing
     * reads any more, which is orphan data by invitation. The exclusion with
     * no block behind it is a denial, which is what a dead path should be.
     */
    const catchAll = parseHostSubcollectionRules(SOURCE)
    expect(catchAll.excluded.create).toContain('leads')
    expect(catchAll.excluded.update).toContain('leads')
    // Delete was never excluded, and still is not.
    expect(catchAll.excluded.delete).not.toContain('leads')
  })
})
