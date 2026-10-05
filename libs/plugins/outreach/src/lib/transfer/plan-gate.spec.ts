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

import { outreachTransferPlanGate } from './plan-gate'

/*
 * Sequences' transfers ask Sequences' entitlement (AGL-3548): a workspace
 * without it is refused in every Sequences route's words, in the transfer
 * routes' 403 `plan_required` body; one granted the add-on moves both
 * resources.
 */
describe('outreachTransferPlanGate', () => {
  const subject = (org: Record<string, unknown>) => ({ resource: 'outreach.do-not-contact', orgId: 'org-1', hostId: null, org })

  it('refuses a workspace without Sequences, whatever its plan', () => {
    for (const plan of ['free', 'starter', 'enterprise']) {
      expect(outreachTransferPlanGate(subject({ plan }), 'import')).toEqual({
        status: 403,
        body: { error: "Sequences isn't available to this workspace yet.", reason: 'plan_required', code: 'outreach' },
      })
    }
  })

  it('moves both ways for a workspace granted Sequences', () => {
    const granted = subject({ plan: 'free', entitlements: { features: { outreach: true } } })
    expect(outreachTransferPlanGate(granted, 'import')).toBeNull()
    expect(outreachTransferPlanGate(granted, 'export')).toBeNull()
  })
})
