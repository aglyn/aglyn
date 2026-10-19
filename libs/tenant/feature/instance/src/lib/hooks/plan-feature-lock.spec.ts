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
 * The one answer every plan-gated console control is drawn from (AGL-3977):
 * locked only once the plan is KNOWN to lack the feature, with the plan that
 * includes it and a link to the plan grid. The plan tables are the real ones.
 */

import { planLabelGrantingFeature } from '@aglyn/aglyn'
import { planLockReason, resolvePlanFeatureLock } from './plan-feature-lock'

describe('resolvePlanFeatureLock', () => {
  it('locks a Free workspace, naming the plan that includes it and linking the plan grid', () => {
    const lock = resolvePlanFeatureLock({
      org: { plan: 'free' },
      ready: true,
      feature: 'scheduledPublishing',
      orgSlug: 'acme',
    })
    expect(lock).toEqual({
      ready: true,
      entitled: false,
      locked: true,
      planLabel: planLabelGrantingFeature('scheduledPublishing'),
      upgradeHref: '/acme/billing#plans',
    })
    expect(lock.planLabel).toBe('Business')
  })

  it('opens it on a plan that includes it', () => {
    const lock = resolvePlanFeatureLock({
      org: { plan: 'business', billingStatus: 'active' },
      ready: true,
      feature: 'scheduledPublishing',
      orgSlug: 'acme',
    })
    expect(lock.entitled).toBe(true)
    expect(lock.locked).toBe(false)
  })

  it('locks NOTHING while the plan is still loading, though the empty org reads as Free', () => {
    const lock = resolvePlanFeatureLock({
      org: undefined,
      ready: false,
      feature: 'scheduledPublishing',
      orgSlug: 'acme',
    })
    expect(lock.entitled).toBe(false)
    expect(lock.locked).toBe(false)
  })

  it('links the add-ons for a feature no plan includes', () => {
    const lock = resolvePlanFeatureLock({
      org: { plan: 'free' },
      ready: true,
      feature: 'eventCalendar',
      orgSlug: 'acme',
    })
    expect(lock.planLabel).toBeUndefined()
    expect(lock.upgradeHref).toBe('/acme/billing#addons')
  })

  it('has no link before the org slug is known', () => {
    const lock = resolvePlanFeatureLock({
      org: { plan: 'free' },
      ready: true,
      feature: 'versioning',
      orgSlug: null,
    })
    expect(lock.locked).toBe(true)
    expect(lock.upgradeHref).toBeUndefined()
  })
})

describe('planLockReason', () => {
  it('names the plan', () => {
    expect(planLockReason('Scheduled publishing', 'Business')).toBe(
      'Scheduled publishing is included from Business.',
    )
  })

  it('says add-on where no plan includes it', () => {
    expect(planLockReason('Event calendar', undefined)).toBe('Event calendar is a paid add-on.')
  })
})
