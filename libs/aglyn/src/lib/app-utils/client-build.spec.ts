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
  clientBuildIntakeErrors,
  clientBuildIntent,
  clientBuildPhone,
  clientBuildPreviewText,
  clientBuildResumeStep,
  clientBuildSiteAddress,
  domainPriceText,
  EMPTY_CLIENT_BUILD_INTAKE,
  normalizeClientBuildDomainName,
  parseClientBuildDomain,
  parseClientBuildIntake,
  readClientBuildIntent,
  type ClientBuildIntake,
} from './client-build'

const INTAKE: ClientBuildIntake = {
  businessName: 'Harbor Plumbing',
  whatTheyDo: 'a family plumbing business',
  towns: 'Austin and Round Rock',
  phone: '(512) 555-0123',
  email: 'owner@example.com',
  hours: 'Mon–Fri 8–5',
  ownerWords: 'Three generations fixing pipes the right way.',
}

describe('the client build intake (AGL-3958)', () => {
  it('admits a full intake, trimmed', () => {
    expect(parseClientBuildIntake({ ...INTAKE, businessName: '  Harbor Plumbing  ' })).toEqual(INTAKE)
  })

  it('needs the name and what they do', () => {
    const errors = clientBuildIntakeErrors({ ...INTAKE, businessName: ' ', whatTheyDo: '' })
    expect(errors.businessName).toBe('Name the business.')
    expect(errors.whatTheyDo).toBe('Say what the business does.')
  })

  it('needs a phone or an email, so the preview reaches the owner', () => {
    expect(clientBuildIntakeErrors({ ...INTAKE, phone: '', email: '' }).phone).toMatch(/phone or an email/)
    expect(clientBuildIntakeErrors({ ...INTAKE, phone: '' })).toEqual({})
    expect(clientBuildIntakeErrors({ ...INTAKE, email: '' })).toEqual({})
  })

  it('refuses a phone it cannot text and an email it cannot send to', () => {
    const errors = clientBuildIntakeErrors({ ...INTAKE, phone: '555-01', email: 'owner@' })
    expect(errors.phone).toMatch(/area code/)
    expect(errors.email).toMatch(/name@example.com/)
  })

  it('bounds every answer', () => {
    expect(clientBuildIntakeErrors({ ...INTAKE, ownerWords: 'x'.repeat(1_501) }).ownerWords).toMatch(/1,500/)
    expect(parseClientBuildIntake({ ...INTAKE, towns: 'x'.repeat(121) })).toMatch(/120/)
  })

  it('refuses a body that is not an intake, and a field that is not text', () => {
    expect(parseClientBuildIntake(null)).toBe('Missing the business details')
    expect(parseClientBuildIntake({ ...INTAKE, phone: 5125550123 })).toBe('phone must be text')
  })

  it('texts the phone as E.164', () => {
    expect(clientBuildPhone(INTAKE)).toBe('+15125550123')
    expect(clientBuildPhone(EMPTY_CLIENT_BUILD_INTAKE)).toBeNull()
  })
})

describe('the Domain step (AGL-3958)', () => {
  it('reads a domain as it is typed on a phone', () => {
    expect(normalizeClientBuildDomainName('https://www.HarborPlumbing.com/about')).toBe('harborplumbing.com')
    expect(normalizeClientBuildDomainName('harbor-plumbing.co.uk.')).toBe('harbor-plumbing.co.uk')
    expect(normalizeClientBuildDomainName('harbor plumbing')).toBeNull()
    expect(normalizeClientBuildDomainName('localhost')).toBeNull()
    expect(normalizeClientBuildDomainName(42)).toBeNull()
  })

  it('admits the three answers', () => {
    expect(parseClientBuildDomain({ choice: 'free' })).toEqual({ choice: 'free' })
    expect(parseClientBuildDomain({ choice: 'own', name: 'www.example.com' })).toEqual({
      choice: 'own',
      name: 'example.com',
    })
    expect(
      parseClientBuildDomain({ choice: 'register', name: 'harborplumbing.com', firstYearUsd: 11.25, renewalUsd: 18.99 }),
    ).toEqual({ choice: 'register', name: 'harborplumbing.com', firstYearUsd: 11.25, renewalUsd: 18.99 })
  })

  it('refuses a pick without both prices, and an unknown choice', () => {
    expect(parseClientBuildDomain({ choice: 'register', name: 'harborplumbing.com', firstYearUsd: 11 })).toMatch(
      /first-year and renewal/,
    )
    expect(parseClientBuildDomain({ choice: 'own', name: 'not a domain' })).toMatch(/example.com/)
    expect(parseClientBuildDomain({ choice: 'buy-now' })).toBe('Unknown domain choice')
  })

  it('says both prices together, always', () => {
    expect(domainPriceText({ firstYearUsd: 11.25, renewalUsd: 18.99 })).toBe(
      '$11.25 the first year, then $18.99 a year',
    )
    expect(domainPriceText({ firstYearUsd: 13, renewalUsd: 13 })).toBe('$13.00 a year')
  })
})

describe('the intent the hand-off carries (AGL-3958)', () => {
  it('starts on the comped plan with Site Care, monthly, and carries a pick to register', () => {
    expect(
      clientBuildIntent({
        plan: 'pro',
        domain: { choice: 'register', name: 'harborplumbing.com', firstYearUsd: 11.25, renewalUsd: 18.99 },
      }),
    ).toEqual({
      plan: 'pro',
      addons: ['siteCare'],
      interval: 'month',
      domain: { name: 'harborplumbing.com', firstYearUsd: 11.25, renewalUsd: 18.99 },
    })
  })

  it('carries a domain they already have as one to connect, and the free address as neither', () => {
    expect(clientBuildIntent({ plan: 'starter', domain: { choice: 'own', name: 'example.com' } })).toEqual({
      plan: 'starter',
      addons: ['siteCare'],
      interval: 'month',
      existingDomain: 'example.com',
    })
    const free = clientBuildIntent({ plan: 'starter', domain: { choice: 'free' } })
    expect(free).not.toHaveProperty('domain')
    expect(free).not.toHaveProperty('existingDomain')
  })

  it('proposes Starter when the workspace carries no comp it could sell', () => {
    expect(clientBuildIntent({ plan: null }).plan).toBe('starter')
    expect(clientBuildIntent({ plan: 'free' }).plan).toBe('starter')
    expect(clientBuildIntent({ plan: 'enterprise' }).plan).toBe('starter')
  })

  it('reads a stored intent back, and nothing that is not one', () => {
    const stored = {
      plan: 'business',
      addons: ['siteCare', 'aiAddon', 7],
      interval: 'year',
      coupon: ' BOOTH25 ',
      domain: { name: 'HarborPlumbing.com', firstYearUsd: 11.25, renewalUsd: 18.99 },
    }
    expect(readClientBuildIntent(stored)).toEqual({
      plan: 'business',
      addons: ['siteCare', 'aiAddon'],
      interval: 'year',
      coupon: 'BOOTH25',
      domain: { name: 'harborplumbing.com', firstYearUsd: 11.25, renewalUsd: 18.99 },
    })
    expect(readClientBuildIntent({ plan: 'starter', existingDomain: 'example.com' })).toMatchObject({
      existingDomain: 'example.com',
    })
    expect(readClientBuildIntent({ plan: 'platinum' })).toBeNull()
    expect(readClientBuildIntent(null)).toBeNull()
  })
})

describe('the build as stored (AGL-3958)', () => {
  it('resumes at the first unfinished step', () => {
    expect(clientBuildResumeStep(null)).toBe('details')
    expect(clientBuildResumeStep({ domain: null, hostId: null, jobId: null })).toBe('domain')
    expect(clientBuildResumeStep({ domain: { choice: 'free' }, hostId: null, jobId: null })).toBe('photos')
    expect(clientBuildResumeStep({ domain: { choice: 'free' }, hostId: 'h1', jobId: null })).toBe('photos')
    expect(clientBuildResumeStep({ domain: { choice: 'free' }, hostId: 'h1', jobId: 'j1' })).toBe('send')
  })

  it('tells the owner the address it will live at', () => {
    const live = 'https://harbor.example.app'
    expect(clientBuildSiteAddress({ choice: 'free' }, live)).toBe('harbor.example.app')
    expect(clientBuildSiteAddress({ choice: 'own', name: 'example.com' }, live)).toBe('example.com')
    expect(clientBuildSiteAddress(null, null)).toBeNull()
  })

  it('texts a short preview that says who it is from', () => {
    expect(
      clientBuildPreviewText({
        businessName: 'Harbor Plumbing',
        previewUrl: 'https://harbor.example.app',
        siteAddress: 'harborplumbing.com',
        productName: 'Aglyn',
      }),
    ).toBe(
      'Aglyn: the new website for Harbor Plumbing is ready to look at: https://harbor.example.app It will live at harborplumbing.com.',
    )
    expect(
      clientBuildPreviewText({
        businessName: 'Harbor Plumbing',
        previewUrl: 'https://harbor.example.app',
        siteAddress: 'harbor.example.app',
        productName: 'Aglyn',
      }),
    ).not.toMatch(/live at/)
  })
})
