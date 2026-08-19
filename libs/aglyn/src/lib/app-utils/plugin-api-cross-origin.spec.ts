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

/**
 * AGL-1880. The case that matters is `sibling tenant on the shared apex`:
 * `SameSite=Lax` permits it, so if this predicate ever returns `false` there,
 * the member-account write is reachable by cross-site request forgery again.
 */
import {
  CROSS_ORIGIN_REFUSED_STATUS,
  crossOriginPluginWriteRefusal,
  isCrossOriginPluginWrite,
} from './plugin-api-cross-origin'

/** Minimal stand-in for the parts of `Request` the guard reads. */
function req(
  method: string,
  headers: Record<string, string | null> = {},
): { method: string; headers: { get: (name: string) => string | null } } {
  const lower: Record<string, string | null> = {}
  for (const [key, value] of Object.entries(headers)) {
    lower[key.toLowerCase()] = value
  }
  return {
    method,
    headers: {
      get: (name: string) =>
        Object.prototype.hasOwnProperty.call(lower, name.toLowerCase())
          ? lower[name.toLowerCase()]
          : null,
    },
  }
}

describe('isCrossOriginPluginWrite', () => {
  it('REFUSES the sibling-subdomain member write that SameSite=Lax permits', () => {
    // evil.aglyn.app and victim.aglyn.app are same-SITE, so the browser sends
    // `aglyn_member_victim`. This is the whole reason the guard exists.
    expect(
      isCrossOriginPluginWrite({
        path: 'membership/account',
        request: req('POST', {
          origin: 'https://evil.aglyn.app',
          host: 'victim.aglyn.app',
        }),
      }),
    ).toBe(true)
  })

  it('refuses a cross-origin cart write', () => {
    expect(
      isCrossOriginPluginWrite({
        path: 'commerce/cart',
        request: req('POST', {
          origin: 'https://evil.example.com',
          host: 'shop.aglyn.app',
        }),
      }),
    ).toBe(true)
  })

  it('allows the storefront calling its own origin', () => {
    expect(
      isCrossOriginPluginWrite({
        path: 'commerce/cart',
        request: req('POST', {
          origin: 'https://shop.aglyn.app',
          host: 'shop.aglyn.app',
        }),
      }),
    ).toBe(false)
  })

  it('allows a merchant custom domain calling itself', () => {
    expect(
      isCrossOriginPluginWrite({
        path: 'membership/wishlist',
        request: req('POST', {
          origin: 'https://shop.northwind.com',
          host: 'shop.northwind.com',
        }),
      }),
    ).toBe(false)
  })

  it('prefers x-forwarded-host over host behind the proxy', () => {
    expect(
      isCrossOriginPluginWrite({
        path: 'commerce/cart',
        request: req('POST', {
          origin: 'https://shop.aglyn.app',
          'x-forwarded-host': 'shop.aglyn.app',
          host: 'internal-lb.vercel.internal',
        }),
      }),
    ).toBe(false)
  })

  it('allows a request with NO Origin header (non-browser caller)', () => {
    expect(
      isCrossOriginPluginWrite({
        path: 'commerce/cart',
        request: req('POST', { host: 'shop.aglyn.app' }),
      }),
    ).toBe(false)
  })

  it('refuses the opaque origin, which is how a redirect laundering attempt arrives', () => {
    expect(
      isCrossOriginPluginWrite({
        path: 'membership/account',
        request: req('POST', { origin: 'null', host: 'victim.aglyn.app' }),
      }),
    ).toBe(true)
  })

  it('refuses an unparsable Origin rather than treating it as same-origin', () => {
    expect(
      isCrossOriginPluginWrite({
        path: 'membership/account',
        request: req('POST', {
          origin: 'not-a-url',
          host: 'victim.aglyn.app',
        }),
      }),
    ).toBe(true)
  })

  it('ignores case differences in host and origin', () => {
    expect(
      isCrossOriginPluginWrite({
        path: 'commerce/cart',
        request: req('POST', {
          origin: 'https://Shop.Aglyn.App',
          host: 'shop.aglyn.app',
        }),
      }),
    ).toBe(false)
  })

  it('treats a differing PORT as a different origin', () => {
    expect(
      isCrossOriginPluginWrite({
        path: 'commerce/cart',
        request: req('POST', {
          origin: 'http://localhost:4300',
          host: 'localhost:4200',
        }),
      }),
    ).toBe(true)
  })

  describe('deliberate exemptions', () => {
    it.each(['GET', 'HEAD', 'OPTIONS'])(
      'leaves a cross-origin %s read alone',
      (method) => {
        expect(
          isCrossOriginPluginWrite({
            path: 'commerce/gate',
            request: req(method, {
              origin: 'https://app.aglyn.com',
              host: 'shop.aglyn.app',
            }),
          }),
        ).toBe(false)
      },
    )

    it.each(['email/events', 'campaigns/send', 'bookings/reminders'])(
      'leaves the credentialed machine path %s alone',
      (path) => {
        expect(
          isCrossOriginPluginWrite({
            path,
            request: req('POST', {
              origin: 'https://hooks.resend.com',
              host: 'shop.aglyn.app',
            }),
          }),
        ).toBe(false)
      },
    )

    it('leaves the hooks/ subtree alone', () => {
      expect(
        isCrossOriginPluginWrite({
          path: 'hooks/shop/inventory',
          request: req('POST', {
            origin: 'https://erp.northwind.com',
            host: 'shop.aglyn.app',
          }),
        }),
      ).toBe(false)
    })

    it('allows the write when there is no Host to compare against', () => {
      expect(
        isCrossOriginPluginWrite({
          path: 'commerce/cart',
          request: req('POST', { origin: 'https://evil.aglyn.app' }),
        }),
      ).toBe(false)
    })
  })
})

describe('crossOriginPluginWriteRefusal', () => {
  it('returns null for a same-origin write so the dispatcher carries on', () => {
    expect(
      crossOriginPluginWriteRefusal({
        path: 'commerce/cart',
        request: req('POST', {
          origin: 'https://shop.aglyn.app',
          host: 'shop.aglyn.app',
        }),
      }),
    ).toBeNull()
  })

  it('returns a 403 naming the reason', async () => {
    const response = crossOriginPluginWriteRefusal({
      path: 'membership/account',
      request: req('POST', {
        origin: 'https://evil.aglyn.app',
        host: 'victim.aglyn.app',
      }),
    })
    expect(response).not.toBeNull()
    expect(response?.status).toBe(CROSS_ORIGIN_REFUSED_STATUS)
    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toEqual({
      error: 'Cross-origin writes are not allowed.',
    })
  })
})
