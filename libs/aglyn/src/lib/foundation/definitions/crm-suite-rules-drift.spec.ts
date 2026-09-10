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

describe('every client-written suite collection asks the plan (AGL-2801)', () => {
  const orgs = rawBlockBody(RULES, 'match /orgs/<orgId> {')

  it.each(SUITE_COLLECTIONS)('%s asks on create and update, and not on read or delete', (name, id) => {
    const block = rawBlockBody(orgs, `match /${name}/<${id}> {`)
    expect(allowStatement(block, 'create')).toContain('orgCarriesCrmSuite(orgId)')
    expect(allowStatement(block, 'update')).toContain('orgCarriesCrmSuite(orgId)')
    expect(allowStatement(block, 'read')).not.toContain('orgCarriesCrmSuite')
    expect(allowStatement(block, 'delete')).not.toContain('orgCarriesCrmSuite')
  })

  it("asks for a lead's create and update under its site, and the catch-all cannot re-grant them", () => {
    const hosts = rawBlockBody(RULES, 'match /hosts/<hostId> {')
    const leads = rawBlockBody(hosts, 'match /leads/<leadId> {')
    expect(allowStatement(leads, 'create, update')).toContain('hostOrgCarriesCrmSuite(hostId)')
    // Sibling matches are OR'd: without the exclusions the block narrows nothing.
    const catchAll = parseHostSubcollectionRules(SOURCE)
    expect(catchAll.excluded.create).toContain('leads')
    expect(catchAll.excluded.update).toContain('leads')
    // Reading and removing a lead stay with the catch-all, on every plan.
    expect(catchAll.excluded.delete).not.toContain('leads')
  })
})
