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
'use client'

import type { OrgFeatureFlags } from '@aglyn/aglyn'
import { resolvePlanFeatureLock, type PlanFeatureLock } from './plan-feature-lock'
import { useConsoleHostRoute } from './use-console-host-route'
import { useOrgPlan } from './use-org-plan'

/**
 * {@link resolvePlanFeatureLock} for a site: its owning org's plan, and the
 * org slug the upgrade link is built from.
 */
export function usePlanFeature(
  hostId: string | undefined,
  feature: keyof OrgFeatureFlags,
): PlanFeatureLock {
  const { orgSlug } = useConsoleHostRoute(hostId)
  const { org, ready } = useOrgPlan(hostId)
  return resolvePlanFeatureLock({ org, ready, feature, orgSlug })
}

export default usePlanFeature
