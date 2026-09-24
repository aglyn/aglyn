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
  brandMergeTokens,
  CANVAS_ROOT_ELEMENT_ID,
  PLATFORM_BRANDING_PROFILE,
  resolveBrandingProfile,
} from '@aglyn/aglyn'
import { compress } from '@aglyn/aglyn/app-utils/compress'
import { EMAIL_NODE_ROOT_ID } from '@aglyn/shared-util-email'
import {
  isPlatformBrandedSend,
  loadSystemEmail,
  renderEffectiveSystemEmail,
  renderLoadedSystemEmail,
  renderSystemEmail,
} from '../app/api/_lib/render-system-email'

const mockGet = jest.fn()
const mockVersionGet = jest.fn()
/** `hosts/{hostId}/components/{componentId}`, by host and component id. */
const mockComponentGet = jest.fn()
/** The marketing site the deployment names; null when it names none. */
const mockPlatformHost = jest.fn((): string | null => null)

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        // The template and its versions, and the one other path this module
        // reads: a site's published components (AGL-3318).
        collection: (name: string) => ({
          doc: (id: string) =>
            name === 'hosts'
              ? {
                  collection: () => ({
                    doc: (componentId: string) => ({
                      get: () => mockComponentGet(id, componentId),
                    }),
                  }),
                }
              : {
                  get: mockGet,
                  collection: () => ({ doc: () => ({ get: mockVersionGet }) }),
                },
        }),
      }),
    }),
  },
}))

jest.mock('@aglyn/tenant-data-admin/server/platform-marketing-consent', () => ({
  platformMarketingHostId: () => mockPlatformHost(),
}))

/** A Firestore-ish snapshot over a plain object. */
function snapshot(data: Record<string, unknown> | null) {
  return {
    exists: data !== null,
    get: (field: string) => data?.[field],
  }
}

/** What the platform's own chrome draws on this (Aglyn-operated) deployment. */
const AGLYN_WORDMARK =
  'https://aglyn.com/api/media/cdn/org:jWmGooWE3L:aglyn-marketing/YwrD-IDzcf'
const AGLYN_LEGAL = `© ${new Date().getUTCFullYear()} Aglyn LLC · c/o Northwest Registered Agent, LLC, 5900 Balcones Drive STE 100, Austin, TX 78731`
const INVITE_REASON =
  'You’re receiving this because someone invited you to join Test Org on Aglyn.'

describe('renderSystemEmail', () => {
  const NODES = {
    // The besigner roots its node map at CANVAS_ROOT_ELEMENT_ID ('_@_'), not
    // 'root'. The fixture used 'root' and so never exercised the real data
    // shape — which is how AGL-765 (renderSystemEmail rendering empty) shipped.
    '_@_': { $id: '_@_', componentId: 'div', nodes: ['t1'] },
    t1: {
      $id: 't1',
      componentId: 'emailText',
      pluginId: 'email',
      parentId: '_@_',
      props: { children: 'Hello {{org.name}}', variant: 'body' },
    },
  }

  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  /**
   * Null means "nothing here sends this", and only a key the platform does
   * not compose itself gets it: the caller then uses its own copy alone.
   */
  describe('renders nothing for a key it does not send', () => {
    it('when the template key is not in the catalog', async () => {
      expect(await renderSystemEmail('not-a-real-template')).toBeNull()
      expect(mockGet).not.toHaveBeenCalled()
    })

    it('when the email is delivered by Stripe, not us', async () => {
      // Rendering these would produce output nothing ever sends (AGL-767).
      // `password-reset` and `email-verification` used to be the examples
      // here; AGL-1112 moved them to Resend, so they now belong to the test
      // below instead.
      expect(await renderSystemEmail('stripe-receipt')).toBeNull()
      expect(await renderSystemEmail('stripe-invoice')).toBeNull()
      expect(mockGet).not.toHaveBeenCalled()
    })

    it('but DOES reach Firestore for the auth emails now (AGL-1112)', async () => {
      // The inverse of the assertion this replaced, and the one that would
      // have caught a half-done takeover: flipping the catalog to 'resend'
      // without the routes, or shipping the routes while the renderer still
      // short-circuits, both leave staff an editor that does nothing.
      mockGet.mockResolvedValue(snapshot(null))
      await renderSystemEmail('password-reset')
      await renderSystemEmail('email-verification')
      expect(mockGet).toHaveBeenCalled()
    })
  })

  /**
   * Every one of these asserts the same thing from a different angle: when a
   * design cannot be used, the send renders the catalog's built-in copy —
   * the copy the editor seeds a first design with — in the platform's header
   * and footer (AGL-3322). A bug that returned a half-rendered email instead
   * would send customers a broken message; one that threw would stop them
   * getting one at all; one that returned null would send them bare text.
   */
  describe('sends the built-in copy when there is no usable design (AGL-3322)', () => {
    const expectBuiltIn = (
      result: Awaited<ReturnType<typeof renderSystemEmail>>,
    ) => {
      expect(result?.source).toBe('default')
      expect(result?.subject).toBe("You've been invited to Test Org on Aglyn")
      expect(result?.html).toContain('invited to join Test Org as editor')
      expect(result?.html).toContain(INVITE_REASON)
      expect(result?.text).toContain('invited to join Test Org as editor')
      expect(result?.text).toContain(INVITE_REASON)
    }
    const INVITE = { 'org.name': 'Test Org', 'invite.role': 'editor' }

    it('when no template document exists', async () => {
      mockGet.mockResolvedValue(snapshot(null))
      expectBuiltIn(await renderSystemEmail('org-invite', INVITE))
      // One read, and no version read after it.
      expect(mockGet).toHaveBeenCalledTimes(1)
      expect(mockVersionGet).not.toHaveBeenCalled()
    })

    it('when the version pointer was cleared by reset-to-default', async () => {
      mockGet.mockResolvedValue(snapshot({ versionId: null, subject: 'Stale {{org.name}}' }))
      const result = await renderSystemEmail('org-invite', INVITE)
      // The built-in subject too: a subject saved beside a design that was
      // reset belongs to that design.
      expectBuiltIn(result)
    })

    it('when the version document has no nodes', async () => {
      mockGet.mockResolvedValue(snapshot({ versionId: 'v1' }))
      mockVersionGet.mockResolvedValue(snapshot({ nodes: undefined }))
      expectBuiltIn(await renderSystemEmail('org-invite', INVITE))
    })

    it('when the node map is empty', async () => {
      mockGet.mockResolvedValue(snapshot({ versionId: 'v1' }))
      mockVersionGet.mockResolvedValue(snapshot({ nodes: {} }))
      expectBuiltIn(await renderSystemEmail('org-invite', INVITE))
    })

    it('when Firestore throws, rather than propagating the error', async () => {
      mockGet.mockRejectedValue(new Error('unavailable'))
      expectBuiltIn(await renderSystemEmail('org-invite', INVITE))
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('sending its built-in copy'),
        expect.any(Error),
      )
    })

    it('in the platform’s header and footer', async () => {
      mockGet.mockResolvedValue(snapshot(null))
      const result = await renderSystemEmail('org-invite', INVITE)
      const html = result?.html ?? ''
      // The wordmark, linked to the platform's home, above the copy.
      expect(html).toContain(
        `<a href="https://aglyn.com" target="_blank" style="text-decoration:none;"><img src="${AGLYN_WORDMARK}" alt="Aglyn"`,
      )
      expect(html.indexOf(AGLYN_WORDMARK)).toBeLessThan(
        html.indexOf('invited to join Test Org'),
      )
      // The footer, under it: why, where to get help, who and where from.
      expect(html.indexOf('invited to join Test Org')).toBeLessThan(
        html.indexOf(INVITE_REASON),
      )
      expect(html).toContain(
        `<a href="${PLATFORM_BRANDING_PROFILE.supportUrl}" target="_blank" style="color:#757575;text-decoration:underline;">Get help</a>`,
      )
      expect(html).toContain(AGLYN_LEGAL)
      expect(result?.text).toContain(`Get help: ${PLATFORM_BRANDING_PROFILE.supportUrl}`)
      expect(result?.text).toContain(AGLYN_LEGAL)
    })

    it('for every email the platform sends itself', async () => {
      mockGet.mockResolvedValue(snapshot(null))
      const keys = [
        'org-invite',
        'usage-summary',
        'erasure-hold-alert',
        'welcome',
        'member-added',
        'erasure-confirmation',
        'erasure-requested',
        'admin-password-reset',
        'password-changed-by-admin',
        'security-new-device',
        'security-passkey-added',
        'password-reset',
        'email-verification',
        'email-address-confirmation',
      ]
      for (const key of keys) {
        const result = await renderSystemEmail(key, { 'org.name': 'Test Org' })
        expect(`${key}: ${result?.source}`).toBe(`${key}: default`)
        expect(result?.html).toContain(AGLYN_WORDMARK)
        expect(result?.html).toContain(AGLYN_LEGAL)
        // The plain-text part ends with the footer, reason first. Every token
        // in a reason is a brand token or one its send supplies, so none is
        // left as a hole ("…to join  on Aglyn.", "…erase ’s data.").
        const reason = result?.text.split('\n\n').pop()?.split('\n')[0] ?? ''
        expect(reason).toMatch(/^You’re receiving this .*Aglyn/)
        expect(`${key}: ${reason}`).not.toMatch(/ {2}| \.| ’/)
      }
    })
  })

  describe('renders a published template', () => {
    beforeEach(() => {
      mockGet.mockResolvedValue(
        snapshot({ versionId: 'v1', subject: 'Join {{org.name}}' }),
      )
      mockVersionGet.mockResolvedValue(snapshot({ nodes: NODES }))
    })

    it('returns subject, html and text', async () => {
      const result = await renderSystemEmail('org-invite', {
        'org.name': 'Test Org',
      })
      expect(result).not.toBeNull()
      expect(result?.source).toBe('designed')
      expect(result?.html).toContain('Hello Test Org')
      expect(result?.html).not.toContain('invited to join')
      expect(typeof result?.text).toBe('string')
    })

    it('substitutes merge tokens into the subject', async () => {
      const result = await renderSystemEmail('org-invite', {
        'org.name': 'Test Org',
      })
      expect(result?.subject).toBe('Join Test Org')
    })

    it('falls back to the catalog subject when none is stored', async () => {
      mockGet.mockResolvedValue(snapshot({ versionId: 'v1' }))
      const result = await renderSystemEmail('org-invite', {
        'org.name': 'Test Org',
      })
      // The catalog default is "You've been invited to {{org.name}} on Aglyn".
      expect(result?.subject).toContain('Test Org')
      expect(result?.subject).not.toContain('{{')
    })

    it('never leaves an unresolved token in the subject', async () => {
      const result = await renderSystemEmail('org-invite', {})
      expect(result?.subject).not.toContain('{{')
    })
  })

  /**
   * White-label in a DESIGNED template (AGL-2139).
   *
   * Every org-context sender has the shape `designed?.subject ?? <branded
   * fallback>`, so the designed template wins — and the catalog copy said
   * "Aglyn". White-label therefore inverted precisely when staff published a
   * template, which is that feature's normal steady state.
   */
  describe('the brand reaches a designed template', () => {
    beforeEach(() => {
      mockGet.mockResolvedValue(snapshot({ versionId: 'v1' }))
      mockVersionGet.mockResolvedValue(snapshot({ nodes: NODES }))
    })

    it("renders the ORG's brand in the catalog subject", async () => {
      const result = await renderSystemEmail('org-invite', {
        'org.name': 'Test Org',
        'brand.productName': 'Northwind Studio',
      })
      expect(result?.subject).toContain('Northwind Studio')
      expect(result?.subject).not.toContain('Aglyn')
    })

    it('defaults to Aglyn when a sender supplies no brand at all', async () => {
      // The platform-scoped senders — password reset, verification, the
      // security alerts — genuinely have no org. Without a default,
      // `blankUnresolvedTokens` would delete `{{brand.productName}}` and ship
      // "You've been invited to Test Org on ", which is worse than the
      // hard-coded literal this replaced.
      const result = await renderSystemEmail('org-invite', {
        'org.name': 'Test Org',
      })
      expect(result?.subject).toContain('Aglyn')
      expect(result?.subject).not.toContain('{{')
    })

    it('emits the white-label email logo, with the brand as its alt text', async () => {
      const result = await renderSystemEmail(
        'org-invite',
        { 'org.name': 'Test Org', 'brand.productName': 'Northwind Studio' },
        { brandLogoUrl: 'https://cdn.example.com/northwind.png' },
      )
      expect(result?.html).toContain('https://cdn.example.com/northwind.png')
      // Most inboxes block images by default, so a logo with no alt is a
      // blank box where the sender's identity should be.
      expect(result?.html).toContain('alt="Northwind Studio"')
      // ONE logo: the org's is the header, and the platform's is not drawn.
      expect(result?.html.split('<img').length - 1).toBe(1)
      expect(result?.html).not.toContain(AGLYN_WORDMARK)
    })

    it('draws the platform’s header, and no org logo, when the send carries none', async () => {
      // An org-less send, or an org without white-label, is the platform's
      // own mail, so its header is the platform's wordmark (AGL-3322) — and
      // nothing else: there is no org logo to add a second one.
      const result = await renderSystemEmail('org-invite', {
        'org.name': 'Test Org',
      })
      expect(result?.html.split('<img').length - 1).toBe(1)
      expect(result?.html).toContain(`src="${AGLYN_WORDMARK}"`)
    })

    it('wears a white-label org’s header and footer, and nothing of Aglyn (AGL-3322)', async () => {
      const branding = resolveBrandingProfile({
        plan: 'agency',
        brandingProfile: {
          productName: 'Acme Sites',
          emailLogoUrl: 'https://cdn.example.com/acme.png',
          supportUrl: 'https://acme.test/help',
        },
      } as never)
      const result = await renderSystemEmail(
        'org-invite',
        { ...brandMergeTokens(branding), 'org.name': 'Test Org' },
        { brandLogoUrl: branding.emailLogoUrl, brandHomeUrl: branding.homeUrl },
      )
      const html = result?.html ?? ''
      expect(html).toContain('Hello Test Org')
      expect(html).toContain(
        '<a href="https://acme.test/help" target="_blank" style="text-decoration:none;"><img src="https://cdn.example.com/acme.png" alt="Acme Sites"',
      )
      expect(html).toContain(
        'You’re receiving this because someone invited you to join Test Org on Acme Sites.',
      )
      expect(html).toContain('>Get help</a>')
      expect(result?.text).toContain('Get help: https://acme.test/help')
      // The platform's legal line and address are the platform's: none here.
      expect(html).not.toContain('©')
      expect(html).not.toMatch(/aglyn|balcones/i)
      expect(result?.text).not.toMatch(/aglyn|balcones/i)
    })
  })

  // The test-send path renders the effective email — designed if published,
  // else the catalog default — so a test never sends an empty message (AGL-766).
  describe('renderEffectiveSystemEmail', () => {
    it('returns the designed version when one is published', async () => {
      mockGet.mockResolvedValue(
        snapshot({ versionId: 'v1', subject: 'Join {{org.name}}' }),
      )
      mockVersionGet.mockResolvedValue(snapshot({ nodes: NODES }))
      const result = await renderEffectiveSystemEmail('org-invite', {
        'org.name': 'Test Org',
      })
      expect(result?.subject).toBe('Join Test Org')
      expect(result?.html).toContain('Hello Test Org')
    })

    it('falls back to the catalog default when nothing is published', async () => {
      // No version pointer → the built-in copy, exactly as a real send.
      mockGet.mockResolvedValue(snapshot({ versionId: null }))
      const result = await renderEffectiveSystemEmail('org-invite', {
        'org.name': 'Test Org',
        'invite.role': 'editor',
      })
      expect(result?.source).toBe('default')
      expect(result?.html).toContain('invited to join Test Org as editor')
      expect(result?.subject).toContain('Test Org')
      expect(result?.subject).not.toContain('{{')
      // In the same header and footer a real send wears.
      expect(result?.html).toContain(AGLYN_WORDMARK)
      expect(result?.html).toContain(INVITE_REASON)
      expect(result).toEqual(
        await renderSystemEmail('org-invite', {
          'org.name': 'Test Org',
          'invite.role': 'editor',
        }),
      )
    })

    it('returns null for a Stripe-delivered or unknown key', async () => {
      expect(await renderEffectiveSystemEmail('stripe-receipt')).toBeNull()
      expect(await renderEffectiveSystemEmail('not-a-template')).toBeNull()
    })
  })

  // The batch split (AGL-768): a usage-email run resolves the template once
  // and renders it per recipient. renderSystemEmail is these two composed.
  describe('loadSystemEmail + renderLoadedSystemEmail', () => {
    it('reads Firestore once, then renders per recipient with no more reads', async () => {
      mockGet.mockResolvedValue(
        snapshot({ versionId: 'v1', subject: 'Join {{org.name}}' }),
      )
      mockVersionGet.mockResolvedValue(snapshot({ nodes: NODES }))

      const loaded = await loadSystemEmail('org-invite')
      expect(loaded).not.toBeNull()
      expect(mockGet).toHaveBeenCalledTimes(1)
      expect(mockVersionGet).toHaveBeenCalledTimes(1)

      const a = renderLoadedSystemEmail(loaded!, { 'org.name': 'Org A' })
      const b = renderLoadedSystemEmail(loaded!, { 'org.name': 'Org B' })
      expect(a?.subject).toBe('Join Org A')
      expect(b?.subject).toBe('Join Org B')
      expect(a?.html).toContain('Hello Org A')
      expect(b?.html).toContain('Hello Org B')
      // Rendering touched Firestore no further — the whole point of the split.
      expect(mockGet).toHaveBeenCalledTimes(1)
      expect(mockVersionGet).toHaveBeenCalledTimes(1)
    })

    it('loads null for a non-Resend key without reading Firestore', async () => {
      expect(await loadSystemEmail('stripe-receipt')).toBeNull()
      expect(await loadSystemEmail('stripe-card-expiring')).toBeNull()
      expect(mockGet).not.toHaveBeenCalled()
    })

    it('loads the built-in copy once for a batch, and draws each recipient’s brand', async () => {
      // The usage summary's shape: nothing designed, one load, a render per
      // org — and orgs of different brands in the same run (AGL-3322).
      mockGet.mockResolvedValue(snapshot(null))
      const loaded = await loadSystemEmail('usage-summary')
      expect(loaded?.source).toBe('default')
      expect(mockGet).toHaveBeenCalledTimes(1)

      const platform = renderLoadedSystemEmail(loaded!, {
        'org.name': 'Org A',
        month: '2026-08',
        'usage.summary': 'Page views: 12',
      })
      const agency = renderLoadedSystemEmail(
        loaded!,
        {
          ...brandMergeTokens(
            resolveBrandingProfile({
              plan: 'agency',
              brandingProfile: { productName: 'Acme Sites' },
            } as never),
          ),
          'org.name': 'Org B',
          month: '2026-08',
          'usage.summary': 'Page views: 34',
        },
        { brandLogoUrl: 'https://cdn.example.com/acme.png' },
      )
      expect(platform?.html).toContain(
        'You’re receiving this monthly summary because you manage Org A on Aglyn.',
      )
      expect(platform?.html).toContain(AGLYN_LEGAL)
      expect(agency?.html).toContain(
        'You’re receiving this monthly summary because you manage Org B on Acme Sites.',
      )
      expect(agency?.html).toContain('src="https://cdn.example.com/acme.png"')
      expect(agency?.html).not.toMatch(/aglyn/i)
      expect(agency?.text).not.toMatch(/aglyn/i)
      // Rendering read nothing more.
      expect(mockGet).toHaveBeenCalledTimes(1)
      expect(mockVersionGet).not.toHaveBeenCalled()
    })

    /**
     * A white-label org's blank Support URL must not be filled in by the
     * PLATFORM token map underneath it (AGL-2428).
     *
     * `renderLoadedSystemEmail` merges the caller's tokens over
     * `DEFAULT_BRAND_TOKENS`, which carries Aglyn's own support URL for the
     * genuinely org-less senders — password reset, verification, the
     * security alerts. That default is correct for them and catastrophic
     * here: the recipient of this mail is the white-label org's customer,
     * and a link to Aglyn's desk names their vendor to someone who was never
     * told one exists.
     */
    it('a blank brand support URL BLANKS the token, never inherits Aglyn’s', async () => {
      mockGet.mockResolvedValue(snapshot({ versionId: 'v1', subject: 'Hi' }))
      mockVersionGet.mockResolvedValue(
        snapshot({
          nodes: {
            '_@_': { $id: '_@_', componentId: 'div', nodes: ['t1'] },
            t1: {
              $id: 't1',
              componentId: 'emailText',
              pluginId: 'email',
              parentId: '_@_',
              props: {
                children: 'Need help? [{{brand.supportUrl}}]',
                variant: 'body',
              },
            },
          },
        }),
      )
      const loaded = await loadSystemEmail('org-invite')

      const whiteLabelled = renderLoadedSystemEmail(loaded!, {
        ...brandMergeTokens(
          resolveBrandingProfile({
            plan: 'agency',
            brandingProfile: { productName: 'Acme Sites' },
          } as never),
        ),
      })
      expect(whiteLabelled?.html).toContain('Need help? []')
      expect(whiteLabelled?.html).not.toContain('aglyn.com/support')

      // THE CONTROL, twice over. An org that DID set one still gets it, and
      // an org-less sender still gets Aglyn's — without both, this passes for
      // a build that has simply stopped resolving the token for anybody.
      const configured = renderLoadedSystemEmail(loaded!, {
        ...brandMergeTokens(
          resolveBrandingProfile({
            plan: 'agency',
            brandingProfile: { supportUrl: 'https://acme.test/help' },
          } as never),
        ),
      })
      expect(configured?.html).toContain('Need help? [https://acme.test/help]')

      const platform = renderLoadedSystemEmail(loaded!, {})
      expect(platform?.html).toContain(PLATFORM_BRANDING_PROFILE.supportUrl)
    })
  })

  /**
   * Aglyn's own mail wears its marketing site's header and footer (AGL-3318).
   *
   * A block is a component of that site, placed in a platform email as a
   * `reusableInstance`, and the mail renderer draws a node it does not know as
   * nothing. So the send reads the block from the site the deployment names
   * and expands it, except where the recipient must never see Aglyn: a
   * white-label org's people.
   */
  describe('email blocks from the platform marketing site (AGL-3318)', () => {
    const MARKETING_HOST = 'aglyn-marketing'
    const FOOTER_TEXT = 'Aglyn, 100 Example Street'
    /** The site's published footer, compressed as a promoted one is stored. */
    const STORED_FOOTER = {
      rootId: 'froot',
      nodes: compress({
        froot: {
          $id: 'froot',
          componentId: 'emailSection',
          pluginId: 'email',
          nodes: ['fline'],
        },
        fline: {
          $id: 'fline',
          componentId: 'emailText',
          pluginId: 'email',
          parentId: 'froot',
          props: { children: FOOTER_TEXT, variant: 'caption' },
        },
      }),
    }
    /** A designed email with the footer placed under its own copy. */
    const PLACES_FOOTER = {
      '_@_': { $id: '_@_', componentId: 'div', nodes: ['t1', 'ftr'] },
      t1: {
        $id: 't1',
        componentId: 'emailText',
        pluginId: 'email',
        parentId: '_@_',
        props: { children: 'Hello {{org.name}}', variant: 'body' },
      },
      ftr: {
        $id: 'ftr',
        componentId: 'reusableInstance',
        pluginId: 'mui',
        parentId: '_@_',
        props: { refId: 'footer-1', name: 'Email footer' },
        nodes: [],
      },
    }
    /** An agency's brand with no support URL, which never inherits Aglyn's. */
    const WHITE_LABEL = brandMergeTokens(
      resolveBrandingProfile({
        plan: 'agency',
        brandingProfile: { productName: 'Acme Sites' },
      } as never),
    )

    beforeEach(() => {
      jest.spyOn(console, 'warn').mockImplementation(() => undefined)
      mockPlatformHost.mockReturnValue(MARKETING_HOST)
      mockGet.mockResolvedValue(
        snapshot({ versionId: 'v1', subject: 'Join {{org.name}}' }),
      )
      mockVersionGet.mockResolvedValue(snapshot({ nodes: PLACES_FOOTER }))
      mockComponentGet.mockImplementation(async (hostId, componentId) =>
        snapshot(
          hostId === MARKETING_HOST && componentId === 'footer-1'
            ? STORED_FOOTER
            : null,
        ),
      )
    })
    afterEach(() => {
      mockPlatformHost.mockReturnValue(null)
      mockComponentGet.mockReset()
    })

    /** The coded chrome's marks: its reason line and the platform wordmark. */
    const expectNoCodedChrome = (result: { html: string; text: string } | null) => {
      expect(result?.html).not.toContain('You’re receiving this')
      expect(result?.html).not.toContain(AGLYN_WORDMARK)
      expect(result?.html).not.toContain('#F8F9FA')
      expect(result?.text).not.toContain('You’re receiving this')
    }

    it('expands a placed block, read from the marketing site, in a platform send', async () => {
      const result = await renderSystemEmail('org-invite', {
        'org.name': 'Test Org',
      })
      expect(mockComponentGet).toHaveBeenCalledWith(MARKETING_HOST, 'footer-1')
      expect(result?.html).toContain('Hello Test Org')
      expect(result?.html).toContain(FOOTER_TEXT)
      // The block's copy reaches the plain-text part as well.
      expect(result?.text).toContain(FOOTER_TEXT)
    })

    it('draws no coded header or footer around the blocks, which are the design’s own (AGL-3322)', async () => {
      const result = await renderSystemEmail('org-invite', {
        'org.name': 'Test Org',
      })
      expect(result?.html).toContain(FOOTER_TEXT)
      expectNoCodedChrome(result)
    })

    it('leaves it out of a white-label send, whose recipient must never see Aglyn', async () => {
      const result = await renderSystemEmail('org-invite', {
        'org.name': 'Test Org',
        ...WHITE_LABEL,
      })
      // The designed copy still sends; only the block is gone.
      expect(result?.html).toContain('Hello Test Org')
      expect(result?.html).not.toContain(FOOTER_TEXT)
      expect(result?.text).not.toContain(FOOTER_TEXT)
    })

    it('draws the agency’s header and footer in the block’s place, and nothing of Aglyn (AGL-3322)', async () => {
      const result = await renderSystemEmail('org-invite', {
        'org.name': 'Test Org',
        ...WHITE_LABEL,
      })
      // No email logo set: the agency's name is the header.
      expect(result?.html).toContain('>Acme Sites</div>')
      expect(result?.html).toContain(
        'You’re receiving this because someone invited you to join Test Org on Acme Sites.',
      )
      // No support URL set, so no support line, and no legal line at all.
      expect(result?.html).not.toContain('Get help')
      expect(result?.html).not.toContain('©')
      expect(result?.html).not.toMatch(/aglyn/i)
      expect(result?.text).not.toMatch(/aglyn/i)
    })

    it('reads nothing when the deployment names no marketing site, and still renders', async () => {
      mockPlatformHost.mockReturnValue(null)
      const result = await renderSystemEmail('org-invite', {
        'org.name': 'Test Org',
      })
      expect(mockComponentGet).not.toHaveBeenCalled()
      expect(result?.html).toContain('Hello Test Org')
      expect(result?.html).not.toContain(FOOTER_TEXT)
    })

    it('draws the platform’s coded chrome when no marketing site is named, as a self-hosted install does (AGL-3322)', async () => {
      mockPlatformHost.mockReturnValue(null)
      const result = await renderSystemEmail('org-invite', {
        'org.name': 'Test Org',
      })
      expect(result?.source).toBe('designed')
      expect(result?.html).toContain(`src="${AGLYN_WORDMARK}"`)
      expect(result?.html).toContain(INVITE_REASON)
      expect(result?.html).toContain(AGLYN_LEGAL)
    })

    it('still sends the designed copy when the block read fails', async () => {
      mockComponentGet.mockRejectedValue(new Error('unavailable'))
      const result = await renderSystemEmail('org-invite', {
        'org.name': 'Test Org',
      })
      // The design, not null: null would swap it for the built-in copy.
      expect(result?.subject).toBe('Join Test Org')
      expect(result?.html).toContain('Hello Test Org')
      expect(result?.html).not.toContain(FOOTER_TEXT)
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('email blocks failed to load'),
        expect.any(Error),
      )
      // Inside the coded header and footer, which stand in for the blocks.
      expect(result?.html).toContain(INVITE_REASON)
      expect(result?.html).toContain(AGLYN_LEGAL)
    })

    it('reads a design that places nothing without asking the marketing site', async () => {
      mockVersionGet.mockResolvedValue(snapshot({ nodes: NODES }))
      const result = await renderSystemEmail('org-invite', {
        'org.name': 'Test Org',
      })
      expect(result?.html).toContain('Hello Test Org')
      expect(mockComponentGet).not.toHaveBeenCalled()
    })

    it('reads the blocks once for a batch, and decides per recipient', async () => {
      const loaded = await loadSystemEmail('org-invite')
      expect(mockComponentGet).toHaveBeenCalledTimes(1)

      const platform = renderLoadedSystemEmail(loaded!, { 'org.name': 'Org A' })
      const agency = renderLoadedSystemEmail(loaded!, {
        'org.name': 'Org B',
        ...WHITE_LABEL,
      })
      expect(platform?.html).toContain(FOOTER_TEXT)
      expect(agency?.html).not.toContain(FOOTER_TEXT)
      // And the coded chrome only where the blocks are not drawn.
      expectNoCodedChrome(platform)
      expect(agency?.html).toContain('on Acme Sites.')
      // Rendering composed from what the load read, and read nothing more.
      expect(mockComponentGet).toHaveBeenCalledTimes(1)
    })

    it('leaves it out when the send carries an org email logo, which stays the only header', async () => {
      const loaded = await loadSystemEmail('org-invite')
      const result = renderLoadedSystemEmail(
        loaded!,
        { 'org.name': 'Test Org' },
        { brandLogoUrl: 'https://cdn.example.com/acme.png' },
      )
      expect(result?.html).toContain('https://cdn.example.com/acme.png')
      expect(result?.html).not.toContain(FOOTER_TEXT)
      expect(result?.html.split('<img').length - 1).toBe(1)
    })

    it('expands it in a staff test send of the designed version too', async () => {
      const result = await renderEffectiveSystemEmail('org-invite', {
        'org.name': 'Test Org',
      })
      expect(result?.html).toContain(FOOTER_TEXT)
      expectNoCodedChrome(result)
    })
  })

  describe('isPlatformBrandedSend (AGL-3318)', () => {
    const withDefaults = (merge: Record<string, string>) => ({
      ...brandMergeTokens(PLATFORM_BRANDING_PROFILE),
      ...merge,
    })

    it('is true for an org-less send, which supplies no brand at all', () => {
      expect(isPlatformBrandedSend(withDefaults({ 'org.name': 'Test Org' }))).toBe(
        true,
      )
    })

    it('is true for an org without white-label, which resolves to the platform brand', () => {
      const branding = resolveBrandingProfile({
        plan: 'pro',
        brandingProfile: { productName: 'Ignored Without The Entitlement' },
      } as never)
      expect(
        isPlatformBrandedSend(withDefaults(brandMergeTokens(branding)), {
          brandLogoUrl: branding.emailLogoUrl,
        }),
      ).toBe(true)
    })

    it('is false for a white-label org that set no support URL', () => {
      // The one field every white-label profile differs on (AGL-2428).
      const branding = resolveBrandingProfile({
        plan: 'agency',
        brandingProfile: {},
      } as never)
      expect(branding.productName).toBe(PLATFORM_BRANDING_PROFILE.productName)
      expect(
        isPlatformBrandedSend(withDefaults(brandMergeTokens(branding)), {
          brandLogoUrl: branding.emailLogoUrl,
        }),
      ).toBe(false)
    })

    it('is false for a white-label org with its own support URL', () => {
      const branding = resolveBrandingProfile({
        plan: 'agency',
        brandingProfile: { supportUrl: 'https://acme.test/help' },
      } as never)
      expect(isPlatformBrandedSend(withDefaults(brandMergeTokens(branding)))).toBe(
        false,
      )
    })

    it('is false whenever the send carries an email logo', () => {
      expect(
        isPlatformBrandedSend(withDefaults({}), {
          brandLogoUrl: 'https://cdn.example.com/acme.png',
        }),
      ).toBe(false)
      // Blank is no logo, as the renderer reads it.
      expect(isPlatformBrandedSend(withDefaults({}), { brandLogoUrl: '  ' })).toBe(
        true,
      )
    })
  })

  // Drift guard (AGL-765): the render lib carries its own copy of the besigner
  // root id so server code needn't pull the @aglyn/aglyn barrel. If the
  // besigner ever changes CANVAS_ROOT_ELEMENT_ID this fails loudly, pointing
  // here — a silent divergence would make every designed template render empty.
  it('keeps EMAIL_NODE_ROOT_ID in sync with the besigner root', () => {
    expect(EMAIL_NODE_ROOT_ID).toBe(CANVAS_ROOT_ELEMENT_ID)
  })
})
