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
 * Publishing a site's transactional email design that places one of the
 * site's reusable blocks (AGL-3287).
 *
 * The listing installs into another org, which has none of this site's
 * components, so each placement has to travel as the blocks it renders — and
 * the allowlist refuses a component reference outright. The starter publisher
 * next door holds the same rule for campaign emails.
 */

const ROOT = '_@_'

const state = {
  template: {} as Record<string, unknown>,
  version: {} as Record<string, unknown>,
  components: {} as Record<string, Record<string, unknown>>,
  writes: [] as Array<{ path: string; data: Record<string, unknown> }>,
}

jest.mock('@aglyn/aglyn/server', () => ({
  createResourceUid: () => 'listing-new',
  checkEntitlement: () => true,
  decodeStoredNodes: jest.requireActual('@aglyn/aglyn/app-utils/stored-nodes')
    .decodeStoredNodes,
}))

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({
    orgId: 'seller-org',
    permissions: { publishToMarketplace: true },
  }),
}))

jest.mock('./publisher-profile', () => ({
  resolvePublisherProfile: async () => ({
    orgId: 'seller-org',
    handle: 'acme',
  }),
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
      if (path === 'hosts/host-1/emailTemplates/booking-confirmed') {
        return snapshotOf(state.template)
      }
      if (
        path.startsWith(
          'hosts/host-1/emailTemplates/booking-confirmed/versions/',
        )
      ) {
        return snapshotOf(state.version)
      }
      const component = /^hosts\/host-1\/components\/([^/]+)$/.exec(path)
      if (component && state.components[component[1]]) {
        return snapshotOf(state.components[component[1]])
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
        firestore: () => ({
          collection: (name: string) => collectionRef(name),
        }),
      }),
      firestore: {
        FieldValue: {
          serverTimestamp: () => 'NOW',
          arrayUnion: (v: unknown) => [v],
        },
        Timestamp: { now: () => 'NOW' },
      },
    },
  }
})

import { EMAIL_UNRESOLVED_BLOCK_REFUSAL } from './publish-email-blocks'
import { publishEmailTemplateHandler } from './publish-email-template'

async function publish() {
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
  await publishEmailTemplateHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: {
        hostId: 'host-1',
        templateKey: 'booking-confirmed',
        displayName: 'Friendly confirmation',
      },
    } as any,
    res,
  )
  return res
}

/** The site's header: one section holding its title line. */
const HEADER = {
  rootId: 'hdr',
  props: [{ name: 'title', type: 'text', defaultValue: 'Acme' }],
  nodes: {
    hdr: { $id: 'hdr', componentId: 'emailSection', nodes: ['hdrText'] },
    hdrText: {
      $id: 'hdrText',
      componentId: 'emailText',
      parentId: 'hdr',
      props: { children: 'Acme header: {{prop.title}}' },
    },
  },
}

const PLACED = {
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['top', 'body'] },
  top: {
    $id: 'top',
    componentId: 'reusableInstance',
    parentId: ROOT,
    props: { refId: 'header-1', propValues: { title: 'Bookings' } },
    nodes: [],
  },
  body: {
    $id: 'body',
    componentId: 'emailText',
    pluginId: 'email',
    parentId: ROOT,
    props: { children: 'Hi {{name}}, you are booked.' },
  },
}

const versionWrite = () =>
  state.writes.find((write) => write.path.includes('/versions/'))

beforeEach(() => {
  state.writes = []
  state.components = {}
  state.template = { versionId: 'v1', subject: 'Booked' }
  state.version = { nodes: PLACED }
})

describe('a transactional design placing the site’s header', () => {
  it('publishes the header as blocks, with the placement’s value baked in', async () => {
    state.components['header-1'] = HEADER
    const res = await publish()
    expect(res.statusCode).toBe(200)
    const nodes = versionWrite()?.data['nodes'] as Record<string, any>
    const published = Object.values(nodes)
    expect(
      published.some((node) => node.componentId === 'reusableInstance'),
    ).toBe(false)
    expect(published.map((node) => node.props?.children)).toEqual(
      expect.arrayContaining([
        'Acme header: Bookings',
        'Hi {{name}}, you are booked.',
      ]),
    )
    // Nothing of the placement's bookkeeping travels: the reference, the
    // property values and the override slices are all consumed by the graft.
    expect(JSON.stringify(nodes)).not.toContain('header-1')
    expect(JSON.stringify(nodes)).not.toContain('propValues')
  })

  it('refuses the publish when the header was deleted, rather than dropping it', async () => {
    state.components['header-1'] = { ...HEADER, deletedAt: 'THEN' }
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const res = await publish()
      expect(res.statusCode).toBe(422)
      expect(res.body.error).toBe(EMAIL_UNRESOLVED_BLOCK_REFUSAL)
      expect(state.writes).toHaveLength(0)
    } finally {
      warn.mockRestore()
    }
  })

  it('CONTROL: a design placing nothing publishes as it always did', async () => {
    state.version = {
      nodes: {
        [ROOT]: { ...PLACED[ROOT], nodes: ['body'] },
        body: PLACED.body,
      },
    }
    const res = await publish()
    expect(res.statusCode).toBe(200)
    expect(Object.keys(versionWrite()?.data['nodes'] as object).sort()).toEqual(
      [ROOT, 'body'],
    )
  })
})
