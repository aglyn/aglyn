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
 * The chrome a system email is drawn inside, for each brand it can be sent
 * under (AGL-3322).
 *
 * Written in both directions, for the reason `platform-brand.spec.ts` gives:
 * a guard that only exercises the Aglyn default passes on a module that
 * ignores configuration entirely. So every renamed and white-label case
 * renders the WHOLE email — a real catalog template's built-in copy inside
 * the chrome — and asserts that Aglyn's name, host and address appear
 * nowhere in it, not merely that the other brand's appear somewhere.
 */

import { EMAIL_NODE_ROOT_ID, renderEmailHtml } from '@aglyn/shared-util-email/email-render'
import {
  buildDefaultEmailNodeMap,
  getSystemEmailTemplate,
} from '@aglyn/shared-util-email/system-email-catalog'

const ENV_KEYS = [
  'NEXT_PUBLIC_PLATFORM_BRAND_NAME',
  'NEXT_PUBLIC_PLATFORM_BRAND_LEGAL_NAME',
  'NEXT_PUBLIC_PLATFORM_SUPPORT_URL',
  'NEXT_PUBLIC_PLATFORM_HOME_URL',
  'NEXT_PUBLIC_PLATFORM_EMAIL_LOGO_URL',
  'NEXT_PUBLIC_PLATFORM_POSTAL_ADDRESS',
  'NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL',
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

type ChromeModule = typeof import('./system-email-chrome')
type EntitlementsModule = typeof import('./plan-entitlements')

/**
 * The chrome module and the brand resolver, re-imported under the given env
 * so every module-scope brand constant re-evaluates.
 */
function loadWith(env: Partial<Record<(typeof ENV_KEYS)[number], string>>): {
  chrome: ChromeModule
  entitlements: EntitlementsModule
} {
  for (const key of ENV_KEYS) delete process.env[key]
  for (const [key, value] of Object.entries(env)) process.env[key] = value
  jest.resetModules()
  return {
    chrome: require('./system-email-chrome') as ChromeModule,
    entitlements: require('./plan-entitlements') as EntitlementsModule,
  }
}

/** A clock stopped in a year no default could coincide with. */
const IN_2031 = () => new Date('2031-06-01T12:00:00Z')

const AGLYN_WORDMARK =
  'https://aglyn.com/api/media/cdn/org:jWmGooWE3L:aglyn-marketing/YwrD-IDzcf'
const AGLYN_ADDRESS =
  'c/o Northwest Registered Agent, LLC, 5900 Balcones Drive STE 100, Austin, TX 78731'

/**
 * The whole email a send would deliver: the template's built-in copy, its
 * subject tokens resolved from the same merge map, inside `chrome`.
 */
function renderDefault(
  key: string,
  merged: Record<string, string>,
  chrome: ReturnType<ChromeModule['buildSystemEmailChrome']>,
) {
  const definition = getSystemEmailTemplate(key)!
  return renderEmailHtml({
    nodes: buildDefaultEmailNodeMap(definition) as never,
    rootId: EMAIL_NODE_ROOT_ID,
    subject: definition.defaultSubject,
    merge: merged,
    sanitize: (html) => html,
    chrome,
  })
}

/** Every trace of the Aglyn-operated brand a renamed or white-label mail must lack. */
function expectNoAglyn(rendered: { html: string; text: string }) {
  for (const part of [rendered.html, rendered.text]) {
    expect(part).not.toMatch(/aglyn/i)
    expect(part).not.toContain('Balcones')
    expect(part).not.toContain('Northwest Registered Agent')
  }
}

describe('the platform brand, Aglyn-operated', () => {
  it('draws the wordmark linked home, and a footer with the legal line and address', () => {
    const { chrome } = loadWith({})
    const definition = getSystemEmailTemplate('password-reset')!
    const merged = { ...chrome.PLATFORM_BRAND_MERGE_TOKENS }
    const built = chrome.buildSystemEmailChrome({
      definition,
      merged,
      now: IN_2031,
    })

    expect(built.header).toEqual({
      logoUrl: AGLYN_WORDMARK,
      logoAlt: 'Aglyn',
      href: 'https://aglyn.com',
    })
    expect(built.footer).toEqual({
      reason: definition.footerReason,
      support: { label: 'Get help', href: 'https://app.aglyn.com/support' },
      legal: `© 2031 Aglyn LLC · ${AGLYN_ADDRESS}`,
    })

    const { html, text } = renderDefault('password-reset', merged, built)
    expect(html).toContain(`<a href="https://aglyn.com" target="_blank"`)
    expect(html).toContain(`src="${AGLYN_WORDMARK}" alt="Aglyn"`)
    expect(html).toContain(
      'You’re receiving this because someone asked to reset the password on your Aglyn account.',
    )
    expect(html).toContain(`© 2031 Aglyn LLC · ${AGLYN_ADDRESS}`)
    expect(text).toContain('Get help: https://app.aglyn.com/support')
    expect(text).toContain(`© 2031 Aglyn LLC · ${AGLYN_ADDRESS}`)
  })

  it('shows a mailto support URL as the mailbox', () => {
    const { chrome } = loadWith({
      NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL: 'help@example.test',
    })
    const built = chrome.buildSystemEmailChrome({
      definition: getSystemEmailTemplate('welcome')!,
      merged: { ...chrome.PLATFORM_BRAND_MERGE_TOKENS },
      now: IN_2031,
    })
    expect(built.footer?.support).toEqual({
      label: 'help@example.test',
      href: 'mailto:help@example.test',
    })
  })

  it('reads the copyright year from the clock it is given', () => {
    const { chrome } = loadWith({})
    const build = (now?: () => Date) =>
      chrome.buildSystemEmailChrome({
        definition: getSystemEmailTemplate('welcome')!,
        merged: { ...chrome.PLATFORM_BRAND_MERGE_TOKENS },
        now,
      }).footer?.legal
    expect(build(() => new Date('2029-12-31T23:59:59Z'))).toMatch(/^© 2029 /)
    expect(build(IN_2031)).toMatch(/^© 2031 /)
    // And the real clock when none is given.
    expect(build()).toMatch(new RegExp(`^© ${new Date().getUTCFullYear()} `))
  })

  it('treats an org without white-label as the platform, which is whose brand it resolves to', () => {
    const { chrome, entitlements } = loadWith({})
    const branding = entitlements.resolveBrandingProfile({
      plan: 'pro',
      brandingProfile: { productName: 'Ignored Without The Entitlement' },
    } as never)
    const built = chrome.buildSystemEmailChrome({
      definition: getSystemEmailTemplate('org-invite')!,
      merged: {
        ...chrome.PLATFORM_BRAND_MERGE_TOKENS,
        ...entitlements.brandMergeTokens(branding),
      },
      brandLogoUrl: branding.emailLogoUrl,
      brandHomeUrl: branding.homeUrl,
      now: IN_2031,
    })
    expect(built.header?.logoUrl).toBe(AGLYN_WORDMARK)
    expect(built.footer?.legal).toContain(AGLYN_ADDRESS)
  })
})

describe('the platform brand, renamed or self-hosted', () => {
  it('prints nothing of Aglyn: its name in bold, its own support desk, its legal name alone', () => {
    const { chrome } = loadWith({
      NEXT_PUBLIC_PLATFORM_BRAND_NAME: 'Foo',
      NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL: 'ops@foo.test',
    })
    const merged = {
      ...chrome.PLATFORM_BRAND_MERGE_TOKENS,
      'org.name': 'Test Org',
      'invite.role': 'editor',
      signInUrl: 'https://console.foo.test',
    }
    const built = chrome.buildSystemEmailChrome({
      definition: getSystemEmailTemplate('org-invite')!,
      merged,
      now: IN_2031,
    })

    // No logo configured and none of ours: the name, unlinked, since no home
    // page is configured either.
    expect(built.header).toEqual({ logoAlt: 'Foo' })
    expect(built.footer?.legal).toBe('© 2031 Foo LLC')
    expect(built.footer?.support).toEqual({
      label: 'ops@foo.test',
      href: 'mailto:ops@foo.test',
    })

    const rendered = renderDefault('org-invite', merged, built)
    expect(rendered.html).not.toContain('<img')
    expect(rendered.html).toContain('>Foo</div>')
    expect(rendered.html).toContain(
      'You’re receiving this because someone invited you to join Test Org on Foo.',
    )
    expectNoAglyn(rendered)
  })

  it('uses the logo, home page and address it is configured with', () => {
    const { chrome } = loadWith({
      NEXT_PUBLIC_PLATFORM_BRAND_NAME: 'Foo',
      NEXT_PUBLIC_PLATFORM_BRAND_LEGAL_NAME: 'Foo GmbH',
      NEXT_PUBLIC_PLATFORM_SUPPORT_URL: 'https://help.foo.test',
      NEXT_PUBLIC_PLATFORM_HOME_URL: 'https://foo.test',
      NEXT_PUBLIC_PLATFORM_EMAIL_LOGO_URL: 'https://cdn.foo.test/foo-wordmark.png',
      NEXT_PUBLIC_PLATFORM_POSTAL_ADDRESS: '1 Foo Way\n  10115 Berlin  ',
    })
    const merged = { ...chrome.PLATFORM_BRAND_MERGE_TOKENS }
    const built = chrome.buildSystemEmailChrome({
      definition: getSystemEmailTemplate('security-new-device')!,
      merged,
      now: IN_2031,
    })
    expect(built.header).toEqual({
      logoUrl: 'https://cdn.foo.test/foo-wordmark.png',
      logoAlt: 'Foo',
      href: 'https://foo.test',
    })
    // The configured lines fold into the one line the footer prints.
    expect(built.footer?.legal).toBe('© 2031 Foo GmbH · 1 Foo Way, 10115 Berlin')
    expect(built.footer?.support).toEqual({
      label: 'Get help',
      href: 'https://help.foo.test',
    })

    const rendered = renderDefault('security-new-device', merged, built)
    expect(rendered.html).toContain(
      '<a href="https://foo.test" target="_blank" style="text-decoration:none;"><img src="https://cdn.foo.test/foo-wordmark.png" alt="Foo"',
    )
    expect(rendered.text).toContain('© 2031 Foo GmbH · 1 Foo Way, 10115 Berlin')
    expectNoAglyn(rendered)
  })

  it('ignores a logo that is not an absolute https URL, since an inbox has no origin', () => {
    for (const logo of ['/_static/images/brand/foo.png', 'http://cdn.foo.test/foo.png', 'not a url']) {
      const { chrome } = loadWith({
        NEXT_PUBLIC_PLATFORM_BRAND_NAME: 'Foo',
        NEXT_PUBLIC_PLATFORM_EMAIL_LOGO_URL: logo,
      })
      const built = chrome.buildSystemEmailChrome({
        definition: getSystemEmailTemplate('welcome')!,
        merged: { ...chrome.PLATFORM_BRAND_MERGE_TOKENS },
      })
      expect(built.header?.logoUrl).toBeUndefined()
      expect(built.header?.logoAlt).toBe('Foo')
    }
  })
})

describe('a white-label send', () => {
  const AGENCY = {
    productName: 'Acme Sites',
    emailLogoUrl: 'https://cdn.acme.test/acme-logo.png',
    supportUrl: 'https://acme.test/help',
  }

  function agencySend(
    brandingProfile: Record<string, string>,
    key = 'org-invite',
  ) {
    const { chrome, entitlements } = loadWith({})
    const branding = entitlements.resolveBrandingProfile({
      plan: 'agency',
      brandingProfile,
    } as never)
    const merged = {
      ...chrome.PLATFORM_BRAND_MERGE_TOKENS,
      ...entitlements.brandMergeTokens(branding),
      'org.name': 'Client Co',
      'invite.role': 'editor',
      signInUrl: 'https://console.acme.test',
    }
    const built = chrome.buildSystemEmailChrome({
      definition: getSystemEmailTemplate(key)!,
      merged,
      brandLogoUrl: branding.emailLogoUrl,
      brandHomeUrl: branding.homeUrl,
      now: IN_2031,
    })
    return { built, rendered: renderDefault(key, merged, built) }
  }

  it('draws the agency’s logo and name, and no legal line naming the platform', () => {
    const { built, rendered } = agencySend(AGENCY)
    expect(built.header).toEqual({
      logoUrl: AGENCY.emailLogoUrl,
      logoAlt: 'Acme Sites',
      href: 'https://acme.test/help',
    })
    expect(built.footer?.legal).toBeUndefined()
    expect(built.footer?.support).toEqual({
      label: 'Get help',
      href: 'https://acme.test/help',
    })

    expect(rendered.html).toContain(`src="${AGENCY.emailLogoUrl}" alt="Acme Sites"`)
    expect(rendered.html).toContain(
      'You’re receiving this because someone invited you to join Client Co on Acme Sites.',
    )
    expect(rendered.html).not.toContain('©')
    expectNoAglyn(rendered)
  })

  it('draws the agency’s name when it set no email logo, and no support line when it set no URL', () => {
    const { built, rendered } = agencySend({ productName: 'Acme Sites' })
    expect(built.header).toEqual({ logoAlt: 'Acme Sites' })
    expect(built.footer).toEqual({ reason: getSystemEmailTemplate('org-invite')!.footerReason })
    expect(rendered.html).not.toContain('<img')
    expect(rendered.html).toContain('>Acme Sites</div>')
    expect(rendered.text).not.toContain('Get help')
    expectNoAglyn(rendered)
  })

  it('links the header only to a web page, never to a mailbox', () => {
    const { built } = agencySend({
      ...AGENCY,
      supportUrl: 'mailto:help@acme.test',
    })
    expect(built.header?.href).toBeUndefined()
    // The mailbox is still the footer's support line, as the address.
    expect(built.footer?.support).toEqual({
      label: 'help@acme.test',
      href: 'mailto:help@acme.test',
    })
  })

  it('names the agency in every reason that names the product, the usage summary’s too', () => {
    const { rendered } = agencySend(AGENCY, 'usage-summary')
    expect(rendered.html).toContain(
      'You’re receiving this monthly summary because you manage Client Co on Acme Sites.',
    )
    expectNoAglyn(rendered)
  })
})
