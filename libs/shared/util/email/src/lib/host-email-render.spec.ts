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
  loadHostEmail,
  renderHostEmail,
  renderLoadedHostEmail,
  type AdminFirestoreLike,
} from './host-email-render'

/** A Firestore-ish snapshot over a plain object. */
function snapshot(data: Record<string, unknown> | null) {
  return { exists: data !== null, get: (field: string) => data?.[field] }
}

/**
 * A fake Admin Firestore modelling the exact chain the resolver walks:
 * hosts/{id}/emailTemplates/{key} then that ref's versions/{versionId}.
 * `reads` counts template-doc gets so a test can prove resolve-once.
 */
function fakeFirestore(
  template: Record<string, unknown> | null,
  version: Record<string, unknown> | null,
  reads: { templates: number; versions: number; hosts?: number },
  host: Record<string, unknown> | null = null,
): AdminFirestoreLike {
  const templateRef = {
    get: async () => {
      reads.templates += 1
      return snapshot(template)
    },
    collection: () => ({
      doc: () => ({
        get: async () => {
          reads.versions += 1
          return snapshot(version)
        },
        collection: () => ({ doc: () => ({ get: async () => snapshot(null) }) }),
      }),
    }),
  }
  return {
    collection: () => ({
      doc: () => ({
        // The host document itself — read for the site's origin (AGL-1224).
        get: async () => {
          reads.hosts = (reads.hosts ?? 0) + 1
          return snapshot(host)
        },
        collection: () => ({ doc: () => templateRef }),
      }),
    }),
  } as unknown as AdminFirestoreLike
}

const NODES = {
  '_@_': { $id: '_@_', componentId: 'div', nodes: ['t1'] },
  t1: {
    $id: 't1',
    componentId: 'emailText',
    pluginId: 'email',
    parentId: '_@_',
    props: { children: 'Hi {{name}}', variant: 'body' },
  },
}

describe('renderHostEmail (AGL-770)', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => undefined))

  it('returns null for an unknown key without reading Firestore', async () => {
    const reads = { templates: 0, versions: 0 }
    const fs = fakeFirestore(null, null, reads)
    expect(await renderHostEmail(fs, 'h1', 'not-a-real-email')).toBeNull()
    expect(reads.templates).toBe(0)
  })

  it('returns null for a non-designable (fixed/external) key without reading', async () => {
    const reads = { templates: 0, versions: 0 }
    const fs = fakeFirestore(null, null, reads)
    // member-post is `fixed`, campaign is `external` — neither is besigner.
    expect(await renderHostEmail(fs, 'h1', 'member-post')).toBeNull()
    expect(await renderHostEmail(fs, 'h1', 'campaign')).toBeNull()
    expect(reads.templates).toBe(0)
  })

  it('falls back (null) when no version is published', async () => {
    const reads = { templates: 0, versions: 0 }
    const fs = fakeFirestore({ versionId: null }, null, reads)
    expect(await renderHostEmail(fs, 'h1', 'booking-confirmed')).toBeNull()
  })

  it('renders a published designable template', async () => {
    const reads = { templates: 0, versions: 0 }
    const fs = fakeFirestore(
      { versionId: 'v1', subject: 'See you {{name}}' },
      { nodes: NODES },
      reads,
    )
    const result = await renderHostEmail(fs, 'h1', 'booking-confirmed', {
      name: 'Alex',
    })
    expect(result?.subject).toBe('See you Alex')
    expect(result?.html).toContain('Hi Alex')
  })

  it('loads once, then renders per recipient with no more reads', async () => {
    const reads = { templates: 0, versions: 0 }
    const fs = fakeFirestore(
      { versionId: 'v1', subject: 'Hello {{name}}' },
      { nodes: NODES },
      reads,
    )
    const loaded = await loadHostEmail(fs, 'h1', 'booking-reminder')
    expect(loaded).not.toBeNull()
    expect(reads.templates).toBe(1)
    expect(reads.versions).toBe(1)

    const a = renderLoadedHostEmail(loaded!, { name: 'Alex' })
    const b = renderLoadedHostEmail(loaded!, { name: 'Sam' })
    expect(a?.subject).toBe('Hello Alex')
    expect(b?.subject).toBe('Hello Sam')
    // Rendering touched Firestore no further.
    expect(reads.templates).toBe(1)
    expect(reads.versions).toBe(1)
  })

  /**
   * AGL-1224. The origin has to come from the SITE, not a constant: the CDN
   * route is mounted in both the console and the tenant app, and a customer's
   * booking confirmation must fetch its images from the customer's own site.
   */
  describe('picked media resolves against the site (AGL-1224)', () => {
    const IMAGE_NODES = {
      '_@_': { $id: '_@_', componentId: 'div', nodes: ['i1'] },
      i1: {
        $id: 'i1',
        componentId: 'emailImage',
        pluginId: 'email',
        parentId: '_@_',
        props: { src: 'media:org:o1/med7', alt: 'Logo' },
      },
    }
    const published = { versionId: 'v1', subject: 'Hi' }

    it('uses a custom domain over the platform subdomain', async () => {
      const reads = { templates: 0, versions: 0 }
      const fs = fakeFirestore(published, { nodes: IMAGE_NODES }, reads, {
        subdomain: 'acme',
        cname: 'shop.acme.com',
      })
      const result = await renderHostEmail(fs, 'h1', 'booking-confirmed')
      expect(result?.html).toContain(
        'src="https://shop.acme.com/api/media/cdn/org:o1:h1/med7"',
      )
    })

    it('falls back to the platform subdomain', async () => {
      const reads = { templates: 0, versions: 0 }
      const fs = fakeFirestore(published, { nodes: IMAGE_NODES }, reads, {
        subdomain: 'acme',
      })
      const result = await renderHostEmail(fs, 'h1', 'booking-confirmed')
      expect(result?.html).toContain(
        'src="https://acme.aglyn.app/api/media/cdn/org:o1:h1/med7"',
      )
    })

    it('drops the image when the host has no origin at all', async () => {
      const reads = { templates: 0, versions: 0 }
      const fs = fakeFirestore(published, { nodes: IMAGE_NODES }, reads, {})
      const result = await renderHostEmail(fs, 'h1', 'booking-confirmed')
      expect(result?.html).not.toContain('media:org')
      expect(result?.html).not.toContain('src="/api/media/cdn')
    })

    it('skips the host read when the caller already knows the origin', async () => {
      const reads = { templates: 0, versions: 0, hosts: 0 }
      const fs = fakeFirestore(published, { nodes: IMAGE_NODES }, reads, {
        subdomain: 'acme',
      })
      const result = await renderHostEmail(
        fs,
        'h1',
        'booking-confirmed',
        {},
        { origin: 'https://passed.test' },
      )
      expect(result?.html).toContain('src="https://passed.test/api/media/cdn/')
      expect(reads.hosts).toBe(0)
    })

    it('reads the host once per LOAD, not once per recipient', async () => {
      const reads = { templates: 0, versions: 0, hosts: 0 }
      const fs = fakeFirestore(published, { nodes: IMAGE_NODES }, reads, {
        subdomain: 'acme',
      })
      const loaded = await loadHostEmail(fs, 'h1', 'booking-reminder')
      renderLoadedHostEmail(loaded!, { name: 'Alex' })
      renderLoadedHostEmail(loaded!, { name: 'Sam' })
      expect(reads.hosts).toBe(1)
    })

    it('costs no host read when nothing is published', async () => {
      // The origin is only needed for something to render, so an unpublished
      // template still settles in a single read (AGL-770).
      const reads = { templates: 0, versions: 0, hosts: 0 }
      const fs = fakeFirestore({ versionId: null }, null, reads, {
        subdomain: 'acme',
      })
      expect(await renderHostEmail(fs, 'h1', 'booking-confirmed')).toBeNull()
      expect(reads.hosts).toBe(0)
    })
  })

  it('never leaves an unresolved token in the output', async () => {
    const reads = { templates: 0, versions: 0 }
    const fs = fakeFirestore(
      { versionId: 'v1', subject: 'Hi {{name}}' },
      { nodes: NODES },
      reads,
    )
    const result = await renderHostEmail(fs, 'h1', 'booking-confirmed', {})
    expect(result?.subject).not.toContain('{{')
    expect(result?.html).not.toContain('{{')
  })
})
