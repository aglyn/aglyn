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
  buildAccountAcquisition,
  describeAccountAcquisition,
  organizationAcquisition,
  providerLabel,
  readAccountAcquisition,
  unknownAccountAcquisition,
} from './account-acquisition'

const NOW = Date.UTC(2026, 8, 23, 20, 0, 0)
const LANDED = NOW - 3 * 60_000

/** The 2026-09-23 sign-up this was built for, as the capture would have kept it. */
const reviewSignup = {
  v: 1,
  at: LANDED,
  host: 'example.com',
  path: '/pricing',
  ref: 'www.g2.com',
}

describe('building the record at account creation', () => {
  it('turns the first touch into a record a staff member can read', () => {
    const record = buildAccountAcquisition({
      touch: reviewSignup,
      door: 'signup-password',
      provider: 'password',
      geo: { country: 'au', region: 'NSW', city: 'Sydney' },
      accountCreatedAtMs: NOW - 5_000,
      recordedBy: 'signup',
      nowMs: NOW,
    })
    expect(record).toEqual({
      v: 1,
      source: 'g2.com',
      medium: 'referral',
      campaign: null,
      channel: 'referral',
      capturedAt: LANDED,
      landing: { host: 'example.com', path: '/pricing' },
      referrerHost: 'www.g2.com',
      viaHost: null,
      utm: null,
      clickIds: [],
      door: 'signup-password',
      provider: 'password',
      invitedToOrgId: null,
      geo: { country: 'AU', region: 'NSW', city: 'Sydney' },
      accountCreatedAt: NOW - 5_000,
      recordedAt: NOW,
      recordedBy: 'signup',
    })
    expect(describeAccountAcquisition(record, { primaryHost: 'www.example.com' })).toBe(
      'Referral from g2.com → /pricing → signed up with password',
    )
  })

  it('still records the door when nothing was captured, so the card is never blank', () => {
    const record = buildAccountAcquisition({
      touch: null,
      door: 'signup-google',
      provider: 'google.com',
      recordedBy: 'signup',
      nowMs: NOW,
    })
    expect(record.source).toBe('unknown')
    expect(record.channel).toBe('unknown')
    expect(record.capturedAt).toBeNull()
    expect(record.door).toBe('signup-google')
    expect(describeAccountAcquisition(record)).toBe(
      'Source unknown — nothing was captured → signed up with Google',
    )
  })

  it('refuses what a client may not claim: an invented door, a bad provider, a forged touch', () => {
    const record = buildAccountAcquisition({
      touch: { ...reviewSignup, at: NOW + 7 * 86_400_000, email: 'x@y.z' },
      door: 'staff-override',
      provider: 'javascript:alert(1)',
      geo: 'Sydney',
      invitedToOrgId: '../orgs/x',
      recordedBy: 'signup',
      nowMs: NOW,
    })
    expect(record.source).toBe('unknown')
    expect(record.door).toBe('unknown')
    expect(record.provider).toBeNull()
    expect(record.geo).toBeNull()
    expect(record.invitedToOrgId).toBeNull()
    expect(JSON.stringify(record)).not.toContain('x@y.z')
  })

  it('keeps the tags, the click ids and the internal hop that came before capture', () => {
    const record = buildAccountAcquisition({
      touch: {
        v: 1,
        at: LANDED,
        host: 'docs.example.com',
        path: '/guides/start',
        ref: null,
        via: 'status.example.com',
        utm: { source: 'google', medium: 'cpc', campaign: 'sept-launch', term: 'site builder' },
        click: ['gclid'],
      },
      door: 'invite',
      provider: 'google.com',
      invitedToOrgId: 'org123',
      recordedBy: 'signup',
      nowMs: NOW,
    })
    expect(record.channel).toBe('paid-search')
    expect(record.source).toBe('google')
    expect(record.medium).toBe('cpc')
    expect(record.campaign).toBe('sept-launch')
    expect(record.clickIds).toEqual(['gclid'])
    expect(record.viaHost).toBe('status.example.com')
    expect(describeAccountAcquisition(record, { primaryHost: 'example.com' })).toBe(
      'Paid search (google, sept-launch) → docs.example.com/guides/start → signed up from an invitation, with Google',
    )
  })
})

describe('the organization’s copy', () => {
  it('copies its creator’s record and says whose it is', () => {
    const creator = buildAccountAcquisition({
      touch: reviewSignup,
      door: 'signup-password',
      provider: 'password',
      recordedBy: 'signup',
      nowMs: NOW,
    })
    const copy = organizationAcquisition(creator, 'uid-1', NOW + 1000)
    expect(copy).toEqual({ ...creator, copiedFromUid: 'uid-1' })
  })

  it('names the creator even when the account has no record', () => {
    const copy = organizationAcquisition(undefined, 'uid-1', NOW)
    expect(copy.source).toBe('unknown')
    expect(copy.recordedBy).toBe('org-creation')
    expect(copy.copiedFromUid).toBe('uid-1')
  })
})

describe('reading a stored record', () => {
  it('renders the backfill’s minimal stamp', () => {
    const record = readAccountAcquisition({ source: 'unknown', capturedAt: null })
    expect(record?.channel).toBe('unknown')
    expect(record?.recordedBy).toBe('backfill')
    expect(describeAccountAcquisition(record)).toBe(
      'Source unknown — the account predates capture → created',
    )
  })

  it('round-trips what the builder wrote', () => {
    const record = buildAccountAcquisition({
      touch: reviewSignup,
      door: 'sso',
      provider: 'saml.acme',
      recordedBy: 'sso',
      nowMs: NOW,
    })
    expect(readAccountAcquisition(JSON.parse(JSON.stringify(record)))).toEqual(record)
  })

  it('refuses what is not a record, and cleans what a hand edit added', () => {
    expect(readAccountAcquisition(null)).toBeNull()
    expect(readAccountAcquisition({ channel: 'referral' })).toBeNull()
    const edited = readAccountAcquisition({
      source: 'g2.com',
      channel: 'viral',
      clickIds: ['gclid', 'secret'],
      door: 'backdoor',
      utm: { source: 'g2', password: 'hunter2' },
    })
    expect(edited?.channel).toBe('unknown')
    expect(edited?.clickIds).toEqual(['gclid'])
    expect(edited?.door).toBe('unknown')
    expect(edited?.utm).toEqual({ source: 'g2' })
  })
})

describe('the plain-language line', () => {
  it.each([
    [{ channel: 'direct' }, 'Direct'],
    [{ channel: 'direct', viaHost: 'status.example.com' }, 'Direct, first seen arriving from status.example.com'],
    [{ channel: 'organic-search', referrerHost: 'www.google.com' }, 'Organic search from google.com'],
    [{ channel: 'social', referrerHost: 'www.linkedin.com', campaign: 'launch' }, 'Social from linkedin.com, launch'],
    [{ channel: 'email', source: 'newsletter' }, 'Email (newsletter)'],
  ])('%j reads as %s', (overrides, phrase) => {
    const record = {
      ...unknownAccountAcquisition({ recordedAt: NOW, recordedBy: 'signup' }),
      source: 'x',
      ...overrides,
    } as ReturnType<typeof unknownAccountAcquisition>
    expect(describeAccountAcquisition(record).split(' → ')[0]).toBe(phrase)
  })

  it('names the sign-in provider the way a person does', () => {
    expect(providerLabel('google.com')).toBe('Google')
    expect(providerLabel('oidc.okta')).toBe('single sign-on')
    expect(providerLabel(null)).toBeNull()
  })
})
