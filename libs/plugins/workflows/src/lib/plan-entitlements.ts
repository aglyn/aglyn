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

// Types only: the manifest generator loads this module on its own to compile
// the plan figures, so nothing here may reach a core module at runtime.
import type { OrgPlan } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import type { PluginPlanEntitlementsDeclaration } from '@aglyn/aglyn/plugin-manager/plugin-plan-entitlements'

/**
 * THE WORKFLOWS PLUGIN'S PLAN BAND (AGL-3080): the workflow runs each plan
 * includes a month. Compiled into core's `PLAN_ENTITLEMENTS` by the manifest
 * generator (`register.planEntitlements`).
 */
declare module '@aglyn/aglyn/plugin-manager/plugin-entitlement-keys' {
  interface PluginEntitlementQuotas {
    /** Event-triggered workflow runs per calendar month (AGL-165). */
    workflowRunsPerMonth?: number
  }
}

/**
 * The workflow runs each plan includes a month. Priced into the cost model at
 * `perRun` beside the action-run band, since 2026-09-07.
 */
export const WORKFLOW_RUNS_PER_MONTH_BY_PLAN: Readonly<Record<OrgPlan, number>> = {
  free: 0,
  starter: 500,
  pro: 5000,
  business: 50000,
  scale: 150000,
  advanced: 500000,
  agency: 2000000,
  // Agency's band × 2, the rule every Enterprise fallback follows.
  enterprise: 4_000_000,
}

/** The workflows plugin's plan figures, for the manifest generator. */
export function workflowsPlanEntitlements(): PluginPlanEntitlementsDeclaration {
  return {
    quotas: [
      {
        key: 'workflowRunsPerMonth',
        label: 'Workflow runs / mo',
        byPlan: WORKFLOW_RUNS_PER_MONTH_BY_PLAN,
      },
    ],
  }
}
