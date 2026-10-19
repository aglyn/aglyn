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
import {
  resolvePlanFeatureLock,
  type PlanFeatureLock,
} from '@aglyn/tenant-feature-instance/hooks/plan-feature-lock'
import useCurrentOrg from './use-current-org'
import { useOrgSlug } from './use-org-scope'

/**
 * The current workspace's lock state for one plan feature — the console's
 * half of `usePlanFeature`, read from `useCurrentOrg()` rather than a site's
 * owning org, so organization-level pages and the besigner share it.
 */
export function usePlanFeatureLock(feature: keyof OrgFeatureFlags): PlanFeatureLock {
  const { org, ready } = useCurrentOrg()
  const orgSlug = useOrgSlug()
  return resolvePlanFeatureLock({ org, ready, feature, orgSlug })
}

export default usePlanFeatureLock
