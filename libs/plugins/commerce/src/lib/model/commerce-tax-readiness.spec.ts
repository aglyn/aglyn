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

import {
  checkoutTaxBlock,
  checkoutTaxRefusalNotice,
  STRIPE_TAX_REGISTRATIONS_DASHBOARD_URL,
  STRIPE_TAX_SETTINGS_DASHBOARD_URL,
  stripeTaxStatusFromSettings,
  stripeTaxStepHref,
} from './commerce-tax-readiness'

describe('stripeTaxStatusFromSettings (AGL-4245)', () => {
  const active = {
    status: 'active',
    head_office: { address: { country: 'US', state: 'TX' } },
    defaults: { tax_code: 'txcd_99999999', tax_behavior: 'exclusive' },
    status_details: { active: {} },
  }

  it('reads an active account as active with nothing left', () => {
    expect(stripeTaxStatusFromSettings(active, true)).toEqual({
      readable: true,
      active: true,
      missing: [],
      hasRegistration: true,
    })
  })

  it('keeps an active account active with no registration, and says so separately', () => {
    const status = stripeTaxStatusFromSettings(active, false)
    expect(status.active).toBe(true)
    expect(status.missing).toEqual([])
    expect(status.hasRegistration).toBe(false)
  })

  it('names what Stripe says is missing, in the order an owner does it', () => {
    const status = stripeTaxStatusFromSettings(
      {
        status: 'pending',
        head_office: null,
        defaults: { tax_code: null },
        status_details: { pending: { missing_fields: ['head_office'] } },
      },
      false,
    )
    expect(status).toEqual({
      readable: true,
      active: false,
      missing: ['head-office', 'tax-code', 'registration'],
      hasRegistration: false,
    })
  })

  it('maps a named tax code field even when the settings carry one', () => {
    const status = stripeTaxStatusFromSettings(
      {
        status: 'pending',
        head_office: { address: { country: 'US' } },
        defaults: { tax_code: 'txcd_1' },
        status_details: { pending: { missing_fields: ['defaults.tax_code'] } },
      },
      true,
    )
    expect(status.missing).toEqual(['tax-code'])
  })

  it('does not list registrations it could not read', () => {
    const status = stripeTaxStatusFromSettings({ status: 'pending', head_office: null }, null)
    expect(status.missing).toEqual(['head-office', 'tax-code'])
    expect(status.hasRegistration).toBeNull()
  })

  it('reads an unreadable answer as not readable and not active', () => {
    expect(stripeTaxStatusFromSettings(null, null)).toEqual({
      readable: false,
      active: false,
      missing: [],
      hasRegistration: null,
    })
  })
})

describe('checkoutTaxBlock (AGL-4245)', () => {
  const on = stripeTaxStatusFromSettings({ status: 'active', head_office: { address: {} } }, true)
  const off = stripeTaxStatusFromSettings({ status: 'pending' }, false)

  it('blocks a store that never chose, whatever its account', () => {
    expect(checkoutTaxBlock({ mode: null, direct: false, stripeTax: null })).toBe('tax-undecided')
    expect(checkoutTaxBlock({ mode: 'something-new', direct: true, stripeTax: on })).toBe('tax-undecided')
  })

  it('blocks Stripe Tax on the store’s own account until it is on', () => {
    expect(checkoutTaxBlock({ mode: 'stripe', direct: true, stripeTax: off })).toBe('stripe-tax-not-active')
    expect(checkoutTaxBlock({ mode: 'stripe', direct: true, stripeTax: null })).toBe('stripe-tax-not-active')
    expect(checkoutTaxBlock({ mode: 'stripe', direct: true, stripeTax: on })).toBeNull()
  })

  it('never blocks Stripe Tax on the platform, or the other two choices', () => {
    expect(checkoutTaxBlock({ mode: 'stripe', direct: false, stripeTax: null })).toBeNull()
    expect(checkoutTaxBlock({ mode: 'manual', direct: true, stripeTax: off })).toBeNull()
    expect(checkoutTaxBlock({ mode: 'none', direct: true, stripeTax: off })).toBeNull()
  })
})

describe('Stripe Dashboard links and the owner’s notice (AGL-4245)', () => {
  it('opens registrations for the registration step and Tax settings for the rest', () => {
    expect(stripeTaxStepHref('registration')).toBe(STRIPE_TAX_REGISTRATIONS_DASHBOARD_URL)
    expect(stripeTaxStepHref('head-office')).toBe(STRIPE_TAX_SETTINGS_DASHBOARD_URL)
    expect(stripeTaxStepHref('tax-code')).toBe(STRIPE_TAX_SETTINGS_DASHBOARD_URL)
  })

  it('points the owner to Products → Taxes for both reasons', () => {
    for (const reason of ['tax-undecided', 'stripe-tax-not-active'] as const) {
      const notice = checkoutTaxRefusalNotice(reason)
      expect(notice.title).toContain('{site}')
      expect(notice.body).toContain('Products → Taxes')
    }
  })
})
