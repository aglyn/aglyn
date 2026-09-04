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
 * `blockedExtensionNotice` (owner feedback sweep): the Events page told an
 * org that Event Calendar "is not included in your current plan", wording
 * that implies an upgrade would include it. `eventCalendar` is `false` on
 * every one of the eight plans (`PLAN_ENTITLEMENTS`) — it is sold only as a
 * $9/mo per-org add-on, so no upgrade ever includes it, and the shell's
 * generic refusal notice has to say so instead.
 *
 * `PLAN_ENTITLEMENTS` is real here, not mocked, for the same reason
 * `enforced-entitlement-affordances.spec.ts` and the commerce entitlement
 * gate specs keep it real: a stand-in table could not tell "no plan grants
 * this" from "the stand-in forgot to grant it".
 */

import { PLAN_ENTITLEMENTS } from '@aglyn/aglyn'
import { blockedExtensionNotice } from './extension-entitlement'

describe('blockedExtensionNotice', () => {
  it('never tells an org eventCalendar is a plan away — false on all eight plans', () => {
    for (const plan of Object.keys(PLAN_ENTITLEMENTS)) {
      expect(
        (PLAN_ENTITLEMENTS as any)[plan].features.eventCalendar,
      ).toBe(false)
    }
    const notice = blockedExtensionNotice('Events', 'eventCalendar')
    expect(notice).not.toMatch(/is not included in your current plan/)
    expect(notice).toMatch(/isn't included in any plan/)
    expect(notice).toMatch(/paid add-on/)
  })

  it('CONTROL: keeps the upgrade framing for a feature a real plan grants', () => {
    // `redirects` is free on some tier and pro-and-up on others — a genuine
    // "upgrade to unlock this" feature, so the original sentence is the
    // honest one here and must not be replaced.
    const notice = blockedExtensionNotice('Redirects', 'redirects')
    expect(notice).toBe(
      'Redirects is not included in your current plan. Manage your plan and ' +
        'add-ons from Billing.',
    )
  })
})
