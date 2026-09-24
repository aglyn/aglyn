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
 * The platform brand is configuration (AGL-2153).
 *
 * Written in both directions throughout, for the reason
 * `operator-identity.spec.ts` sets out: a guard that only exercises the
 * default passes on a module that ignores configuration entirely. Every
 * SELF-HOST assertion below therefore also asserts that our name is GONE, not
 * merely that theirs is present — a module that concatenated both would
 * satisfy the weaker check.
 */

const ENV_KEYS = [
  'NEXT_PUBLIC_PLATFORM_BRAND_NAME',
  'NEXT_PUBLIC_PLATFORM_BRAND_LEGAL_NAME',
  'NEXT_PUBLIC_PLATFORM_SUPPORT_URL',
  'NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL',
  'NEXT_PUBLIC_PLATFORM_EMAIL_LOGO_URL',
  'NEXT_PUBLIC_PLATFORM_POSTAL_ADDRESS',
] as const

const ORIGINAL = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
)

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  jest.resetModules()
})

/** Re-import under the given env so the module-scope constants re-evaluate. */
/*
 * A spec whose subject is reached only through `await import()` has no static
 * import, so it is a script and every top-level binding in it is a global.
 * This marks it as a module, which keeps `loadWith` below from colliding with
 * the identically-named loader in the sibling env-mutating specs.
 */
export {}

function loadWith(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) delete process.env[key]
  for (const [key, value] of Object.entries(env)) process.env[key] = value
  jest.resetModules()
  return require('./platform-brand') as typeof import('./platform-brand')
}

describe('PLATFORM_BRAND_NAME', () => {
  it('SELF-HOST shape: the operator name replaces ours entirely', () => {
    const brand = loadWith({ NEXT_PUBLIC_PLATFORM_BRAND_NAME: 'Northwind' })
    expect(brand.PLATFORM_BRAND_NAME).toBe('Northwind')
    expect(brand.isAglynOperatedBrand()).toBe(false)
  })

  it('AGLYN-OPERATED shape: unset is our own brand, unchanged', () => {
    const brand = loadWith({})
    expect(brand.PLATFORM_BRAND_NAME).toBe('Aglyn')
    expect(brand.isAglynOperatedBrand()).toBe(true)
  })

  it('treats a whitespace-only value as absent', () => {
    // The shape a half-finished .env actually takes, and it satisfies a
    // truthiness check — so a browser tab would read "· " with nothing after.
    expect(loadWith({ NEXT_PUBLIC_PLATFORM_BRAND_NAME: '   ' })
      .PLATFORM_BRAND_NAME).toBe('Aglyn')
  })
})

describe('PLATFORM_BRAND_LEGAL_NAME', () => {
  it('derives from the product name when not separately configured', () => {
    // An operator who sets only the brand still gets a coherent legal string
    // rather than "Aglyn LLC" under a product called something else.
    expect(
      loadWith({ NEXT_PUBLIC_PLATFORM_BRAND_NAME: 'Northwind' })
        .PLATFORM_BRAND_LEGAL_NAME,
    ).toBe('Northwind LLC')
  })

  it('takes an explicit legal name over the derived one', () => {
    // "LLC" is a US form; an operator elsewhere is not one.
    expect(
      loadWith({
        NEXT_PUBLIC_PLATFORM_BRAND_NAME: 'Northwind',
        NEXT_PUBLIC_PLATFORM_BRAND_LEGAL_NAME: 'Northwind GmbH',
      }).PLATFORM_BRAND_LEGAL_NAME,
    ).toBe('Northwind GmbH')
  })

  it('AGLYN-OPERATED shape: unset is still our own entity', () => {
    expect(loadWith({}).PLATFORM_BRAND_LEGAL_NAME).toBe('Aglyn LLC')
  })
})

describe('PLATFORM_SUPPORT_URL falls through the operator before us', () => {
  it('prefers an explicitly configured support URL', () => {
    expect(
      loadWith({
        NEXT_PUBLIC_PLATFORM_SUPPORT_URL: 'https://help.example.com',
        NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL: 'ops@example.com',
      }).PLATFORM_SUPPORT_URL,
    ).toBe('https://help.example.com')
  })

  it('uses the operator support mailbox when no URL is configured', () => {
    // The point of the fallback: an operator who followed the runbook has
    // already set this, and should not have to discover a second variable to
    // stop pointing their customers at a support desk that cannot help them.
    const brand = loadWith({
      NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL: 'ops@example.com',
    })
    expect(brand.PLATFORM_SUPPORT_URL).toBe('mailto:ops@example.com')
    expect(brand.PLATFORM_SUPPORT_URL).not.toContain('aglyn.com')
  })

  it('AGLYN-OPERATED shape: wholly unconfigured is our support page', () => {
    // The CONSOLE's support entry, not the marketing site's: `/support` there
    // has never existed and answers 404 (AGL-3262), and this value is printed
    // on a receipt beside a charge the reader is already unsure about. The
    // console page resolves the workspace from the session (AGL-3265), which
    // is what lets one static URL be right for every customer.
    expect(loadWith({}).PLATFORM_SUPPORT_URL).toBe(
      'https://app.aglyn.com/support',
    )
  })

  it('points at a path the console actually routes, not a plausible one', () => {
    // How the old value rotted: nothing here knew whether `/support` existed,
    // so a URL that had never resolved sat in system email footers and on
    // Stripe receipts until somebody opened it. Tying the literal to the route
    // table does not prove the page is deployed, but it does mean a route that
    // MOVES fails here instead of going quiet.
    const { Route } = require('./console-routes') as typeof import('./console-routes')
    const url = new URL(loadWith({}).PLATFORM_SUPPORT_URL)
    expect(url.pathname).toBe(Route.SUPPORT_ENTRY)
    // Anti-vacuity, both halves: a route table that lost the entry would leave
    // `pathname` comparing against `undefined`, and the origin is the other
    // half of the claim.
    expect(Route.SUPPORT_ENTRY).toBe('/support')
    expect(url.origin).toBe('https://app.aglyn.com')
  })
})

/**
 * What the platform's own system email is drawn with (AGL-3322). Both default
 * only while this is the Aglyn-operated brand: a renamed deployment's mail
 * must never open with our logo or close with our address.
 */
describe('PLATFORM_EMAIL_LOGO_URL', () => {
  it('AGLYN-OPERATED shape: unset is our wordmark, at an absolute https URL', () => {
    const logo = loadWith({}).PLATFORM_EMAIL_LOGO_URL
    // An inbox has no origin to resolve a relative path against.
    expect(logo).toMatch(/^https:\/\/aglyn\.com\/api\/media\/cdn\//)
  })

  it('SELF-HOST shape: renamed and unset is null, never ours', () => {
    expect(
      loadWith({ NEXT_PUBLIC_PLATFORM_BRAND_NAME: 'Northwind' })
        .PLATFORM_EMAIL_LOGO_URL,
    ).toBeNull()
  })

  it('takes a configured https URL on either brand', () => {
    const logo = 'https://cdn.northwind.test/wordmark.png'
    expect(
      loadWith({
        NEXT_PUBLIC_PLATFORM_BRAND_NAME: 'Northwind',
        NEXT_PUBLIC_PLATFORM_EMAIL_LOGO_URL: logo,
      }).PLATFORM_EMAIL_LOGO_URL,
    ).toBe(logo)
    expect(
      loadWith({ NEXT_PUBLIC_PLATFORM_EMAIL_LOGO_URL: logo })
        .PLATFORM_EMAIL_LOGO_URL,
    ).toBe(logo)
  })

  it('ignores a value that is not an absolute https URL', () => {
    for (const value of ['/_static/logo.png', 'http://cdn.northwind.test/a.png', '   ']) {
      expect(
        loadWith({
          NEXT_PUBLIC_PLATFORM_BRAND_NAME: 'Northwind',
          NEXT_PUBLIC_PLATFORM_EMAIL_LOGO_URL: value,
        }).PLATFORM_EMAIL_LOGO_URL,
      ).toBeNull()
    }
  })

  it('is not the platform profile’s email logo, which a white-label org would inherit', () => {
    expect(loadWith({}).PLATFORM_BRANDING_PROFILE.emailLogoUrl).toBeNull()
  })
})

describe('PLATFORM_POSTAL_ADDRESS', () => {
  it('AGLYN-OPERATED shape: unset is the registered agent’s address', () => {
    expect(loadWith({}).PLATFORM_POSTAL_ADDRESS).toBe(
      'c/o Northwest Registered Agent, LLC, 5900 Balcones Drive STE 100, Austin, TX 78731',
    )
  })

  it('SELF-HOST shape: renamed and unset is null, never ours', () => {
    expect(
      loadWith({ NEXT_PUBLIC_PLATFORM_BRAND_NAME: 'Northwind' })
        .PLATFORM_POSTAL_ADDRESS,
    ).toBeNull()
  })

  it('takes a configured address, its line breaks folded onto one line', () => {
    expect(
      loadWith({
        NEXT_PUBLIC_PLATFORM_BRAND_NAME: 'Northwind',
        NEXT_PUBLIC_PLATFORM_POSTAL_ADDRESS: ' 100 Example Ave\nSuite 200 \n\n Springfield, IL 62701 ',
      }).PLATFORM_POSTAL_ADDRESS,
    ).toBe('100 Example Ave, Suite 200, Springfield, IL 62701')
  })
})

describe('the resolver default is built from the configured brand', () => {
  it('SELF-HOST shape: every non-white-label surface resolves to their name', () => {
    // The reach of this issue in one assertion: resolveBrandingProfile is the
    // single resolver every branded surface routes through, and this is its
    // fallback — so console chrome, the published-site badge and title, and
    // transactional email all follow from here without further wiring.
    process.env.NEXT_PUBLIC_PLATFORM_BRAND_NAME = 'Northwind'
    process.env.NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL = 'ops@example.com'
    jest.resetModules()
    const entitlements =
      require('./plan-entitlements') as typeof import('./plan-entitlements')

    expect(entitlements.PLATFORM_BRANDING_PROFILE.productName).toBe('Northwind')
    expect(entitlements.PLATFORM_BRANDING_PROFILE.fromName).toBe('Northwind')
    expect(entitlements.PLATFORM_BRANDING_PROFILE.supportUrl).toBe(
      'mailto:ops@example.com',
    )
    // The generator tag and x-powered-by header on every published site.
    expect(entitlements.PLATFORM_GENERATOR_NAME).toBe('Northwind')

    // An org with no white-label entitlement resolves to the platform brand,
    // which is now theirs — this is the path a self-host install always takes.
    const resolved = entitlements.resolveBrandingProfile({ plan: 'free' } as never)
    expect(resolved.productName).toBe('Northwind')
    expect(JSON.stringify(resolved)).not.toContain('Aglyn')
  })
})
