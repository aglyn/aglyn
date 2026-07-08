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
  contactMatchesSegment,
  CONTACT_INTERACTIONS_CAP,
  extractEmailFromFields,
  mergeContactInteraction,
  normalizeContactEmail,
} from './contacts'

describe('contacts (AGL-197)', () => {
  it('normalizes emails and rejects junk', () => {
    expect(normalizeContactEmail('  Jane@Example.COM ')).toBe(
      'jane@example.com',
    )
    expect(normalizeContactEmail('not-an-email')).toBeNull()
    expect(normalizeContactEmail('')).toBeNull()
    expect(normalizeContactEmail(undefined)).toBeNull()
    expect(normalizeContactEmail('a b@c.com')).toBeNull()
  })

  it('extracts emails from free-form fields, preferring email-ish keys', () => {
    expect(
      extractEmailFromFields({
        message: 'reach me at home',
        workEmail: 'Work@Co.com',
        reply: 'other@x.com',
      }),
    ).toBe('work@co.com')
    expect(extractEmailFromFields({ note: 'x', addr: 'p@q.org' })).toBe(
      'p@q.org',
    )
    expect(extractEmailFromFields({ note: 'nothing here' })).toBeNull()
    expect(extractEmailFromFields(undefined)).toBeNull()
  })

  it('merges interactions newest-first, capped, keeping existing names', () => {
    const existing = {
      name: 'Jane',
      sources: { form: true as const },
      interactions: Array.from({ length: CONTACT_INTERACTIONS_CAP }, (_, i) => ({
        type: 'form' as const,
        atMs: i,
      })),
    }
    const merged = mergeContactInteraction(existing, {
      source: 'order',
      name: 'J. Doe',
      interaction: { type: 'order', atMs: 999999 },
    })
    expect(merged.name).toBe('Jane')
    expect(merged.sources).toEqual({ form: true, order: true })
    expect(merged.interactions).toHaveLength(CONTACT_INTERACTIONS_CAP)
    expect(merged.interactions[0]).toEqual({ type: 'order', atMs: 999999 })
  })

  it('fills a missing name from the update', () => {
    const merged = mergeContactInteraction(
      { sources: {}, interactions: [] },
      {
        source: 'member',
        name: 'New Name',
        interaction: { type: 'member', atMs: 1 },
      },
    )
    expect(merged.name).toBe('New Name')
  })

  it('matches segments: AND across kinds, OR within one', () => {
    const contact = { tags: ['VIP', 'beta'], sources: { form: true as const } }
    expect(contactMatchesSegment(contact, {})).toBe(true)
    expect(contactMatchesSegment(contact, { tags: ['vip'] })).toBe(true)
    expect(contactMatchesSegment(contact, { tags: ['other'] })).toBe(false)
    expect(contactMatchesSegment(contact, { sources: ['form', 'order'] })).toBe(
      true,
    )
    expect(contactMatchesSegment(contact, { sources: ['order'] })).toBe(false)
    expect(
      contactMatchesSegment(contact, { tags: ['vip'], sources: ['order'] }),
    ).toBe(false)
  })
})
