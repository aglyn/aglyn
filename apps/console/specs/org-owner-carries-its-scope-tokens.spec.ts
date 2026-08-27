/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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

import { projectMemberScopeTokens } from '@aglyn/aglyn/app-utils/organizations'
import { ORG_SCOPE_TOKEN } from '@aglyn/aglyn/app-utils/scope-tokens'
import {
  planMemberScopeTokens,
} from '../utils/server/backfill-scope'

/**
 * A brand-new organization is not born drifted (AGL-1038).
 *
 * Every membership write in `organizations.ts` reaches
 * `syncOrgAuthProjections`, which recomputes `scopeTokens` for the whole
 * roster. Org CREATION does not: the owner's member doc is written inside the
 * creating transaction and nothing runs after it. So the owner had no
 * `scopeTokens` at all, and the weekly scope-drift detector reported the
 * organization from the day it was made until some later membership change
 * happened to heal it — which is why exactly one production org showed drift
 * while six did not.
 *
 * The consequence is mild by luck rather than design: the rules short-circuit
 * on an org-wide member, and `resolveMemberScopeTokens` recomputes when the
 * field is absent. What it costs is the SIGNAL — a detector that names a real
 * gap every week trains its reader to ignore it.
 *
 * This asserts the shape the creating transaction writes, through the same
 * two functions the write and the detector each use. A literal `['org']` here
 * would pass while those two disagreed, which is the disagreement that
 * produced the drift.
 */
describe('the owner member doc a new org writes', () => {
  /** Exactly what `createOrganization` puts in `orgs/{id}/members/{owner}`. */
  const ownerMember = {
    role: 'owner' as const,
    allHosts: true,
    scopeTokens: projectMemberScopeTokens({ role: 'owner', allHosts: true }),
  }

  it('carries the projection, not nothing', () => {
    expect(ownerMember.scopeTokens).toEqual([ORG_SCOPE_TOKEN])
  })

  it('THE POINT: the drift detector plans no write for it', () => {
    // The detector recomputes and writes wherever the stored value differs.
    // Agreeing with it is the whole property — and it is what an owner doc
    // written without the field could never do.
    const plan = planMemberScopeTokens([{ $id: 'owner-uid', ...ownerMember }])
    expect(plan.writes).toEqual([])
    expect(plan.skipped).toBe(1)
  })

  it('THE CONTROL: the same doc WITHOUT the field is planned for a write', () => {
    // Without this, the case above could pass because the detector plans
    // nothing for anybody.
    const plan = planMemberScopeTokens([
      { $id: 'owner-uid', role: 'owner', allHosts: true },
    ])
    expect(plan.writes).toEqual([
      { id: 'owner-uid', data: { scopeTokens: [ORG_SCOPE_TOKEN] } },
    ])
  })
})
