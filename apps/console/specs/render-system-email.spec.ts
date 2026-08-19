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

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn'
import { EMAIL_NODE_ROOT_ID } from '@aglyn/shared-util-email'
import {
  loadSystemEmail,
  renderEffectiveSystemEmail,
  renderLoadedSystemEmail,
  renderSystemEmail,
} from '../app/api/_lib/render-system-email'

const mockGet = jest.fn()
const mockVersionGet = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            get: mockGet,
            collection: () => ({ doc: () => ({ get: mockVersionGet }) }),
          }),
        }),
      }),
    }),
  },
}))

/** A Firestore-ish snapshot over a plain object. */
function snapshot(data: Record<string, unknown> | null) {
  return {
    exists: data !== null,
    get: (field: string) => data?.[field],
  }
}

/**
 * Every one of these asserts the same thing from a different angle: when a
 * template cannot be used, the resolver returns null so the caller falls
 * back to its built-in copy. A bug that returned a half-rendered email
 * instead would send customers a broken message; a bug that threw would stop
 * them getting one at all.
 */
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

  describe('falls back to the built-in copy', () => {
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

    it('when no template document exists', async () => {
      mockGet.mockResolvedValue(snapshot(null))
      expect(await renderSystemEmail('org-invite')).toBeNull()
    })

    it('when the version pointer was cleared by reset-to-default', async () => {
      mockGet.mockResolvedValue(snapshot({ versionId: null }))
      expect(await renderSystemEmail('org-invite')).toBeNull()
    })

    it('when the version document has no nodes', async () => {
      mockGet.mockResolvedValue(snapshot({ versionId: 'v1' }))
      mockVersionGet.mockResolvedValue(snapshot({ nodes: undefined }))
      expect(await renderSystemEmail('org-invite')).toBeNull()
    })

    it('when the node map is empty', async () => {
      mockGet.mockResolvedValue(snapshot({ versionId: 'v1' }))
      mockVersionGet.mockResolvedValue(snapshot({ nodes: {} }))
      expect(await renderSystemEmail('org-invite')).toBeNull()
    })

    it('when Firestore throws, rather than propagating the error', async () => {
      mockGet.mockRejectedValue(new Error('unavailable'))
      await expect(renderSystemEmail('org-invite')).resolves.toBeNull()
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
      expect(result?.html).toContain('Hello Test Org')
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
    })

    it('emits NOTHING when the org has no email logo', async () => {
      // A gap where a logo should be reads as a broken email; no logo reads
      // as a plain one, which is correct for an org that set none.
      const result = await renderSystemEmail('org-invite', {
        'org.name': 'Test Org',
      })
      expect(result?.html).not.toContain('<img')
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
      // No version pointer → renderSystemEmail returns null → default renders.
      mockGet.mockResolvedValue(snapshot({ versionId: null }))
      const result = await renderEffectiveSystemEmail('org-invite', {
        'org.name': 'Test Org',
        'invite.role': 'editor',
      })
      expect(result?.html).toContain('invited to join Test Org as editor')
      expect(result?.subject).toContain('Test Org')
      expect(result?.subject).not.toContain('{{')
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
  })

  // Drift guard (AGL-765): the render lib carries its own copy of the besigner
  // root id so server code needn't pull the @aglyn/aglyn barrel. If the
  // besigner ever changes CANVAS_ROOT_ELEMENT_ID this fails loudly, pointing
  // here — a silent divergence would make every designed template render empty.
  it('keeps EMAIL_NODE_ROOT_ID in sync with the besigner root', () => {
    expect(EMAIL_NODE_ROOT_ID).toBe(CANVAS_ROOT_ELEMENT_ID)
  })
})
