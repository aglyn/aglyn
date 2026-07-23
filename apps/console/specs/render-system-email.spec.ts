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
  renderEffectiveSystemEmail,
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

    it('when the email is delivered by Firebase, not us', async () => {
      // Rendering these would produce output nothing ever sends (AGL-751).
      expect(await renderSystemEmail('password-reset')).toBeNull()
      expect(await renderSystemEmail('email-verification')).toBeNull()
      expect(mockGet).not.toHaveBeenCalled()
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

    it('returns null for a Firebase-delivered or unknown key', async () => {
      expect(await renderEffectiveSystemEmail('password-reset')).toBeNull()
      expect(await renderEffectiveSystemEmail('not-a-template')).toBeNull()
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
