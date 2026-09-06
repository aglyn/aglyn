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

import { PLAN_ENTITLEMENTS, planLabelGrantingFeature } from '@aglyn/aglyn'
import {
  blockedExtensionNotice,
  composeExtensionEntitlements,
  resolveExtensionEntitlement,
} from './extension-entitlement'

describe('composeExtensionEntitlements (AGL-2611)', () => {
  it('lets a settled refusal outrank everything, and an unsettled read outrank a yes', () => {
    expect(composeExtensionEntitlements('entitled', 'blocked')).toBe('blocked')
    expect(composeExtensionEntitlements('pending', 'blocked')).toBe('blocked')
    expect(composeExtensionEntitlements('entitled', 'pending')).toBe('pending')
    expect(composeExtensionEntitlements('entitled', 'entitled')).toBe('entitled')
    // Declaring nothing composes as `entitled`, so a surface with no flag of
    // its own inherits its extension's verdict unchanged — both ways.
    expect(composeExtensionEntitlements('blocked')).toBe('blocked')
    expect(composeExtensionEntitlements()).toBe('entitled')
  })

  it('is the extension flag AND the section flag, from real plan rows', () => {
    // Free carries neither `redirects` nor `crm`; Starter carries both; the
    // CRM's own case is an unflagged extension over a `crm`-flagged section.
    const free = { plan: 'free' }
    const starter = { plan: 'starter' }
    const verdict = (org: unknown, ready: boolean) =>
      composeExtensionEntitlements(
        resolveExtensionEntitlement(undefined, org, ready),
        resolveExtensionEntitlement('crm', org, ready),
      )
    expect(verdict(free, true)).toBe('blocked')
    expect(verdict(starter, true)).toBe('entitled')
    expect(verdict(undefined, false)).toBe('pending')
    // A per-org grant on the section's flag is honored like any other.
    expect(
      verdict({ plan: 'free', entitlements: { features: { crm: true } } }, true),
    ).toBe('entitled')
  })
})

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
        'add-ons from Billing. Included from Starter.',
    )
    // The tier is the ladder's answer, not a literal: the sentence names
    // whichever plan first grants the flag today (AGL-2611).
    expect(planLabelGrantingFeature('redirects')).toBe('Starter')
    expect(blockedExtensionNotice('Deals', 'crm')).toBe(
      'Deals is not included in your current plan. Manage your plan and ' +
        'add-ons from Billing. Included from Starter.',
    )
  })
})
