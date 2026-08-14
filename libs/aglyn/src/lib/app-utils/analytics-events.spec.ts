/**
 * @jest-environment jsdom
 *
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
  ANALYTICS_EVENT_NAMES,
  buildBeginCheckoutParams,
  configureAnalyticsTransport,
  isFirstPublishedRoute,
  resetAnalyticsTransport,
  resetAuthoredEventWarnings,
  resolveAuthoredEventName,
  sanitizeEventParams,
  trackAuthoredEvent,
  trackEvent,
} from './analytics-events'

type GtagCall = [string, string, Record<string, unknown>]

function installGtag(): GtagCall[] {
  const calls: GtagCall[] = []
  ;(window as unknown as { gtag?: unknown }).gtag = (...args: unknown[]) => {
    calls.push(args as GtagCall)
  }
  return calls
}

function removeGtag(): void {
  delete (window as unknown as { gtag?: unknown }).gtag
}

describe('analytics-events (AGL-1561)', () => {
  afterEach(() => {
    resetAnalyticsTransport()
    removeGtag()
  })

  describe('trackEvent delivery', () => {
    it('fires the GA4 reserved name and params through window.gtag', () => {
      const calls = installGtag()

      trackEvent('sign_up', { method: 'google_popup' })

      expect(calls).toHaveLength(1)
      expect(calls[0][0]).toBe('event')
      expect(calls[0][1]).toBe('sign_up')
      expect(calls[0][2]).toEqual({ method: 'google_popup' })
    })

    it('prefers a configured transport over window.gtag, so the console keeps its Firebase user_id', () => {
      const calls = installGtag()
      const viaTransport: Array<[string, Record<string, unknown>]> = []
      configureAnalyticsTransport((name, params) =>
        viaTransport.push([name, params]),
      )

      trackEvent('login', { method: 'password' })

      expect(viaTransport).toEqual([['login', { method: 'password' }]])
      // The gtag pipe must not ALSO receive it — that would double-count.
      expect(calls).toHaveLength(0)
    })

    it('carries the full purchase payload GA4 needs to report revenue', () => {
      const calls = installGtag()

      trackEvent('purchase', {
        transaction_id: 'in_1ABC',
        currency: 'USD',
        value: 49,
        billing_interval: 'monthly',
        items: [
          {
            item_id: 'price_pro',
            item_name: 'Pro',
            item_category: 'subscription',
            price: 49,
            quantity: 1,
          },
        ],
      })

      expect(calls[0][2]).toEqual({
        transaction_id: 'in_1ABC',
        currency: 'USD',
        value: 49,
        billing_interval: 'monthly',
        items: [
          {
            item_id: 'price_pro',
            item_name: 'Pro',
            item_category: 'subscription',
            price: 49,
            quantity: 1,
          },
        ],
      })
    })

    it('never throws when the transport does — analytics cannot break the page', () => {
      configureAnalyticsTransport(() => {
        throw new Error('gtag exploded')
      })

      expect(() => trackEvent('host_created', {})).not.toThrow()
    })
  })

  describe('one begin_checkout shape across both surfaces (AGL-1591)', () => {
    // The bug: the console fired `begin_checkout` through `trackEvent` with
    // `currency`/`value`/`items`/`billing_interval`, and the tenant storefront
    // fired the SAME NAME raw with `value`/`currency` only. A breakdown on the
    // event therefore showed two populations that could not be compared, and
    // the storefront half was missing `items` — the field the GA4 ecommerce
    // funnel is built on. These assert the PAYLOAD each call site now delivers,
    // not that a function was reached.

    /** Exactly what `apps/console/.../billing/page.tsx` passes: one plan, and
     *  an annual price that is twelve months billed at once. */
    const consoleParams = () =>
      buildBeginCheckoutParams({
        billingInterval: 'annual',
        items: [
          {
            item_id: 'business',
            item_name: 'Business',
            item_category: 'subscription',
            price: 33 * 12,
            quantity: 1,
          },
        ],
      })

    /** Exactly what `libs/plugins/commerce/.../cart.tsx` passes: the cart's
     *  authoritative subtotal, and one item per cart line. */
    const cartParams = () =>
      buildBeginCheckoutParams({
        value: 5998 / 100,
        items: [
          {
            item_id: 'prod_mug',
            item_name: 'Enamel mug',
            price: 1999 / 100,
            quantity: 2,
          },
          {
            item_id: 'prod_tee',
            item_name: 'Logo tee',
            price: 2000 / 100,
            quantity: 1,
          },
        ],
      })

    it('delivers the same param set from the console and from a storefront cart', () => {
      const calls = installGtag()

      trackEvent('begin_checkout', consoleParams())
      trackEvent('begin_checkout', cartParams())

      const [consoleCall, cartCall] = calls
      expect(consoleCall[1]).toBe('begin_checkout')
      expect(cartCall[1]).toBe('begin_checkout')

      // The three params GA4's checkout funnel needs are present on BOTH, and
      // this is the assertion the issue is about: `items` used to be absent
      // from the storefront half entirely.
      for (const params of [consoleCall[2], cartCall[2]]) {
        expect(Object.keys(params)).toEqual(
          expect.arrayContaining(['currency', 'value', 'items']),
        )
        expect(typeof params['currency']).toBe('string')
        expect(typeof params['value']).toBe('number')
        expect(Array.isArray(params['items'])).toBe(true)
        for (const item of params['items'] as Record<string, unknown>[]) {
          expect(typeof item['item_id']).toBe('string')
          expect(typeof item['item_name']).toBe('string')
        }
      }

      // `billing_interval` is the ONE difference, and it is a real one rather
      // than drift: a storefront cart is not a subscription, so the param is
      // absent instead of carrying an invented value. It is optional in the
      // taxonomy precisely so that absence is expressible.
      expect(consoleCall[2]['billing_interval']).toBe('annual')
      expect(cartCall[2]).not.toHaveProperty('billing_interval')
    })

    it('states the full annual charge, not the per-month rate it is quoted at', () => {
      // The console's annual plans are priced "$33/mo billed yearly". The
      // checkout charges 396, and that is what the funnel must carry — this
      // used to be held together by a comment at the call site.
      expect(consoleParams()).toEqual({
        currency: 'USD',
        value: 396,
        billing_interval: 'annual',
        items: [
          {
            item_id: 'business',
            item_name: 'Business',
            item_category: 'subscription',
            price: 396,
            quantity: 1,
          },
        ],
      })
    })

    it('lets a cart state a subtotal that its line prices do not sum to', () => {
      // 19.99 x2 + 20.00 = 59.98, which the cart also states. But a coupon or
      // gift card moves the subtotal without moving the line prices, and the
      // subtotal is what the customer is charged.
      expect(cartParams().value).toBe(59.98)
      expect(
        buildBeginCheckoutParams({
          value: 49.98,
          items: cartParams().items,
        }).value,
      ).toBe(49.98)
    })

    it('derives value from the items when no caller states one', () => {
      expect(
        buildBeginCheckoutParams({
          items: [
            { item_id: 'a', item_name: 'A', price: 12.5, quantity: 2 },
            { item_id: 'b', item_name: 'B', price: 5, quantity: 1 },
          ],
        }).value,
      ).toBe(30)
    })

    it('rounds to two decimals rather than reporting a float artefact', () => {
      // 0.1 + 0.2 territory: three cents-derived prices whose float sum is
      // 59.99999999999999, which GA would report verbatim as a dimension.
      expect(
        buildBeginCheckoutParams({
          items: [
            { item_id: 'a', item_name: 'A', price: 19.99, quantity: 1 },
            { item_id: 'b', item_name: 'B', price: 20.01, quantity: 1 },
            { item_id: 'c', item_name: 'C', price: 19.99, quantity: 1 },
          ],
        }).value,
      ).toBe(59.99)
    })

    it('defaults an unstated currency rather than sending the event without one', () => {
      expect(buildBeginCheckoutParams({ items: [] }).currency).toBe('USD')
    })
  })

  describe('the four converted mirrors (AGL-1591)', () => {
    it('sends the commerce and site-runtime events through the sanitizer', () => {
      const calls = installGtag()

      trackEvent('view_item', {
        items: [{ item_id: 'prod_mug', item_name: 'Enamel mug' }],
      })
      trackEvent('add_to_cart', {
        items: [{ item_id: 'prod_mug', item_name: 'Enamel mug' }],
      })
      trackEvent('aglyn_overlay', {
        overlay_action: 'dismiss',
        overlay_id: 'bar_spring',
      })
      trackEvent('aglyn_experiment', {
        experiment_id: 'exp_hero',
        variant_id: 'b',
        experiment_action: 'exposure',
      })

      expect(calls.map((call) => call[1])).toEqual([
        'view_item',
        'add_to_cart',
        'aglyn_overlay',
        'aglyn_experiment',
      ])
      expect(calls[3][2]).toEqual({
        experiment_id: 'exp_hero',
        variant_id: 'b',
        experiment_action: 'exposure',
      })
    })

    it('reserves all four names against authored steps', () => {
      // The point of putting them in the union rather than through
      // `trackAuthoredEvent`: an authored `aglyn_experiment` would otherwise
      // add hits to the counts that decide which variant ships, and an
      // authored `add_to_cart` would land in a merchant's real funnel.
      for (const name of [
        'view_item',
        'add_to_cart',
        'aglyn_overlay',
        'aglyn_experiment',
      ]) {
        expect(ANALYTICS_EVENT_NAMES).toContain(name)
        expect(resolveAuthoredEventName(name)).toEqual({
          name: null,
          reason: 'reserved',
        })
      }
    })
  })

  describe('first_publish: what all four publish paths mean by "first" (AGL-1588)', () => {
    it('is true only when the host had no live route at all', () => {
      expect(isFirstPublishedRoute({})).toBe(true)
      expect(isFirstPublishedRoute({ 'screen-1': 'about' })).toBe(false)
    })

    it('treats a missing map as an unpublished site rather than throwing', () => {
      // The console reads `hostData?.screens`, which is undefined on a host
      // that has never published anything — the exact case the dimension is
      // for, so it must not be the case that fails.
      expect(isFirstPublishedRoute(undefined)).toBe(true)
      expect(isFirstPublishedRoute(null)).toBe(true)
    })

    it('says false for a SECOND page going live, which is a publish and not an activation', () => {
      // The distinction the dimension exists to draw: the event counts
      // publishes, `first_publish: true` counts sites that came alive. Read
      // the other way round, "% who publish a site" would count pages.
      expect(isFirstPublishedRoute({ 'screen-9': 'contact' })).toBe(false)
    })

    it('delivers false as a value, not as an absence', () => {
      const calls = installGtag()

      trackEvent('site_published', { first_publish: false })

      // The sanitizer drops undefined and null; a boolean false has to
      // survive, or the dimension degrades into a flag that is only ever
      // true and every republish looks like a missing measurement.
      expect(calls[0][2]).toEqual({ first_publish: false })
    })

    it('drops an undetermined first_publish instead of asserting false', () => {
      const calls = installGtag()

      trackEvent('site_published', { first_publish: undefined })

      expect(calls[0][2]).toEqual({})
    })
  })

  describe('the consent gate (AGL-1498): blocked means gone, not queued', () => {
    it('emits nothing at all when consent has not loaded gtag', () => {
      // No transport, no window.gtag — exactly the state of a tenant page
      // whose visitor has not granted analytics consent.
      expect(() => trackEvent('generate_lead', { form_name: 'Contact' })).not.toThrow()
      expect((window as unknown as { gtag?: unknown }).gtag).toBeUndefined()
    })

    it('does NOT replay a pre-consent event once a later grant loads gtag', () => {
      // Fire while blocked...
      trackEvent('generate_lead', { form_name: 'Contact' })
      trackEvent('sign_up', { method: 'password' })

      // ...then the visitor grants consent and gtag appears.
      const calls = installGtag()
      trackEvent('host_created', {})

      // Only the post-grant event exists. A queue that flushed here would
      // send hits carrying the pre-consent page and timestamp, which is the
      // precise thing the gate exists to prevent.
      expect(calls).toHaveLength(1)
      expect(calls[0][1]).toBe('host_created')
    })
  })

  describe('no PII reaches GA, ever', () => {
    it('drops identity-bearing param keys outright', () => {
      const safe = sanitizeEventParams({
        form_name: 'Contact',
        email: 'zach@aglyn.com',
        first_name: 'Zach',
        org_name: 'Aglyn LLC',
        phone: '+1 555 0100',
        ip_address: '203.0.113.4',
      })

      expect(safe).toEqual({ form_name: 'Contact' })
    })

    it('keeps the legitimate *_name params that merely resemble denied keys', () => {
      const safe = sanitizeEventParams({
        form_name: 'Contact',
        item_name: 'Pro',
        link_domain: 'github.com',
      })

      expect(safe).toEqual({
        form_name: 'Contact',
        item_name: 'Pro',
        link_domain: 'github.com',
      })
    })

    it('drops any value that merely LOOKS like an email, whatever its key', () => {
      const safe = sanitizeEventParams({
        form_name: 'Contact',
        content_id: 'someone@example.com',
      })

      expect(safe).toEqual({ form_name: 'Contact' })
    })

    it('scrubs URLs to origin + pathname so a query string cannot smuggle a token', () => {
      const safe = sanitizeEventParams({
        content_id: 'https://aglyn.com/pricing?email=zach@aglyn.com&token=secret',
      })

      expect(safe).toEqual({ content_id: 'https://aglyn.com/pricing' })
    })

    it('sanitizes items entries with the same rules', () => {
      const safe = sanitizeEventParams({
        items: [{ item_id: 'l1', item_name: 'Plugin', customer_name: 'Acme Inc' }],
      })

      expect(safe).toEqual({ items: [{ item_id: 'l1', item_name: 'Plugin' }] })
    })

    it('caps long strings rather than shipping an essay into a GA dimension', () => {
      const safe = sanitizeEventParams({ form_name: 'x'.repeat(500) })

      expect((safe.form_name as string).length).toBe(100)
    })

    it('drops undefined and null instead of sending empty dimensions', () => {
      const safe = sanitizeEventParams({
        form_name: 'Contact',
        form_location: undefined,
        content_id: null,
      })

      expect(safe).toEqual({ form_name: 'Contact' })
    })

    it('scrubs on the real trackEvent path, not only via the exported helper', () => {
      const calls = installGtag()

      trackEvent('generate_lead', {
        form_name: 'Contact',
        // @ts-expect-error deliberately smuggling a denied key past the types,
        // which is exactly how it would arrive from a careless call site.
        email: 'zach@aglyn.com',
      })

      expect(calls[0][2]).toEqual({ form_name: 'Contact' })
    })
  })

  describe('authored events (AGL-1587): the one untyped call site', () => {
    let warn: jest.SpyInstance

    beforeEach(() => {
      resetAuthoredEventWarnings()
      warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    })

    afterEach(() => {
      warn.mockRestore()
    })

    it('runs the PII sanitizer on author-supplied params', () => {
      const calls = installGtag()

      // Exactly the shape the issue describes: an author binds a form field
      // into the step's params and a customer's address heads for GA.
      trackAuthoredEvent('quote_requested', {
        plan: 'pro',
        email: 'zach@aglyn.com',
        contact: 'someone@example.com',
      })

      expect(calls).toHaveLength(1)
      expect(calls[0][1]).toBe('quote_requested')
      // The denied KEY is gone, and so is the email-shaped VALUE under an
      // innocent key — which is the half a denylist alone would miss.
      expect(calls[0][2]).toEqual({ plan: 'pro' })
    })

    it('reduces a URL param to origin + pathname, so the query string stays out', () => {
      const calls = installGtag()

      trackAuthoredEvent('doc_opened', {
        page: 'https://acme.com/thanks?email=buyer@acme.com&session=abc123',
      })

      expect(calls[0][2]).toEqual({ page: 'https://acme.com/thanks' })
    })

    it('caps a long authored value at the same 100 characters', () => {
      const calls = installGtag()

      trackAuthoredEvent('essay_submitted', { note: 'x'.repeat(500) })

      expect((calls[0][2].note as string).length).toBe(100)
    })

    it('refuses every name in our own taxonomy, so an authored hit cannot pollute a real metric', () => {
      const calls = installGtag()

      for (const name of ANALYTICS_EVENT_NAMES) {
        trackAuthoredEvent(name, { value: 999 })
      }

      // Nothing was sent at all — `purchase` in particular must never gain a
      // hand-authored row next to the Stripe-sourced revenue.
      expect(calls).toHaveLength(0)
      expect(ANALYTICS_EVENT_NAMES).toContain('purchase')
      expect(ANALYTICS_EVENT_NAMES).toContain('sign_up')
    })

    it('refuses GA4 reserved names and reserved prefixes', () => {
      const calls = installGtag()

      for (const name of [
        'session_start',
        'first_visit',
        'screen_view',
        'firebase_thing',
        'google_thing',
        'ga_thing',
      ]) {
        trackAuthoredEvent(name, {})
      }

      expect(calls).toHaveLength(0)
    })

    it('refuses a reserved name however it was typed', () => {
      const calls = installGtag()

      trackAuthoredEvent('  Purchase  ', { value: 1 })
      trackAuthoredEvent('Sign Up', { value: 1 })

      expect(calls).toHaveLength(0)
    })

    it('warns once per refused name rather than on every fire', () => {
      trackAuthoredEvent('purchase', {})
      trackAuthoredEvent('purchase', {})
      trackAuthoredEvent('purchase', {})

      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toMatch(/reserved/)
    })

    it('normalizes a human-typed name instead of letting GA drop it', () => {
      const calls = installGtag()

      trackAuthoredEvent('CTA Click!', {})

      expect(calls[0][1]).toBe('cta_click')
    })

    it('caps the name at GA4s 40 characters', () => {
      const calls = installGtag()

      trackAuthoredEvent('a'.repeat(80), {})

      expect((calls[0][1] as string).length).toBe(40)
    })

    it('refuses a name with nothing usable left in it', () => {
      const calls = installGtag()

      trackAuthoredEvent('123', {})
      trackAuthoredEvent('   ', {})
      trackAuthoredEvent(undefined, {})

      expect(calls).toHaveLength(0)
      expect(resolveAuthoredEventName('123').reason).toBe('unusable')
    })

    it('is consent-gated exactly like the taxonomy — no gtag, no event, no queue', () => {
      // No transport and no window.gtag: an ungranted visitor.
      expect(() => trackAuthoredEvent('cta_click', {})).not.toThrow()

      const calls = installGtag()
      trackAuthoredEvent('cta_click', {})

      expect(calls).toHaveLength(1)
    })

    it('sends nothing when the step carries no params at all', () => {
      const calls = installGtag()

      trackAuthoredEvent('cta_click')

      expect(calls[0][2]).toEqual({})
    })
  })
})
