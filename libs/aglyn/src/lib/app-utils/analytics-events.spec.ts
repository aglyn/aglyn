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
  configureAnalyticsTransport,
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
