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
  brandForSubdomainLabel,
  describePhishingScreenSignals,
  linkHostsIn,
  lookalikeBrandForHost,
  OUTBOUND_REVIEW_YOUNG_DAYS,
  phishingSignalTier,
  registrableDomain,
  screenOutboundEmail,
  signalsThatHold,
} from './outbound-phishing-screen'

/**
 * The outbound phishing screen (AGL-3356).
 *
 * Two halves, weighted the same: the incident's own messages HOLD, and the
 * ordinary mail a young merchant sends — a hotel that mentions Booking.com,
 * a bakery with apples, a shop that sells on Amazon — does NOT. A screen that
 * only had the first half tested would pass while holding every newsletter.
 */

const OWN = {
  ownNames: ['Harbor View Hotel', 'harborview'],
  ownDomains: ['harborview.aglyn.app', 'harborviewhotel.com'],
}

describe('the incident', () => {
  it('holds the Poshmark workflow email on its lookalike link', () => {
    const verdict = screenOutboundEmail({
      subject: 'Poshmark Order #88213',
      bodies: [
        'Hi! One of the items from your Seller Account has finally sold. ' +
          'Details: https://poshmark.id63835663.shop/order/88213',
      ],
      ...OWN,
    })
    expect(verdict.hold).toBe(true)
    expect(verdict.signals).toContainEqual({
      code: 'lookalike-link',
      brand: 'poshmark',
      host: 'poshmark.id63835663.shop',
    })
  })

  it('holds it even from a workspace NAMED Poshmark', () => {
    // The sibling account was an org called "Poshmark". A name is the
    // cheapest thing a fraudster controls, so it never excuses the link.
    const verdict = screenOutboundEmail({
      subject: 'Poshmark Order',
      bodies: ['Details: https://poshmark.id63835663.shop/o'],
      ownNames: ['Poshmark'],
      ownDomains: ['poshmark.aglyn.app'],
    })
    expect(verdict.hold).toBe(true)
  })

  it('holds a Booking.com-style guest feedback lure linking elsewhere', () => {
    const verdict = screenOutboundEmail({
      subject: 'Shared feedback regarding your property',
      fromName: 'PropertyAssistant',
      preheader: 'A guest left a complaint on Booking.com',
      bodies: [
        '<p>Dear partner, a guest complaint regarding your property was ' +
          'filed via Booking.com. <a href="https://guest-portal-review.top/c/9x">View the feedback</a></p>',
      ],
      replyTo: 'support@throwaway-mailer.xyz',
    })
    expect(verdict.hold).toBe(true)
    expect(verdict.signals[0]).toMatchObject({
      code: 'brand-lure-link',
      brand: 'booking',
      host: 'guest-portal-review.top',
    })
  })
})

describe('lookalike hosts', () => {
  it.each([
    ['poshmark.id63835663.shop', 'poshmark'],
    ['paypal-secure.com', 'paypal'],
    ['secure-paypal.net', 'paypal'],
    ['paypa1.com', 'paypal'],
    ['www.booking.com.guest-review.top', 'booking'],
    ['booking-com-reviews.info', 'booking'],
    ['docusign.files-share.ru', 'docusign'],
    ['appleid.verify-now.top', 'apple'],
    ['apple.account-check.top', 'apple'],
    ['usps-redelivery.com', 'usps'],
    ['wellsfargo-alerts.co.uk', 'wellsfargo'],
  ])('%s wears %s', (host, brand) => {
    expect(lookalikeBrandForHost(host)?.id).toBe(brand)
  })

  it.each([
    'www.paypal.com',
    'poshmark.com',
    'www.booking.com',
    'secure.booking.com',
    's3.amazonaws.com',
    'www.amazon.co.uk',
    'www.amazon.de',
    'apple.co.uk',
    'login.microsoftonline.com',
    'apple-orchard-farm.com',
    'amazonrainforesttours.com',
    'bookingengine.hotelsoft.com',
    'booking.harborviewhotel.com',
    'myoffice.com.au',
  ])('%s is not a lookalike', (host) => {
    expect(lookalikeBrandForHost(host)).toBeNull()
  })

  it('finds the real host behind a userinfo disguise', () => {
    expect(linkHostsIn('https://paypal.com@evil.top/login')).toEqual(
      expect.arrayContaining(['evil.top', 'paypal.com']),
    )
    // The disguise alone is paypal's own domain, so it is the SHAPE that
    // holds here — which is what the next case pins.
    expect(
      screenOutboundEmail({ bodies: ['https://paypal.com.evil.top@x.top/'] }).hold,
    ).toBe(true)
  })

  it('reads a link hidden behind HTML entities', () => {
    expect(linkHostsIn('https://paypal&#45;secure&#46;com/x')).toEqual(['paypal-secure.com'])
  })

  it('reads links out of a JSON-serialized design', () => {
    const design = JSON.stringify({
      nodes: { a: { props: { html: '<a href="https://netflix-billing.help/u">Update</a>' } } },
    })
    expect(screenOutboundEmail({ bodies: [design] }).signals[0]).toMatchObject({
      code: 'lookalike-link',
      brand: 'netflix',
    })
  })

  it('ignores a URL that is still a merge tag', () => {
    expect(linkHostsIn('https://{{site.host}}/offer')).toEqual([])
  })

  it('holds a lookalike reply address', () => {
    expect(
      screenOutboundEmail({ subject: 'Hello', replyTo: 'help@paypal-resolution.com' }).hold,
    ).toBe(true)
  })
})

describe('a brand in the sender name', () => {
  it('holds mail that says it is from PayPal', () => {
    const verdict = screenOutboundEmail({ fromName: 'PayPal Support', subject: 'Hello', ...OWN })
    expect(verdict.signals).toEqual([
      { code: 'brand-sender', brand: 'paypal', fromName: 'PayPal Support' },
    ])
  })

  it('lets a workspace send under its own name', () => {
    expect(
      screenOutboundEmail({
        fromName: 'Wells Fargo Advisors — Dana Reed',
        ownNames: ['Wells Fargo Advisors Dana Reed'],
      }).hold,
    ).toBe(false)
  })

  it('does not read the fruit as the company', () => {
    expect(screenOutboundEmail({ fromName: 'Apple Valley Bakery' }).hold).toBe(false)
  })
})

describe('ordinary mail from a young workspace passes', () => {
  it('a hotel that mentions Booking.com and links to it', () => {
    expect(
      screenOutboundEmail({
        subject: 'Your stay at Harbor View',
        bodies: [
          'Thanks for staying! If you booked through Booking.com, leave us a ' +
            'guest review there: https://www.booking.com/hotel/us/harbor-view.html ' +
            'or on Google: https://g.page/harborview/review',
        ],
        ...OWN,
      }).hold,
    ).toBe(false)
  })

  it('a shop that sells on Amazon and links to its own site', () => {
    expect(
      screenOutboundEmail({
        subject: 'New arrivals',
        bodies: [
          'Our candles are now on Amazon too! Sign in to your account to see ' +
            'member pricing: https://harborviewhotel.com/account',
        ],
        ...OWN,
      }).hold,
    ).toBe(false)
  })

  it('a newsletter that names a brand and links elsewhere, with no lure', () => {
    expect(
      screenOutboundEmail({
        subject: 'Five tools we love',
        bodies: [
          'We run our bookings on DocuSign and Microsoft 365. Read more on our ' +
            'partner blog https://smallbiz-weekly.com/tools',
        ],
        ...OWN,
      }).hold,
    ).toBe(false)
  })

  it('a lure-shaped sentence with no brand in it', () => {
    expect(
      screenOutboundEmail({
        subject: 'Action needed',
        bodies: ['Please verify your email to finish signing up: https://forms.example-crm.com/v/1'],
        ...OWN,
      }).hold,
    ).toBe(false)
  })

  it('a link to a NEIGHBOR site on the apex is somewhere else, not the workspace', () => {
    // Ownership is by host, never by the shared apex's registrable domain.
    const verdict = screenOutboundEmail({
      subject: 'Guest complaint',
      bodies: [
        'A guest complaint was filed on Booking.com: https://other-site.aglyn.app/view',
      ],
      ...OWN,
    })
    expect(verdict.signals[0]).toMatchObject({
      code: 'brand-lure-link',
      host: 'other-site.aglyn.app',
    })
  })
})

describe('the staff wording', () => {
  it('describes each signal in a sentence', () => {
    const [line] = describePhishingScreenSignals([
      { code: 'lookalike-link', brand: 'poshmark', host: 'poshmark.id63835663.shop' },
    ])
    expect(line).toContain('poshmark.id63835663.shop')
    expect(line).toContain('Poshmark')
  })
})

describe('registrableDomain', () => {
  it('keeps a two-label suffix whole', () => {
    expect(registrableDomain('a.b.evil.co.uk')).toBe('evil.co.uk')
    expect(registrableDomain('poshmark.id63835663.shop')).toBe('id63835663.shop')
  })
})

describe('the tiers (every surface)', () => {
  const lookalike = { code: 'lookalike-link', brand: 'poshmark', host: 'poshmark.id63835663.shop' }
  const credential = { code: 'credential-field', field: 'password', label: 'Password' }
  const sender = { code: 'brand-sender', brand: 'paypal', fromName: 'PayPal' }
  const lure = { code: 'brand-lure-link', brand: 'booking', lure: 'guest complaint', host: 'x.top' }
  const page = { code: 'brand-action-page', brand: 'docusign', action: 'Review file' }

  it('a lookalike and a credential field hold for every workspace, of any age', () => {
    for (const ageDays of [0, 13, 14, 400, null]) {
      expect(signalsThatHold([lookalike, credential, sender], { ageDays })).toEqual(
        ageDays !== null && ageDays < OUTBOUND_REVIEW_YOUNG_DAYS
          ? [lookalike, credential, sender]
          : [lookalike, credential],
      )
    }
  })

  it('the soft rules hold only for a workspace in its first fortnight', () => {
    expect(signalsThatHold([sender, lure, page], { ageDays: 13 })).toHaveLength(3)
    expect(signalsThatHold([sender, lure, page], { ageDays: 14 })).toEqual([])
    // Unreadable creation date: an existing customer.
    expect(signalsThatHold([sender, lure, page], { ageDays: null })).toEqual([])
  })

  it('the soft rules never hold mail the recipient is owed; a lookalike still does', () => {
    expect(signalsThatHold([sender, lure, lookalike], { ageDays: 1, owed: true })).toEqual([lookalike])
  })

  it('names the tier of every signal code', () => {
    expect(phishingSignalTier(lookalike)).toBe('strong')
    expect(phishingSignalTier(credential)).toBe('strong')
    expect(phishingSignalTier(sender)).toBe('soft')
    expect(phishingSignalTier(lure)).toBe('soft')
    expect(phishingSignalTier(page)).toBe('soft')
  })
})

describe('a subdomain that wears a brand', () => {
  it.each([
    ['poshmark', 'poshmark'],
    ['paypal-secure', 'paypal'],
    ['secure-paypal', 'paypal'],
    ['paypa1', 'paypal'],
    ['booking-review', 'booking'],
    ['booking-com', 'booking'],
    ['appleid', 'apple'],
    ['apple-support', 'apple'],
    ['amazon-account', 'amazon'],
    ['docusign-files', 'docusign'],
    ['wellsfargo', 'wellsfargo'],
    ['poshmark-2', 'poshmark'],
  ])('%s is refused as %s', (label, brand) => {
    expect(brandForSubdomainLabel(label)?.id).toBe(brand)
  })

  it.each([
    'apple-pie-co',
    'tanyas-booking',
    'booking',
    'harborview',
    'propertyhelper',
    'amazonia-tours',
    'dhlfan',
    'my-id-photos',
  ])('%s is an ordinary name', (label) => {
    expect(brandForSubdomainLabel(label)).toBeNull()
  })
})
