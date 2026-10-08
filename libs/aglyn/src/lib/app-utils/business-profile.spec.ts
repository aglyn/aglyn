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
  businessProfileOwnerWrite,
  mergeBusinessProfilePrefill,
  resolveBusinessProfile,
  sanitizeBusinessProfileValues,
  type BusinessProfileDoc,
} from './business-profile'

describe('resolveBusinessProfile (AGL-3661)', () => {
  const host = {
    displayName: 'Paws & Co',
    logoUrl: 'https://cdn.example/logo.png',
    seo: {
      entity: {
        name: 'Paws and Company Grooming',
        description: 'Dog grooming with a calm, gentle hand.',
        telephone: '(512) 555-0100',
        email: 'hello@paws.example',
        openingHours: 'Mo-Fr 09:00-17:00',
        address: { streetAddress: '1 Main St', addressLocality: 'Austin', addressRegion: 'TX' },
        areaServed: ['Austin', 'Round Rock'],
        businessType: 'PetStore',
      },
    },
    business: {
      supportEmail: 'support@paws.example',
      socialLinks: [{ label: 'Instagram', url: 'https://instagram.com/paws' }, { url: 'http://insecure.example' }],
    },
  }

  it('reads name, contact, profiles and logo from the site settings, never from the profile', () => {
    const profile = resolveBusinessProfile({ host })
    expect(profile.name).toEqual({ value: 'Paws and Company Grooming', origin: 'site' })
    expect(profile.contact).toEqual({
      email: 'hello@paws.example',
      phone: '(512) 555-0100',
      address: '1 Main St, Austin, TX',
      hours: 'Mo-Fr 09:00-17:00',
    })
    expect(profile.profiles).toEqual(['https://instagram.com/paws'])
    expect(profile.logo).toBe('https://cdn.example/logo.png')
    expect(profile.businessType).toBe('PetStore')
  })

  it('falls back to the display name and the contact card', () => {
    const profile = resolveBusinessProfile({
      host: { displayName: 'Paws & Co', business: { supportEmail: 'a@b.example', address: 'PO Box 1' } },
    })
    expect(profile.name).toEqual({ value: 'Paws & Co', origin: 'site' })
    expect(profile.contact).toEqual({ email: 'a@b.example', phone: null, address: 'PO Box 1', hours: null })
  })

  it('says nothing about contact details nobody entered', () => {
    const profile = resolveBusinessProfile({ host: { displayName: 'New site' } })
    expect(profile.contact).toEqual({ email: null, phone: null, address: null, hours: null })
    expect(profile.whatYouDo).toBeNull()
  })

  it('ranks the owner, then the site settings, then suggestions, then the workspace', () => {
    const site: BusinessProfileDoc = {
      whatYouDo: 'AI line',
      audience: 'Busy dog owners',
      services: ['Baths'],
      sources: { whatYouDo: 'ai', audience: 'owner', services: 'start' },
    }
    const workspace: BusinessProfileDoc = { tone: 'friendly', audience: 'Everyone' }
    const profile = resolveBusinessProfile({ host, site, workspace })
    expect(profile.whatYouDo).toEqual({ value: 'Dog grooming with a calm, gentle hand.', origin: 'site' })
    expect(profile.audience).toEqual({ value: 'Busy dog owners', origin: 'owner' })
    expect(profile.services).toEqual({ value: ['Baths'], origin: 'start' })
    expect(profile.serviceArea).toEqual({ value: 'Austin, Round Rock', origin: 'site' })
    expect(profile.tone).toEqual({ value: 'friendly', origin: 'workspace' })
  })

  it("puts the owner's own line ahead of the SEO entity's", () => {
    const profile = resolveBusinessProfile({
      host,
      site: { whatYouDo: 'Mine', sources: { whatYouDo: 'owner' } },
    })
    expect(profile.whatYouDo).toEqual({ value: 'Mine', origin: 'owner' })
  })
})

describe('mergeBusinessProfilePrefill (AGL-3661)', () => {
  it('fills empty fields and records the source', () => {
    const next = mergeBusinessProfilePrefill(null, { audience: 'Families', serviceArea: 'Austin' }, 'start')
    expect(next).toEqual({
      audience: 'Families',
      serviceArea: 'Austin',
      sources: { audience: 'start', serviceArea: 'start' },
    })
  })

  it("never replaces what the owner typed, even with the start's answers", () => {
    const current: BusinessProfileDoc = { audience: 'Mine', sources: { audience: 'owner' } }
    expect(mergeBusinessProfilePrefill(current, { audience: 'Theirs' }, 'start')).toBeNull()
  })

  it('treats a value with no recorded source as the owner’s', () => {
    expect(mergeBusinessProfilePrefill({ audience: 'Mine' }, { audience: 'Theirs' }, 'ai')).toBeNull()
  })

  it('lets the start replace a guess, and never the other way round', () => {
    const guessed: BusinessProfileDoc = { whatYouDo: 'Guess', sources: { whatYouDo: 'ai' } }
    expect(mergeBusinessProfilePrefill(guessed, { whatYouDo: 'Answer' }, 'start')).toMatchObject({
      whatYouDo: 'Answer',
      sources: { whatYouDo: 'start' },
    })
    const answered: BusinessProfileDoc = { whatYouDo: 'Answer', sources: { whatYouDo: 'start' } }
    expect(mergeBusinessProfilePrefill(answered, { whatYouDo: 'Guess' }, 'ai')).toBeNull()
  })

  it('does not refill a field the owner cleared', () => {
    const cleared: BusinessProfileDoc = { audience: '', sources: { audience: 'owner' } }
    expect(mergeBusinessProfilePrefill(cleared, { audience: 'Families' }, 'ai')).toBeNull()
  })

  it('writes nothing when nothing changes', () => {
    const current: BusinessProfileDoc = { audience: 'Families', sources: { audience: 'ai' } }
    expect(mergeBusinessProfilePrefill(current, { audience: 'Families' }, 'ai')).toBeNull()
    expect(mergeBusinessProfilePrefill(current, { audience: '  ' }, 'ai')).toBeNull()
  })
})

describe('businessProfileOwnerWrite (AGL-3661)', () => {
  it("claims only the fields the owner changed and records a cleared suggestion as theirs", () => {
    const current: BusinessProfileDoc = {
      whatYouDo: 'Suggested',
      audience: 'Suggested audience',
      services: ['Baths'],
      sources: { whatYouDo: 'ai', audience: 'ai', services: 'start' },
    }
    const next = businessProfileOwnerWrite(current, {
      whatYouDo: 'Suggested',
      audience: '',
      services: ['Baths', 'Nail trims'],
      tone: 'plain',
    })
    expect(next.sources).toEqual({ whatYouDo: 'ai', audience: 'owner', services: 'owner', tone: 'owner' })
    expect(next.audience).toBe('')
    expect(next.tone).toBe('plain')
  })
})

describe('sanitizeBusinessProfileValues (AGL-3661)', () => {
  it('caps, trims, de-duplicates and refuses an unknown tone', () => {
    const clean = sanitizeBusinessProfileValues({
      services: ['  Baths ', 'baths', 'x'.repeat(100), ...Array.from({ length: 20 }, (_, i) => `S${i}`)],
      tone: 'shouty' as never,
      whatYouDo: 'a'.repeat(500),
    })
    expect(clean.services?.[0]).toBe('Baths')
    expect(clean.services?.[1]).toHaveLength(60)
    expect(clean.services).toHaveLength(12)
    expect(clean.tone).toBeNull()
    expect(clean.whatYouDo).toHaveLength(200)
  })
})
