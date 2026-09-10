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
 * THE CRM SUITE'S PLAN GATE, for the routes the console calls (AGL-2787).
 *
 * The 2026-09-05 pricing decision includes the CRM suite from Starter:
 * `features.crm` is false on Free, and Free keeps the contacts list — the
 * capture projection the email audiences read. Two doors onto the suite's
 * records already ask the plan: the shell draws the suite's sections locked
 * and refuses their bodies, and the `/v1` dispatcher refuses the `crm:*`
 * resources. These routes are the third door. A lock drawn on a page is
 * advice to a script holding a member's token, so the same question is
 * asked where the write happens.
 *
 * ## After authorization, never before
 *
 * Each route asks once it knows who is calling and has read the org to
 * answer that — the order the shell refuses in. A reader who may not open a
 * surface is not shown its upgrade path, and a caller with no standing in
 * the workspace learns nothing about its plan.
 *
 * ## One refusal shape
 *
 * 403, as the REST refusal is, with its two machine-readable facts in the
 * console routes' flat body: `reason: 'plan_required'` is the REST
 * `error.type` and `code: 'crm'` its `error.code`. Beside them, a sentence
 * the console relays unchanged, as it relays every route refusal. The plan
 * it names comes from the plan tables, so it cannot name a tier that has
 * stopped carrying the suite.
 *
 * ## Staff are refused too
 *
 * The plan is a fact about the workspace, not about the person asking. A
 * support engineer acting inside a Free workspace would otherwise create
 * suite records that the workspace then holds without the suite.
 */

import { checkEntitlement, planLabelGrantingFeature } from '@aglyn/aglyn/server'

/** The entitlement the suite is sold under — the REST refusal's `error.code`. */
export const CRM_SUITE_FEATURE = 'crm'

/** The REST refusal's `error.type`, as a console route's `reason`. */
export const CRM_SUITE_REFUSAL_REASON = 'plan_required'

/** What a route answers a workspace whose plan does not carry the suite. */
export interface CrmSuiteRefusal {
  status: 403
  body: {
    error: string
    reason: typeof CRM_SUITE_REFUSAL_REASON
    code: typeof CRM_SUITE_FEATURE
  }
}

/**
 * The refusal's sentence, for an act named as a phrase that takes "is" —
 * "Importing a CSV file", "A CRM recipe".
 */
export function crmSuiteRefusalMessage(act: string): string {
  const plan = planLabelGrantingFeature(CRM_SUITE_FEATURE)
  return (
    `${act} is part of the CRM suite, which is not included in your current ` +
    'plan. Manage your plan and add-ons from Billing.' +
    (plan ? ` Included from ${plan}.` : '')
  )
}

/**
 * `null` when the org's plan carries the suite, else the refusal to send.
 *
 * Resolved through `checkEntitlement`, so a per-org
 * `entitlements.features.crm` grant or revocation, and a paid plan whose
 * subscription has died, answer here exactly as they answer everywhere else.
 */
export function crmSuiteRefusal(org: unknown, act: string): CrmSuiteRefusal | null {
  if (checkEntitlement(org as Parameters<typeof checkEntitlement>[0], CRM_SUITE_FEATURE)) {
    return null
  }
  return {
    status: 403,
    body: {
      error: crmSuiteRefusalMessage(act),
      reason: CRM_SUITE_REFUSAL_REASON,
      code: CRM_SUITE_FEATURE,
    },
  }
}
