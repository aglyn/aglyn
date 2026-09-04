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
 *
 * @jest-environment node
 */

/**
 * Publishing a campaign email as a marketplace starter.
 *
 * Two properties this file is here for, both of which the transactional
 * publisher next door does NOT have:
 *
 * - its source is a SCREEN version, which is compressed msgpack from the first
 *   besigner save onward — read raw it is a truthy `Buffer` that scans as a
 *   design with no blocks in it;
 * - a violating design is REFUSED rather than quietly stripped, because a
 *   publisher whose tracking pixel was silently removed learns nothing.
 */

import { compress } from '@aglyn/aglyn/app-utils/compress'

const ROOT = '_@_'

const state = {
  screen: {} as Record<string, unknown>,
  version: {} as Record<string, unknown>,
  writes: [] as Array<{ path: string; data: Record<string, unknown> }>,
}

jest.mock('@aglyn/aglyn/server', () => ({
  CANVAS_ROOT_ELEMENT_ID: '_@_',
  createResourceUid: () => 'listing-new',
  checkEntitlement: () => true,
}))

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({
    orgId: 'seller-org',
    permissions: { publishToMarketplace: true },
  }),
}))

jest.mock('./publisher-profile', () => ({
  resolvePublisherProfile: async () => ({ orgId: 'seller-org', handle: 'acme' }),
}))

jest.mock('./publish-preconditions', () => ({
  publishPreconditionRefusal: () => undefined,
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const snapshotOf = (data: Record<string, unknown>, exists = true) => ({
    exists,
    data: () => (exists ? data : undefined),
    get: (field: string) => data[field],
  })
  const docRef = (path: string): any => ({
    path,
    get: async () => {
      if (path === 'hosts/host-1') {
        return snapshotOf({ memberRoles: { 'seller-1': 'admin' } })
      }
      if (path === 'hosts/host-1/screens/screen-1') {
        return snapshotOf(state.screen)
      }
      if (path.startsWith('hosts/host-1/screens/screen-1/versions/')) {
        return snapshotOf(state.version)
      }
      return snapshotOf({}, false)
    },
    set: async (data: Record<string, unknown>) => {
      state.writes.push({ path, data })
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  })
  const collectionRef = (path: string): any => {
    const chain: any = {
      doc: (id: string) => docRef(`${path}/${id}`),
      where: () => chain,
      limit: () => chain,
      get: async () => ({ empty: true, docs: [] }),
    }
    return chain
  }
  return {
    getOrgForHost: async () => ({ orgId: 'seller-org', org: { plan: 'pro' } }),
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: async () => ({ uid: 'seller-1' }) }),
        firestore: () => ({ collection: (name: string) => collectionRef(name) }),
      }),
      firestore: {
        FieldValue: { serverTimestamp: () => 'NOW', arrayUnion: (v: unknown) => [v] },
        Timestamp: { now: () => 'NOW' },
      },
    },
  }
})

import { publishEmailStarterHandler } from './publish-email-starter'

function makeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined as any,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload
      return res
    },
  }
  return res
}

async function publish() {
  const res = makeRes()
  await publishEmailStarterHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: { hostId: 'host-1', screenId: 'screen-1', displayName: 'Spring sale' },
    } as any,
    res,
  )
  return res
}

const block = (componentId: string, props: Record<string, unknown>) => ({
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['sec'] },
  sec: {
    $id: 'sec',
    componentId: 'emailSection',
    pluginId: 'email',
    parentId: ROOT,
    nodes: ['one'],
  },
  one: {
    $id: 'one',
    componentId,
    pluginId: 'email',
    parentId: 'sec',
    props,
  },
})

/** The version document that actually got written, if any. */
const versionWrite = () =>
  state.writes.find((write) => write.path.includes('/versions/'))

beforeEach(() => {
  state.writes = []
  state.screen = {
    kind: 'email',
    versionId: 'v1',
    emailSubject: 'Spring sale',
    emailPreheader: 'Ends Sunday',
  }
  state.version = { nodes: block('emailText', { children: 'Hi there' }) }
})

describe('a clean campaign email publishes', () => {
  it('writes a listing and a version', async () => {
    const res = await publish()
    expect(res.statusCode).toBe(200)
    expect(state.writes[0].data).toMatchObject({
      artifactType: 'emailStarter',
      sourceScreenId: 'screen-1',
      latestVersion: 1,
    })
    expect(versionWrite()?.data).toMatchObject({
      subject: 'Spring sale',
      preheader: 'Ends Sunday',
    })
  })

  it('does not stamp a review verdict a publisher would be writing about themselves', async () => {
    await publish()
    expect(versionWrite()?.data).not.toHaveProperty('reviewState')
  })

  it('records the outbound link hosts on the version, for the listing page', async () => {
    state.version = {
      nodes: block('emailButton', { href: 'https://shop.example/sale' }),
    }
    const res = await publish()
    expect(res.statusCode).toBe(200)
    expect(versionWrite()?.data['linkHosts']).toEqual(['shop.example'])
  })
})

describe('the source is a compressed screen version', () => {
  /**
   * What firebase-admin hands back for a bytes field: a Node `Buffer` carved
   * out of the shared pool, so `byteOffset` is non-zero. A zero-offset buffer
   * would let the byteOffset bug pass by luck.
   */
  const pooled = (value: unknown) => {
    const bytes = compress(value)
    const pool = Buffer.allocUnsafeSlow(Buffer.poolSize)
    const packed = pool.subarray(64, 64 + bytes.byteLength)
    packed.set(bytes)
    return packed
  }

  it('publishes a design the besigner saved, rather than calling it empty', async () => {
    state.version = { nodes: pooled(block('emailText', { children: 'Hi there' })) }
    const res = await publish()
    expect(res.statusCode).toBe(200)
    // A decoded map, not the publisher's bytes, so every installer reads the
    // same shape whichever form the source happened to be in.
    expect(Object.keys(versionWrite()?.data['nodes'] as object)).toContain('one')
  })

  it('finds a tracking pixel hidden inside the compressed form', async () => {
    state.version = {
      nodes: pooled(
        block('emailImage', { src: 'https://publisher.example/open.gif' }),
      ),
    }
    expect((await publish()).statusCode).toBe(422)
  })
})

describe('a design that would leak a recipient is refused, not trimmed', () => {
  it('refuses a remote image', async () => {
    state.version = {
      nodes: block('emailImage', { src: 'https://publisher.example/open.gif' }),
    }
    const res = await publish()
    expect(res.statusCode).toBe(422)
    expect(res.body.violations[0]).toMatchObject({ code: 'remote-asset' })
    // Nothing published at all — not a listing with the image quietly gone.
    expect(state.writes).toHaveLength(0)
  })

  it('refuses an http link', async () => {
    state.version = { nodes: block('emailButton', { href: 'http://shop.example' }) }
    expect((await publish()).statusCode).toBe(422)
    expect(state.writes).toHaveLength(0)
  })

  it('refuses a merge tag in a link', async () => {
    state.version = {
      nodes: block('emailButton', {
        href: 'https://shop.example/?e={{contact.email}}',
      }),
    }
    const res = await publish()
    expect(res.statusCode).toBe(422)
    expect(res.body.violations[0]).toMatchObject({ code: 'merge-tag-in-url' })
  })

  it('refuses a rich-text block, whose content is raw markup', async () => {
    state.version = {
      nodes: block('emailRichtext', {
        html: '<img src="https://publisher.example/open.gif">',
      }),
    }
    expect((await publish()).statusCode).toBe(422)
    expect(state.writes).toHaveLength(0)
  })

  it('refuses a rich-text block even when it carries no markup yet', async () => {
    /*
     * Two independent refusals guard the same block and this one names the
     * allowlist. The test above trips the `html` prop rule and would stay
     * green with `emailRichtext` back on the list — so on its own it proves
     * nothing about the subtraction, only about the prop. An empty rich-text
     * block has no prop to trip, so the only thing that can refuse it is the
     * component id, and the design would otherwise publish and grow its
     * markup in whatever the buyer's editor allows.
     */
    state.version = { nodes: block('emailRichtext', {}) }
    const res = await publish()
    expect(res.statusCode).toBe(422)
    expect(res.body.error).toContain('emailRichtext')
    expect(state.writes).toHaveLength(0)
  })

  it('CONTROL: the blocks it does allow still publish', async () => {
    // So the assertion above is about `emailRichtext` and not about every
    // block failing for some unrelated reason.
    state.version = { nodes: block('emailButton', { children: 'Shop now' }) }
    expect((await publish()).statusCode).toBe(200)
  })
})

describe('the source has to be a saved campaign email', () => {
  it('refuses a page screen', async () => {
    state.screen = { kind: 'page', versionId: 'v1' }
    expect((await publish()).statusCode).toBe(422)
  })

  it('refuses a screen that was opened and never saved', async () => {
    state.screen = { kind: 'email' }
    expect((await publish()).statusCode).toBe(404)
  })

  it('refuses a deleted screen', async () => {
    state.screen = { kind: 'email', versionId: 'v1', deletedAt: 'THEN' }
    expect((await publish()).statusCode).toBe(404)
  })
})
