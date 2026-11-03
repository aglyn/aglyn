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
  BUSINESS_DETAILS_CLEARABLE_PATHS,
  BUSINESS_SOCIAL_LINKS_MAX,
  businessDetailsSeed,
  businessDetailsWrite,
  type BusinessDetailsHost,
} from './business-details'
import { resolveHostToken } from './host-tokens'

/**
 * A site's business details are entered once, on Setup → Business profile, and the
 * save keeps the older `business` copies in step (AGL-4136).
 */
describe('businessDetailsSeed', () => {
  it('puts the older one-block email in the Email field when the entity has none', () => {
    const host: BusinessDetailsHost = { business: { supportEmail: ' help@acme.test ' } }
    expect(businessDetailsSeed(host)?.seo?.entity?.email).toBe('help@acme.test')
    // A new object; the document is not changed.
    expect(host.seo).toBeUndefined()
  })

  it('leaves the document as it is when the entity has an email, or there is none', () => {
    const withEntity: BusinessDetailsHost = {
      seo: { entity: { email: 'hello@acme.test' } },
      business: { supportEmail: 'old@acme.test' },
    }
    expect(businessDetailsSeed(withEntity)).toBe(withEntity)
    const bare: BusinessDetailsHost = { displayName: 'Acme' }
    expect(businessDetailsSeed(bare)).toBe(bare)
    expect(businessDetailsSeed(null)).toBeNull()
  })
})

describe('businessDetailsWrite', () => {
  const stored: BusinessDetailsHost = {
    displayName: 'Acme',
    seo: { entity: { email: 'old@acme.test' } },
    business: { supportEmail: 'old@acme.test', address: '1 Old Rd\nAustin' },
  }

  it('writes the email canonically and mirrors it into the one-block copy', () => {
    const next = businessDetailsWrite(
      { seo: { entity: { email: ' hello@acme.test ' } }, business: { supportEmail: 'old@acme.test' } },
      stored,
    ) as any
    expect(next.seo.entity.email).toBe('hello@acme.test')
    expect(next.business.supportEmail).toBe('hello@acme.test')
  })

  it('clears the copy when the email is cleared, so the fallback cannot bring it back', () => {
    const next = businessDetailsWrite({ seo: { entity: {} }, business: { supportEmail: 'old@acme.test' } }, stored) as any
    expect(next.business.supportEmail).toBe('')
    expect(BUSINESS_DETAILS_CLEARABLE_PATHS).toContain('business.supportEmail')
    // With the copy gone as well, the site has no email at all.
    expect(resolveHostToken('supportEmail', { seo: { entity: {} }, business: {} })).toBeUndefined()
  })

  it('writes no empty copy for a site that never had one', () => {
    const next = businessDetailsWrite({ seo: { entity: {} }, business: {} }, { displayName: 'Acme' }) as any
    expect('supportEmail' in next.business).toBe(false)
  })

  it('mirrors a changed structured address, formatted, into the block', () => {
    const next = businessDetailsWrite(
      {
        seo: {
          entity: {
            address: { streetAddress: ' 12 Bean St ', addressLocality: 'Portland', addressRegion: 'OR' },
          },
        },
        business: { address: '1 Old Rd\nAustin' },
      },
      stored,
    ) as any
    expect(next.seo.entity.address.streetAddress).toBe('12 Bean St')
    expect(next.business.address).toBe('12 Bean St, Portland, OR')
  })

  it('keeps an older block through a save that never touched the address', () => {
    const next = businessDetailsWrite(
      { seo: { entity: { telephone: '+1 512 555 0100' } }, business: { address: '1 Old Rd\nAustin' } },
      stored,
    ) as any
    expect(next.business.address).toBe('1 Old Rd\nAustin')
  })

  it('clears the block when the structured address is cleared', () => {
    const withParts: BusinessDetailsHost = {
      seo: { entity: { address: { addressLocality: 'Portland' } } },
      business: { address: 'Portland' },
    }
    const next = businessDetailsWrite({ seo: { entity: { address: {} } }, business: { address: 'Portland' } }, withParts) as any
    expect(next.business.address).toBe('')
    expect(BUSINESS_DETAILS_CLEARABLE_PATHS).toContain('business.address')
  })

  it('trims the name, slogan and phone', () => {
    const next = businessDetailsWrite(
      { seo: { entity: { name: ' Acme Builders ', slogan: ' Built right ', telephone: ' 555 ' } } },
      stored,
    ) as any
    expect(next.seo.entity).toMatchObject({ name: 'Acme Builders', slogan: 'Built right', telephone: '555' })
  })

  it('drops social links with no address, trims the rest and keeps at most the maximum', () => {
    const links = [
      { label: ' Instagram ', url: ' https://instagram.com/acme ' },
      { label: 'Half typed', url: '   ' },
      null,
      ...Array.from({ length: 10 }, (_, index) => ({ label: `L${index}`, url: `https://example.com/${index}` })),
    ]
    const next = businessDetailsWrite({ business: { socialLinks: links } }, stored) as any
    expect(next.business.socialLinks[0]).toEqual({ label: 'Instagram', url: 'https://instagram.com/acme' })
    expect(next.business.socialLinks).toHaveLength(BUSINESS_SOCIAL_LINKS_MAX)
  })

  it('never changes the values it was handed', () => {
    const fields = { seo: { entity: { email: ' a@acme.test ' } }, business: {} }
    const copy = JSON.parse(JSON.stringify(fields))
    businessDetailsWrite(fields, stored)
    expect(fields).toEqual(copy)
  })
})
