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
 * `buildOrgUserProperties` (AGL-1852) — the `internal-traffic-flag.spec.ts`
 * shape: the predicate is pure and pinned here; the layout wiring is a
 * source assertion below.
 *
 * The expensive direction is STALENESS, not absence: GA user properties
 * persist until overwritten and the console does not remount across a
 * re-auth (AGL-664), so a missing clear quietly reports the PREVIOUS
 * session's plan tier against a new user's behaviour.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildOrgUserProperties } from '../utils/analytics-user-properties'

describe('buildOrgUserProperties (AGL-1852)', () => {
  it('reports the active org membership: plan tier and role', () => {
    expect(
      buildOrgUserProperties({ orgId: 'org-1', role: 'owner', plan: 'pro' }),
    ).toEqual({ org_plan: 'pro', org_role: 'owner' })
  })

  it('no org scope clears BOTH — an explicit null, never a stale carry-over', () => {
    expect(buildOrgUserProperties({})).toEqual({
      org_plan: null,
      org_role: null,
    })
    expect(buildOrgUserProperties({ orgId: null, role: 'owner', plan: 'pro' })).toEqual({
      org_plan: null,
      org_role: null,
    })
  })

  it('a plan still loading reports null, not free and not the last org’s tier', () => {
    // "Not loaded" answering a question is the loading-default failure shape:
    // `useOrgPlans` answers 'free' for a successful read with no plan field,
    // so null here can only ever mean "not known yet / read failed".
    expect(
      buildOrgUserProperties({ orgId: 'org-1', role: 'admin', plan: undefined }),
    ).toEqual({ org_plan: null, org_role: 'admin' })
  })

  it("free tier is a VALUE — useOrgPlans' explicit 'free' survives to the report", () => {
    expect(
      buildOrgUserProperties({ orgId: 'org-1', role: 'viewer', plan: 'free' }),
    ).toEqual({ org_plan: 'free', org_role: 'viewer' })
  })
})

describe('the layout wires the properties (AGL-1852)', () => {
  it('firebase-app.layout.tsx feeds buildOrgUserProperties into setUserProperties', () => {
    const layout = readFileSync(
      resolve(__dirname, '../components/layouts/firebase-app.layout.tsx'),
      'utf8',
    )
    expect(layout).toMatch(/buildOrgUserProperties/)
    // The org-scoped properties ride the SAME Firebase instance the uid
    // properties use, so they attach to the same GA user.
    expect(layout).toMatch(
      /setUserProperties\(\s*analytics,\s*buildOrgUserProperties\(/,
    )
  })
})
