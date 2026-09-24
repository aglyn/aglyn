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

import { encode } from '@msgpack/msgpack'
import {
  loadHostEmail,
  renderHostEmail,
  renderLoadedHostEmail,
  type AdminFirestoreLike,
  type HostEmailComposer,
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

/**
 * The policy these tests hand the renderer. Identity on purpose: nothing here
 * is about WHAT the sanitizer keeps — `email-render.spec.ts` owns that — only
 * that this layer has one to pass and passes it. The real senders supply
 * `sanitizeAuthorHtml`.
 */
const SANITIZE = (html: string) => html

/**
 * The composer these tests hand the loader: the map as stored. Nothing here
 * places a reusable block — what the graft does is the core's to prove
 * (`load-referenced-components.spec.ts`), and the senders pass the real one.
 * What THIS layer owes is calling it and rendering what it returns, which the
 * `reusable blocks` block below holds.
 */
const COMPOSE: HostEmailComposer = async (nodes) => nodes

describe('renderHostEmail (AGL-770)', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => undefined))

  it('returns null for an unknown key without reading Firestore', async () => {
    const reads = { templates: 0, versions: 0 }
    const fs = fakeFirestore(null, null, reads)
    expect(
      await renderHostEmail(fs, 'h1', 'not-a-real-email', {}, {
        sanitize: SANITIZE,
        compose: COMPOSE,
      }),
    ).toBeNull()
    expect(reads.templates).toBe(0)
  })

  it('returns null for a non-designable (fixed/external) key without reading', async () => {
    const reads = { templates: 0, versions: 0 }
    const fs = fakeFirestore(null, null, reads)
    // member-post is `fixed`, campaign is `external` — neither is besigner.
    expect(
      await renderHostEmail(fs, 'h1', 'member-post', {}, {
        sanitize: SANITIZE,
        compose: COMPOSE,
      }),
    ).toBeNull()
    expect(
      await renderHostEmail(fs, 'h1', 'campaign', {}, {
        sanitize: SANITIZE,
        compose: COMPOSE,
      }),
    ).toBeNull()
    expect(reads.templates).toBe(0)
  })

  it('falls back (null) when no version is published', async () => {
    const reads = { templates: 0, versions: 0 }
    const fs = fakeFirestore({ versionId: null }, null, reads)
    expect(
      await renderHostEmail(fs, 'h1', 'booking-confirmed', {}, {
        sanitize: SANITIZE,
        compose: COMPOSE,
      }),
    ).toBeNull()
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
    }, { sanitize: SANITIZE, compose: COMPOSE })
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
    const loaded = await loadHostEmail(fs, 'h1', 'booking-reminder', {
      compose: COMPOSE,
    })
    expect(loaded).not.toBeNull()
    expect(reads.templates).toBe(1)
    expect(reads.versions).toBe(1)

    const a = renderLoadedHostEmail(loaded!, { name: 'Alex' }, SANITIZE)
    const b = renderLoadedHostEmail(loaded!, { name: 'Sam' }, SANITIZE)
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
      const result = await renderHostEmail(
        fs,
        'h1',
        'booking-confirmed',
        {},
        { sanitize: SANITIZE, compose: COMPOSE },
      )
      expect(result?.html).toContain(
        'src="https://shop.acme.com/api/media/cdn/org:o1:h1/med7"',
      )
    })

    it('falls back to the platform subdomain', async () => {
      const reads = { templates: 0, versions: 0 }
      const fs = fakeFirestore(published, { nodes: IMAGE_NODES }, reads, {
        subdomain: 'acme',
      })
      const result = await renderHostEmail(
        fs,
        'h1',
        'booking-confirmed',
        {},
        { sanitize: SANITIZE, compose: COMPOSE },
      )
      expect(result?.html).toContain(
        'src="https://acme.aglyn.app/api/media/cdn/org:o1:h1/med7"',
      )
    })

    it('drops the image when the host has no origin at all', async () => {
      const reads = { templates: 0, versions: 0 }
      const fs = fakeFirestore(published, { nodes: IMAGE_NODES }, reads, {})
      const result = await renderHostEmail(
        fs,
        'h1',
        'booking-confirmed',
        {},
        { sanitize: SANITIZE, compose: COMPOSE },
      )
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
        {
          origin: 'https://passed.test',
          sanitize: SANITIZE,
          compose: COMPOSE,
        },
      )
      expect(result?.html).toContain('src="https://passed.test/api/media/cdn/')
      expect(reads.hosts).toBe(0)
    })

    it('reads the host once per LOAD, not once per recipient', async () => {
      const reads = { templates: 0, versions: 0, hosts: 0 }
      const fs = fakeFirestore(published, { nodes: IMAGE_NODES }, reads, {
        subdomain: 'acme',
      })
      const loaded = await loadHostEmail(fs, 'h1', 'booking-reminder', {
      compose: COMPOSE,
    })
      renderLoadedHostEmail(loaded!, { name: 'Alex' }, SANITIZE)
      renderLoadedHostEmail(loaded!, { name: 'Sam' }, SANITIZE)
      expect(reads.hosts).toBe(1)
    })

    it('costs no host read when nothing is published', async () => {
      // The origin is only needed for something to render, so an unpublished
      // template still settles in a single read (AGL-770).
      const reads = { templates: 0, versions: 0, hosts: 0 }
      const fs = fakeFirestore({ versionId: null }, null, reads, {
        subdomain: 'acme',
      })
      expect(
        await renderHostEmail(fs, 'h1', 'booking-confirmed', {}, {
          sanitize: SANITIZE,
          compose: COMPOSE,
        }),
      ).toBeNull()
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
    const result = await renderHostEmail(
      fs,
      'h1',
      'booking-confirmed',
      {},
      { sanitize: SANITIZE, compose: COMPOSE },
    )
    expect(result?.subject).not.toContain('{{')
    expect(result?.html).not.toContain('{{')
  })

  /**
   * THE SEND PATH READS BOTH STORED FORMS (AGL-1223).
   *
   * `nodes` is msgpack for anything the besigner has saved since AGL-1151, and
   * a plain map for every version written before it — and nothing migrates
   * those, so both are live forever.
   *
   * The failure this pins is silent rather than loud. `loadHostEmail` guards
   * on `!Object.keys(nodes).length`, and over a `Buffer` those keys are BYTE
   * INDICES: the guard passes, `renderEmailHtml` walks byte numbers, finds no
   * root, and the customer gets an empty email — where returning null would
   * have fallen back to the built-in copy and sent something correct.
   */
  describe('both stored forms of the version', () => {
    /**
     * What firebase-admin actually hands back for a bytes field: a Node
     * `Buffer` carved out of the shared allocation pool, so `byteOffset` is
     * non-zero and the backing `ArrayBuffer` is bigger than the field. A
     * zero-offset buffer would pass even against a decoder that ignores the
     * offset, which is the mistake most likely to come back.
     */
    const pooledNodes = () => {
      const bytes = encode(NODES)
      const pool = Buffer.allocUnsafeSlow(Buffer.poolSize)
      const packed = pool.subarray(64, 64 + bytes.byteLength)
      packed.set(bytes)
      return packed
    }

    it('renders a version stored as msgpack bytes', async () => {
      const packed = pooledNodes()
      // Guard the premise, or this passes for the wrong reason.
      expect(packed.byteOffset).toBeGreaterThan(0)
      expect(packed.buffer.byteLength).toBeGreaterThan(packed.byteLength)

      const reads = { templates: 0, versions: 0 }
      const fs = fakeFirestore(
        { versionId: 'v1', subject: 'See you {{name}}' },
        { nodes: packed },
        reads,
      )
      const result = await renderHostEmail(
        fs,
        'h1',
        'booking-confirmed',
        { name: 'Alex' },
        { sanitize: SANITIZE, compose: COMPOSE },
      )
      expect(result?.subject).toBe('See you Alex')
      expect(result?.html).toContain('Hi Alex')
    })

    it('gives both forms the same output', async () => {
      const render = async (nodes: unknown) => {
        const reads = { templates: 0, versions: 0 }
        return renderHostEmail(
          fakeFirestore(
            { versionId: 'v1', subject: 'See you {{name}}' },
            { nodes },
            reads,
          ),
          'h1',
          'booking-confirmed',
          { name: 'Alex' },
          { sanitize: SANITIZE, compose: COMPOSE },
        )
      }
      expect(await render(pooledNodes())).toEqual(await render(NODES))
    })

    it('falls back rather than sending an empty design it could not decode', async () => {
      const spy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)
      try {
        const reads = { templates: 0, versions: 0 }
        const fs = fakeFirestore(
          { versionId: 'v1', subject: 'Hi' },
          { nodes: Buffer.from([0xc1, 0xc1, 0xc1]) },
          reads,
        )
        expect(
          await renderHostEmail(fs, 'h1', 'booking-confirmed', {}, {
            sanitize: SANITIZE,
            compose: COMPOSE,
          }),
        ).toBeNull()
        // Silence is how an undecodable design becomes an empty send.
        expect(spy).toHaveBeenCalled()
      } finally {
        spy.mockRestore()
      }
    })
  })
})

/**
 * A site's reusable blocks reach the mail through the composer (AGL-3287).
 *
 * A header or footer the site owner placed is a `reusableInstance` node, which
 * `renderEmailHtml` draws as nothing. This lib cannot graft it — the component
 * model is the core's, and `scope:shared` may not import it — so the loader
 * takes a composer and renders exactly what that composer returns. These pin
 * the contract from this side: called once per LOAD with the handle and site
 * the template was read with, its output the thing every recipient receives,
 * its failure the built-in copy rather than an email with its header missing.
 */
describe('reusable blocks go through the composer (AGL-3287)', () => {
  beforeEach(() =>
    jest.spyOn(console, 'error').mockImplementation(() => undefined),
  )
  afterEach(() => jest.restoreAllMocks())

  /** As stored: one placement of the site's header component. */
  const PLACED = {
    '_@_': { $id: '_@_', componentId: 'div', nodes: ['hdr'] },
    hdr: {
      $id: 'hdr',
      componentId: 'reusableInstance',
      parentId: '_@_',
      props: { refId: 'header' },
      nodes: [],
    },
  }
  /** As composed: the placement is the header's own block now. */
  const COMPOSED = {
    '_@_': { $id: '_@_', componentId: 'div', nodes: ['hdr'] },
    hdr: {
      $id: 'hdr',
      componentId: 'emailText',
      pluginId: 'email',
      parentId: '_@_',
      props: { children: 'Acme header for {{name}}' },
    },
  }
  const published = { versionId: 'v1', subject: 'Hello {{name}}' }

  it('renders what the composer returns, composed once for every recipient', async () => {
    const reads = { templates: 0, versions: 0 }
    const fs = fakeFirestore(published, { nodes: PLACED }, reads)
    const compose = jest.fn<
      ReturnType<HostEmailComposer>,
      Parameters<HostEmailComposer>
    >(async () => COMPOSED)

    const loaded = await loadHostEmail(fs, 'h1', 'booking-reminder', {
      compose,
    })
    const a = renderLoadedHostEmail(loaded!, { name: 'Alex' }, SANITIZE)
    const b = renderLoadedHostEmail(loaded!, { name: 'Sam' }, SANITIZE)

    expect(a?.html).toContain('Acme header for Alex')
    expect(b?.html).toContain('Acme header for Sam')
    // Handed the DECODED map, with the handle and site the template came
    // from — and asked once, however many recipients render from it.
    expect(compose).toHaveBeenCalledTimes(1)
    expect(compose.mock.calls[0][0]).toEqual(PLACED)
    expect(compose.mock.calls[0][1]).toEqual({ firestore: fs, hostId: 'h1' })
  })

  it('THE CONTROL: the stored map alone draws no header', async () => {
    const reads = { templates: 0, versions: 0 }
    const fs = fakeFirestore(published, { nodes: PLACED }, reads)
    const loaded = await loadHostEmail(fs, 'h1', 'booking-reminder', {
      compose: COMPOSE,
    })
    // What every host email did before a composer was required: the
    // placement renders as nothing, and the header the author placed is gone.
    expect(
      renderLoadedHostEmail(loaded!, { name: 'Alex' }, SANITIZE)?.html,
    ).not.toContain('Acme header')
  })

  it('falls back to the built-in copy when the components cannot be read', async () => {
    const reads = { templates: 0, versions: 0 }
    const fs = fakeFirestore(published, { nodes: PLACED }, reads)
    const loaded = await loadHostEmail(fs, 'h1', 'booking-reminder', {
      compose: async () => {
        throw new Error('unavailable')
      },
    })
    // Null is the sender's cue to send its own copy: the customer gets an
    // email, just not one missing half its design.
    expect(loaded).toBeNull()
  })

  it('does not compile without a composer', async () => {
    const reads = { templates: 0, versions: 0 }
    const fs = fakeFirestore(published, { nodes: PLACED }, reads)
    // A composer a sender may leave out is one the next sender leaves out, so
    // leaving it out is a type error. At runtime, anything that got around the
    // type still falls back rather than mailing the design without its blocks.
    // @ts-expect-error — `compose` is required
    expect(await loadHostEmail(fs, 'h1', 'booking-reminder', {})).toBeNull()
    expect(
      // @ts-expect-error — and so are the options that carry it
      await loadHostEmail(fs, 'h1', 'booking-reminder'),
    ).toBeNull()
    expect(
      // @ts-expect-error — the one-shot renderer asks for it too
      await renderHostEmail(fs, 'h1', 'booking-confirmed', {}, {
        sanitize: SANITIZE,
      }),
    ).toBeNull()
  })
})
