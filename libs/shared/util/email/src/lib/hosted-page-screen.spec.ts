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

import { isCredentialFieldName, screenHostedPage, screenSiteRedirect } from './hosted-page-screen'
import { signalsThatHold } from './outbound-phishing-screen'

/**
 * The hosted page screen (AGL-3362): the email screen's brand list and
 * lookalike logic read over a published page. As with the email screen, the
 * ordinary pages a young merchant publishes are tested as hard as the
 * phishing ones — a hotel that links to Booking.com, a bakery named for
 * apples, a realtor asking clients to review a listing, a site with its own
 * member sign-in.
 */

/** A composed page: a map of nodes, the shape `composeScreenNodes` returns. */
function page(
  ...nodes: Array<{ componentId: string; props?: Record<string, unknown> }>
) {
  return Object.fromEntries(
    nodes.map((node, index) => [
      `n${index}`,
      { $id: `n${index}`, ...node, props: node.props ?? {} },
    ]),
  )
}

const text = (children: string) => ({
  componentId: 'muiTypography',
  props: { children },
})
const button = (children: string, href: string) => ({
  componentId: 'muiButton',
  props: { children, href },
})
const field = (props: Record<string, unknown>) => ({
  componentId: 'formField',
  props,
})

const HOTEL = {
  ownNames: ['Harbor View Hotel', 'harborview'],
  ownDomains: ['harborview.aglyn.app', 'harborviewhotel.com'],
}

const codes = (nodes: unknown, identity = {}) =>
  screenHostedPage({ nodes, ...identity }).signals.map((signal) => signal.code)

describe('what holds on a page', () => {
  it('a link to a brand lookalike — the incident', () => {
    const verdict = screenHostedPage({
      nodes: page(
        text('One of your items has sold.'),
        button('View order', 'https://poshmark.id63835663.shop/o/1'),
      ),
    })
    expect(verdict.signals).toEqual([
      {
        code: 'lookalike-link',
        brand: 'poshmark',
        host: 'poshmark.id63835663.shop',
      },
    ])
  })

  it('an EMBED or a protocol-relative source on a lookalike', () => {
    expect(
      codes(
        page({
          componentId: 'videoEmbed',
          props: { url: 'https://paypa1.com/frame' },
        }),
      ),
    ).toEqual(['lookalike-link'])
    expect(
      codes(
        page({
          componentId: 'image',
          props: { src: '//booking.com.guest-review.top/logo.png' },
        }),
      ),
    ).toEqual(['lookalike-link'])
  })

  it('a password, card or one-time-code field the author defined', () => {
    const verdict = screenHostedPage({
      nodes: page(
        field({ fieldName: 'email', label: 'Email', fieldType: 'email' }),
        field({ fieldName: 'pw', label: 'Password', fieldType: 'text' }),
        field({ fieldName: 'cc', label: 'Card number' }),
        field({
          fieldName: 'code',
          label: 'Enter the verification code we texted you',
        }),
      ),
    })
    expect(verdict.signals).toEqual([
      expect.objectContaining({ code: 'credential-field', field: 'password' }),
      expect.objectContaining({ code: 'credential-field', field: 'card' }),
      expect.objectContaining({ code: 'credential-field', field: 'otp' }),
    ])
  })

  it('a field typed or autocompleted as a credential, whatever its label', () => {
    expect(
      codes(page(field({ fieldName: 'a', label: 'Secret', type: 'password' }))),
    ).toEqual(['credential-field'])
    expect(
      codes(
        page(
          field({ fieldName: 'b', label: 'Number', autoComplete: 'cc-number' }),
        ),
      ),
    ).toEqual(['credential-field'])
  })

  it('a credential input in the author’s own HTML', () => {
    expect(
      codes(
        page({
          componentId: 'custom-html',
          props: { html: '<form><input type="password" name="p"></form>' },
        }),
      ),
    ).toEqual(['credential-field'])
  })

  it('a brand’s sign-in call to action, in one element, on a page that links away — the /reviewfile lure', () => {
    const verdict = screenHostedPage({
      nodes: page(
        text(
          'DocuSign: a document has been shared with you. Review file to continue.',
        ),
        button('Open', 'https://files-share.example.top/view'),
      ),
      ...HOTEL,
    })
    // Its one button also leaves the site beside "a document has been shared
    // with you", which reads the same page without the brand (AGL-3447).
    expect(verdict.signals).toEqual([
      expect.objectContaining({ code: 'brand-action-page', brand: 'docusign' }),
      {
        code: 'offsite-action-page',
        action: 'Open',
        lure: 'document has been shared with you',
        host: 'files-share.example.top',
      },
    ])
    // Soft: a young workspace's page holds, an established one's does not.
    expect(signalsThatHold(verdict.signals, { ageDays: 2 })).toHaveLength(2)
    expect(signalsThatHold(verdict.signals, { ageDays: 60 })).toHaveLength(0)
  })
})

/**
 * The 2026-10-01 page (AGL-3447), as `composeScreenNodes` handed it over: a
 * 41-minute-old free workspace's "Share File" header with a SharePoint-style
 * icon, a "Secure Document Access Portal" heading, Proofpoint's name in the
 * body, and one button off the site to where the credentials were taken.
 * The brand, the lure and the action sit in three different elements, so the
 * one-element rule read none of it.
 */
const SHARE_FILE_PAGE = page(
  { componentId: 'muiStack', props: { direction: 'row' } },
  {
    componentId: 'icon',
    props: { path: 'M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z' },
  },
  text('Share File'),
  { componentId: 'muiTypography', props: { variant: 'h3', children: 'Secure Document Access Portal' } },
  text(
    'Proofpoint Encryption for your sensitive documents. Access, share and collaborate with confidence',
  ),
  {
    componentId: 'muiButton',
    props: {
      children: 'Continue to Document',
      href: 'https://temps-juenes.com/',
      variant: 'contained',
    },
  },
)

/** The workspace that published it: a name, a subdomain, nothing else. */
const PHISHER = { ownNames: ['Docs Center', 'docs-center-4471'], ownDomains: ['docs-center-4471.aglyn.app'] }

describe('the document-share page (AGL-3447)', () => {
  it('HOLDS for a workspace in its first fortnight, naming the brand, the lure and where the button goes', () => {
    const verdict = screenHostedPage({ nodes: SHARE_FILE_PAGE, ...PHISHER })
    expect(verdict.signals).toEqual(
      expect.arrayContaining([
        {
          code: 'brand-lure-page',
          brand: 'proofpoint',
          lure: 'Secure Document',
          host: 'temps-juenes.com',
        },
        {
          code: 'offsite-action-page',
          action: 'Continue to Document',
          lure: 'Secure Document',
          host: 'temps-juenes.com',
        },
      ]),
    )
    // The one-element rule still does not fire: nothing here is one element.
    expect(verdict.signals.map((signal) => signal.code)).not.toContain('brand-action-page')
    // Held at 41 minutes old, and at 13 days.
    expect(signalsThatHold(verdict.signals, { ageDays: 0 }).length).toBeGreaterThan(0)
    expect(signalsThatHold(verdict.signals, { ageDays: 13 }).length).toBeGreaterThan(0)
    // Soft, so it never takes down an established workspace's page.
    expect(signalsThatHold(verdict.signals, { ageDays: 14 })).toEqual([])
  })

  it('holds it before the workspace is known too — the first pass the review runs without reads', () => {
    expect(
      signalsThatHold(screenHostedPage({ nodes: SHARE_FILE_PAGE }).signals, { ageDays: 0 }).length,
    ).toBeGreaterThan(0)
  })

  it('holds the same page with every brand taken out: the button leaving beside the lure is the shape', () => {
    const brandless = page(
      text('Secure Document Access Portal'),
      text('Your sensitive documents, encrypted. Access, share and collaborate with confidence'),
      button('Continue to Document', 'https://temps-juenes.com/'),
    )
    const verdict = screenHostedPage({ nodes: brandless, ...PHISHER })
    expect(verdict.signals).toEqual([
      {
        code: 'offsite-action-page',
        action: 'Continue to Document',
        lure: 'Secure Document',
        host: 'temps-juenes.com',
      },
    ])
    expect(signalsThatHold(verdict.signals, { ageDays: 0 })).toHaveLength(1)
  })

  it('reads a brand page-wide: Microsoft in the body, the account lure in a heading, a sign-in button off the site', () => {
    const verdict = screenHostedPage({
      nodes: page(
        text('Microsoft 365'),
        text('Your password will expire today.'),
        button('Keep my password', 'https://m365-keep.example.top/'),
        button('Help', '/help'),
      ),
      ...PHISHER,
    })
    expect(verdict.signals).toEqual([
      {
        code: 'brand-lure-page',
        brand: 'microsoft',
        lure: 'password will expire',
        host: 'm365-keep.example.top',
      },
      // "Keep my password" is itself an account lure (AGL-3453), so the
      // button that leaves is the page's call to action, brand or not.
      {
        code: 'offsite-action-page',
        action: 'Keep my password',
        lure: 'password will expire',
        host: 'm365-keep.example.top',
      },
    ])
  })

  it('reads a custom HTML block that splits the brand and the lure letter by letter (AGL-3453)', () => {
    const split = (words: string) =>
      [...words].map((letter) => (letter === ' ' ? ' ' : `${letter}<span class=x>`)).join('')
    const verdict = screenHostedPage({
      nodes: page({
        componentId: 'custom-html',
        props: {
          html:
            `<h2>${split('Google Workspace')}</h2><p>${split('Your password expires today.')}</p>` +
            `<a href="https://relay.example.top/k">${split('Keep your password')}</a>`,
        },
      }),
      ...PHISHER,
    })
    // One element, so the one-element rule reads it — once its tags are out.
    expect(verdict.signals).toContainEqual({
      code: 'brand-action-page',
      brand: 'google',
      action: 'password expire',
    })
  })

  it('reads the action on a button that leaves when the page carries no lure wording of its own', () => {
    const verdict = screenHostedPage({
      nodes: page(text('Dropbox'), text('Q3 board pack (PDF, 2.1 MB)'), button('View the file', 'https://dl-files.example.top/q3')),
      ...PHISHER,
    })
    expect(verdict.signals).toEqual([
      { code: 'brand-lure-page', brand: 'dropbox', lure: 'View the file', host: 'dl-files.example.top' },
    ])
  })
})

describe('what the page-wide rules leave alone (AGL-3447)', () => {
  /** A law firm's client portal page: its document portal lives on its own domain. */
  const LAW_FIRM = {
    ownNames: ['Hale & Whitcomb LLP', 'halewhitcomb'],
    ownDomains: ['halewhitcomb.aglyn.app', 'halewhitcomb.com'],
  }
  const CLIENT_PORTAL = page(
    { componentId: 'muiTypography', props: { variant: 'h2', children: 'Client document portal' } },
    text(
      'Clients can access secure documents, sign engagement letters and share files with your attorney. ' +
        'Your documents are encrypted in transit and at rest. Sign in to your account with the email we have on file.',
    ),
    text('We use Microsoft 365 and Adobe Acrobat Sign for engagement letters.'),
    button('Open the client portal', 'https://portal.halewhitcomb.com/login'),
    button('Contact us', '/contact'),
  )

  it('a law firm’s client document portal on its own domain, whatever the workspace’s age', () => {
    // Its own domain is not "elsewhere", so nothing is found to hold — an
    // established firm's page, and a new firm's too.
    const verdict = screenHostedPage({ nodes: CLIENT_PORTAL, ...LAW_FIRM })
    expect(verdict.signals).toEqual([])
    expect(signalsThatHold(verdict.signals, { ageDays: 900 })).toEqual([])
    expect(signalsThatHold(verdict.signals, { ageDays: 1 })).toEqual([])
  })

  it('an established firm whose portal is a vendor’s: soft signals only, so nothing holds', () => {
    const verdict = screenHostedPage({
      nodes: page(
        text('Client document portal'),
        text('Access secure documents and share files with your attorney.'),
        button('Open the client portal', 'https://halewhitcomb.portal-vendor.example/login'),
      ),
      ...LAW_FIRM,
    })
    expect(verdict.signals.map((signal) => signal.code)).toEqual(['offsite-action-page'])
    expect(signalsThatHold(verdict.signals, { ageDays: 900 })).toEqual([])
  })

  it('a hotel with Booking.com in one place, guest reviews in another, and directions off the site', () => {
    expect(
      codes(
        page(
          text('Find us on Booking.com.'),
          text('Our guest reviews speak for themselves.'),
          button('Directions', 'https://maps.example.com/harbor'),
          button('Members sign in', '/members/signin'),
        ),
        HOTEL,
      ),
    ).toEqual([])
  })

  it('a shop whose one button leaves for its store, with no lure on the page', () => {
    expect(
      codes(
        page(text('Hand-thrown mugs, made in Taos.'), button('Shop the collection', 'https://shop.example.net/mugs')),
        HOTEL,
      ),
    ).toEqual([])
  })

  it('a page that LINKS Google Docs or Dropbox on their own domains', () => {
    expect(
      codes(
        page(
          text('Fill in the Google Docs sign-up sheet, or open the shared file on Dropbox.'),
          button('Open the sign-up sheet', 'https://docs.google.com/forms/d/abc'),
          button('Open the file', 'https://www.dropbox.com/s/xyz/menu.pdf'),
        ),
        HOTEL,
      ),
    ).toEqual([])
  })
})

describe('a site redirect (AGL-3447)', () => {
  it('reads a path that is a document-share lure, sent off the site', () => {
    const verdict = screenSiteRedirect({
      source: '/secure-document-access',
      destination: 'https://temps-juenes.com/',
      ...PHISHER,
    })
    expect(verdict.signals).toEqual([
      {
        code: 'offsite-redirect',
        source: '/secure-document-access',
        lure: 'secure document',
        host: 'temps-juenes.com',
      },
    ])
    expect(signalsThatHold(verdict.signals, { ageDays: 0 })).toHaveLength(1)
    expect(signalsThatHold(verdict.signals, { ageDays: 400 })).toEqual([])
  })

  it('names the brand a lure path wears', () => {
    expect(
      screenSiteRedirect({ source: '/paypal/verify-your-account', destination: 'https://evil.example.top/x' }).signals,
    ).toContainEqual(
      expect.objectContaining({ code: 'brand-lure-link', brand: 'paypal', host: 'evil.example.top' }),
    )
  })

  it('holds a lookalike destination for every workspace', () => {
    const verdict = screenSiteRedirect({ source: '/login', destination: 'https://sharepoint-files.example.top/' })
    expect(verdict.signals).toEqual([
      { code: 'lookalike-link', brand: 'microsoft', host: 'sharepoint-files.example.top' },
    ])
    expect(signalsThatHold(verdict.signals, { ageDays: 900 })).toHaveLength(1)
  })

  it.each([
    ['/old-menu', 'https://shop.example.net/menu'],
    ['/client-portal', 'https://portal.halewhitcomb.com/'],
    ['/secure-document-access', 'https://portal.halewhitcomb.com/'],
    ['/reviews', 'https://www.google.com/maps/place/x'],
    ['/sign', 'https://app.docusign.com/x'],
    ['/pricing', '/plans'],
  ])('leaves %s → %s alone', (source, destination) => {
    expect(
      screenSiteRedirect({
        source,
        destination,
        ownNames: ['Hale & Whitcomb LLP'],
        ownDomains: ['halewhitcomb.aglyn.app', 'halewhitcomb.com'],
      }).signals,
    ).toEqual([])
  })
})

describe('what does not hold (false-positive guards)', () => {
  it('a hotel that links to Booking.com, has a contact form and a member sign-in link', () => {
    expect(
      codes(
        page(
          text('Find us on Booking.com and read what our guests say.'),
          button(
            'Book on Booking.com',
            'https://www.booking.com/hotel/us/harbor-view.html',
          ),
          button('Sign in', '/members/signin'),
          field({ fieldName: 'email', label: 'Email', fieldType: 'email' }),
          field({
            fieldName: 'message',
            label: 'Message',
            fieldType: 'textarea',
          }),
          button('Directions', 'https://maps.example.com/harbor'),
        ),
        HOTEL,
      ),
    ).toEqual([])
  })

  it('a bakery named "Apple Pie Co"', () => {
    expect(
      codes(
        page(
          text('Apple Pie Co — sign in to order our apple pies for pickup.'),
          button('Order', 'https://orders.example.net/applepieco'),
        ),
        {
          ownNames: ['Apple Pie Co', 'apple-pie-co'],
          ownDomains: ['apple-pie-co.aglyn.app'],
        },
      ),
    ).toEqual([])
  })

  it('a real estate agent asking clients to review a listing, with a form', () => {
    expect(
      codes(
        page(
          text(
            'Please review your property listing and send us any feedback regarding your property.',
          ),
          field({ fieldName: 'name', label: 'Your name' }),
          field({ fieldName: 'notes', label: 'Changes to the listing' }),
          button('MLS listing', 'https://mls.example.org/listing/12'),
        ),
        { ownNames: ['Casa Realty'], ownDomains: ['casarealty.aglyn.app'] },
      ),
    ).toEqual([])
  })

  it('a site whose login is the platform’s own member sign-in element', () => {
    expect(
      codes(
        page(
          text('Members: sign in to see your classes.'),
          {
            componentId: 'member-signin',
            props: { title: 'Sign in', buttonLabel: 'Sign in' },
          },
          { componentId: 'cart', props: { checkoutLabel: 'Pay now' } },
        ),
        HOTEL,
      ),
    ).toEqual([])
  })

  it('ordinary codes in forms: promo, discount, ZIP', () => {
    expect(
      codes(
        page(
          field({ fieldName: 'promo', label: 'Promo code' }),
          field({ fieldName: 'discount', label: 'Discount code' }),
          field({ fieldName: 'zip', label: 'ZIP code' }),
          field({ fieldName: 'spin', label: 'Spin class time' }),
        ),
      ),
    ).toEqual([])
  })

  it('a shop that takes PayPal on PayPal’s own domain', () => {
    expect(
      codes(
        page(
          text('Pay with PayPal — log in to PayPal to finish.'),
          button('PayPal', 'https://www.paypal.me/harborview'),
        ),
        HOTEL,
      ),
    ).toEqual([])
  })
})

describe('isCredentialFieldName (the form endpoint)', () => {
  it.each([
    'password',
    'Password',
    'passwd',
    'pass',
    'card_number',
    'cardNumber',
    'cc-number',
    'cvv',
    'cvc',
    'otp',
    'one-time-code',
    'verification_code',
  ])('%s is a credential', (name) => {
    expect(isCredentialFieldName(name)).toBe(true)
  })

  it.each([
    'email',
    'name',
    'message',
    'promo_code',
    'zip',
    'company',
    'phone',
    'passenger',
    'spin',
  ])('%s is not', (name) => {
    expect(isCredentialFieldName(name)).toBe(false)
  })
})

describe('media embeds and a workspace’s own brand (2026-09-28 aglyn.com outage)', () => {
  const page = (href: string) => ({
    a: { componentId: 'muiTypography', props: { children: 'Watch the film' } },
    b: { componentId: 'muiButton', props: { children: 'Play', href } },
  })

  it.each([
    'https://harborview.wistia.com/medias/abc123',
    'https://fast.wistia.net/embed/iframe/abc123',
    'https://www.youtube.com/embed/xyz',
    'https://youtu.be/xyz',
    'https://player.vimeo.com/video/123',
    'https://www.loom.com/share/abc',
    'https://player.vimeo.com/video/paypal-promo',
  ])('never flags a video link or embed: %s', (href) => {
    expect(screenHostedPage({ nodes: page(href) }).signals).toEqual([])
  })

  it.each([
    'https://aglyn.wistia.com/medias/abc123',
    'https://aglyn.zendesk.com/hc',
  ])(
    'never flags a brand’s own site linking to its own account elsewhere: %s',
    (href) => {
      const verdict = screenHostedPage({
        nodes: page(href),
        ownNames: ['Aglyn'],
        ownDomains: ['aglyn.com'],
      })
      expect(verdict.signals).toEqual([])
    },
  )

  it('still flags a lookalike when the workspace only CALLS itself the brand', () => {
    const verdict = screenHostedPage({
      nodes: page('https://poshmark.id63835663.shop/o/1'),
      ownNames: ['Poshmark'],
      ownDomains: ['poshmark.aglyn.app'],
    })
    expect(verdict.signals).toEqual([
      expect.objectContaining({
        code: 'lookalike-link',
        host: 'poshmark.id63835663.shop',
      }),
    ])
  })
})
