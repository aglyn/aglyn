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
  isMachinePluginApiPath,
  VISITOR_WRITE_RATE_LIMIT,
  VISITOR_WRITE_RATE_WINDOW_MS,
  visitorWriteRateLimitKey,
} from './plugin-api-rate-limit'

describe('visitor-write rate-limit policy (AGL-1770)', () => {
  describe('isMachinePluginApiPath', () => {
    it('exempts every credentialed machine surface on the tenant dispatcher', () => {
      // Each of these authenticates with a secret, a webhook signature or a
      // console session, and its volume is set by campaign size or a cron
      // schedule rather than by a human — no shopper-sized ceiling fits.
      expect(isMachinePluginApiPath('email/events')).toBe(true)
      expect(isMachinePluginApiPath('campaigns/send')).toBe(true)
      expect(isMachinePluginApiPath('bookings/reminders')).toBe(true)
      expect(isMachinePluginApiPath('hooks/host-1/hook-1')).toBe(true)
    })

    it('limits every unauthenticated visitor write registered on the surface', () => {
      // Enumerated from `registerCommerceApi` / the other tenant-surface
      // registrations rather than sampled, so a future exemption that is too
      // broad — `commerce/` say, or a bare `email/` prefix — is caught here
      // rather than in production.
      for (const path of [
        'commerce/cart',
        'commerce/cart-checkout',
        'commerce/checkout',
        'commerce/newsletter',
        'commerce/notify-restock',
        'commerce/reserve',
        'commerce/reviews',
        'commerce/stream',
        'commerce/gate',
        'membership/login',
        'membership/register',
        'membership/recover',
        'membership/reset',
        'membership/wishlist',
        'bookings/book',
        'events/dispatch',
        'experiments/track',
        'email/unsubscribe',
      ]) {
        expect(isMachinePluginApiPath(path)).toBe(false)
      }
    })

    it('defaults an unknown path to VISITOR, so a new endpoint is covered by doing nothing', () => {
      // The whole polarity argument for keeping a path list at all. Forgetting
      // to add a new visitor endpoint must fail safe; only forgetting a
      // machine one may fail, and that one fails loudly as 429s.
      expect(isMachinePluginApiPath('someplugin/brand-new-write')).toBe(false)
      expect(isMachinePluginApiPath('')).toBe(false)
    })

    it('matches the dispatcher path shape with or without slashes', () => {
      expect(isMachinePluginApiPath('/email/events')).toBe(true)
      expect(isMachinePluginApiPath('email/events/')).toBe(true)
      expect(isMachinePluginApiPath('/hooks/host-1/hook-1')).toBe(true)
    })

    it('does not exempt a path that merely starts with an exempt name', () => {
      // `hooks/` is a prefix on purpose (`hooks/{hostId}/{hookId}`); the
      // set members are not, so a sibling route cannot inherit the exemption.
      expect(isMachinePluginApiPath('email/events-export')).toBe(false)
      expect(isMachinePluginApiPath('campaigns/send-test')).toBe(false)
      expect(isMachinePluginApiPath('bookings/reminders-preview')).toBe(false)
      expect(isMachinePluginApiPath('hooksy/host-1')).toBe(false)
    })
  })

  describe('visitorWriteRateLimitKey', () => {
    it('separates sites, so one site cannot spend another site’s budget', () => {
      expect(visitorWriteRateLimitKey('host-a', '1.2.3.4')).not.toBe(
        visitorWriteRateLimitKey('host-b', '1.2.3.4'),
      )
    })

    it('separates callers, so an attacker cannot lock a merchant’s shoppers out', () => {
      // The reason per-site-alone was rejected: a shared site bucket turns
      // one attacker into a denial of service against the victim's sales.
      expect(visitorWriteRateLimitKey('host-a', '1.2.3.4')).not.toBe(
        visitorWriteRateLimitKey('host-a', '5.6.7.8'),
      )
    })

    it('gives host-less writes a real bucket rather than no key at all', () => {
      // AGL-1769 named "an unresolvable hostId skips the gate" as the hole.
      // A caller that declines to name a site must still be counted.
      const key = visitorWriteRateLimitKey('', '1.2.3.4')
      expect(key).toContain('1.2.3.4')
      expect(visitorWriteRateLimitKey('', '5.6.7.8')).not.toBe(key)
    })

    it('shares one budget across paths, so cycling endpoints cannot multiply it', () => {
      // The key takes no path argument by construction; this pins the intent
      // so adding one later is a deliberate act rather than a tidy-up.
      expect(visitorWriteRateLimitKey.length).toBe(2)
    })
  })

  it('states the published ceiling and window', () => {
    expect(VISITOR_WRITE_RATE_LIMIT).toBe(120)
    expect(VISITOR_WRITE_RATE_WINDOW_MS).toBe(60_000)
  })
})
