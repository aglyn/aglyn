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

import { isCredentialFieldName, screenHostedPage } from './hosted-page-screen'
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
    expect(verdict.signals).toEqual([
      expect.objectContaining({ code: 'brand-action-page', brand: 'docusign' }),
    ])
    // Soft: a young workspace's page holds, an established one's does not.
    expect(signalsThatHold(verdict.signals, { ageDays: 2 })).toHaveLength(1)
    expect(signalsThatHold(verdict.signals, { ageDays: 60 })).toHaveLength(0)
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
