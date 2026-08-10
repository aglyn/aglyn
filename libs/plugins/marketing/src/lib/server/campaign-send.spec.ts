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
 * What a designed campaign actually puts in a recipient's inbox (AGL-1394).
 *
 * Every other instance of the two-storage-forms trap under-reports to a
 * console user who can go and look. This one is the only one that ships wrong
 * output to THIRD PARTIES: the send goes out, nobody is told anything, and the
 * first people to notice the missing product blocks are the customers.
 *
 * So these assertions are deliberately made against the delivered payload —
 * the arguments `sendEmail` was actually called with — rather than against
 * `loadEmailTemplate`'s return value. A decode that is correct but never
 * reaches the HTML is worth nothing here.
 */

const mockState: {
  store: Record<string, Record<string, unknown>>
  sent: Array<Record<string, any>>
} = { store: {}, sent: [] }

// The module graph behind `@aglyn/tenant-data-admin` reaches the admin SDK,
// which does not load under the jest environment. Nothing real is needed:
// `performCampaignSend` takes its firestore from `firebaseAdmin`.
jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({ firestore: () => mockFirestore() }),
    firestore: {
      FieldValue: {
        increment: (value: number) => ({ increment: value }),
        serverTimestamp: () => 'server-timestamp',
      },
    },
  },
  // A plan whose emailSendsPerMonth is non-zero, or the cap refuses the send
  // before any of this is reached. Free is 0 by design.
  getOrgForHost: async () => ({ orgId: 'org-1', org: { plan: 'starter' } }),
  orgDataCollectionForHost: jest.fn(),
  orgDataQueryForHost: jest.fn(),
}))

// Only the two I/O functions are stubbed — `renderEmailHtml` and the merge
// helpers come through the same barrel and must stay REAL, because the HTML
// they produce is the thing under test.
jest.mock('@aglyn/shared-util-email', () => ({
  ...jest.requireActual('@aglyn/shared-util-email'),
  isEmailConfigured: () => true,
  sendEmail: async (message: Record<string, unknown>) => {
    mockState.sent.push(message)
    return { sent: true }
  },
}))

import { compress } from '@aglyn/aglyn/server'
import { CampaignSendError, performCampaignSend } from './campaign-send'

/** The id the besigner roots every stored node map at. */
const ROOT = '_@_'

/**
 * A designed email exactly as `createEmailScreen` + the screen besigner leave
 * it: rooted at `_@_`, one section, a greeting carrying a merge token, a
 * picked image stored as a `media:` reference, and the product block this
 * issue is named for.
 */
const NODES: Record<string, unknown> = {
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['sec'] },
  sec: {
    $id: 'sec',
    componentId: 'emailSection',
    pluginId: 'email',
    parentId: ROOT,
    nodes: ['txt', 'img', 'prod'],
  },
  txt: {
    $id: 'txt',
    componentId: 'emailText',
    props: { children: 'Hi {{contact.firstName}}, the sale is on.' },
  },
  img: {
    $id: 'img',
    componentId: 'emailImage',
    props: { src: 'media:host-1/banner1', alt: 'Spring sale' },
  },
  prod: {
    $id: 'prod',
    componentId: 'emailProduct',
    props: { productId: 'prod-1', buttonLabel: 'Shop the chair' },
  },
}

/**
 * What firebase-admin actually hands back for a `Bytes` field: a Node
 * `Buffer` carved out of the shared allocation pool, so `byteOffset` is
 * non-zero and `buffer.byteLength` is the whole pool rather than the field.
 *
 * Carved from a slab of our own rather than `Buffer.from`, which draws on the
 * real pool and lands at whatever offset the rest of the process left behind
 * — 0 whenever the pool has just been replaced. A zero-offset buffer would
 * let the byteOffset bug pass by luck, which is exactly the bug most likely
 * to come back. Mirrors the helper in `stored-nodes.spec.ts`.
 */
const pooledBuffer = (value: unknown = NODES) => {
  const bytes = compress(value)
  const pool = Buffer.allocUnsafeSlow(Buffer.poolSize)
  const packed = pool.subarray(64, 64 + bytes.byteLength)
  packed.set(bytes)
  return packed
}

/**
 * A path-keyed Firestore stand-in covering only the shapes this send makes:
 * doc gets, `collection(...).limit(...).get()`, and merge sets.
 */
function mockFirestore(): any {
  const store = mockState.store
  const snapshot = (path: string) => {
    const data = store[path]
    return {
      exists: data !== undefined,
      id: path.split('/').pop(),
      data: () => data,
      get: (field: string) => data?.[field],
    }
  }
  const docRef = (path: string): any => ({
    id: path.split('/').pop(),
    path,
    get: async () => snapshot(path),
    set: async (value: Record<string, unknown>) => {
      store[path] = { ...(store[path] ?? {}), ...value }
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  })
  const collectionRef = (path: string): any => ({
    doc: (id: string) => docRef(`${path}/${id}`),
    limit: () => ({
      get: async () => ({
        docs: Object.keys(store)
          .filter(
            (key) =>
              key.startsWith(`${path}/`) &&
              !key.slice(path.length + 1).includes('/'),
          )
          .map(snapshot),
      }),
    }),
    get parent() {
      return docRef(path.split('/').slice(0, -1).join('/'))
    },
  })
  return { collection: (name: string) => collectionRef(name) }
}

/** Seeds a site, a lead, a designed email screen, and its product. */
function seed(nodes: unknown) {
  mockState.store = {
    'hosts/host-1': { subdomain: 'acme', memberRoles: {} },
    // A `leads` audience so the merge tags have a real name to resolve.
    'hosts/host-1/leads/lead-1': {
      email: 'dana@example.com',
      name: 'Dana Reed',
    },
    'hosts/host-1/screens/screen-1': {
      kind: 'email',
      versionId: 'v1',
      emailSubject: 'Spring sale',
      emailPreheader: 'Ends Sunday',
    },
    'hosts/host-1/screens/screen-1/versions/v1': { nodes },
    'hosts/host-1/products/prod-1': {
      name: 'Aeron Chair',
      slug: 'aeron-chair',
      variants: [{ priceUsd: 995 }],
    },
  }
  mockState.sent = []
}

const send = () =>
  performCampaignSend({
    hostId: 'host-1',
    subject: 'Spring sale',
    body: 'plain-text fallback',
    audience: 'leads',
    templateScreenId: 'screen-1',
    // Skips the campaign record + counter writes; the delivered payload is
    // identical either way.
    recordCampaign: false,
    senderUid: 'uid-1',
  })

let previousSecret: string | undefined
beforeAll(() => {
  previousSecret = process.env['EMAIL_UNSUBSCRIBE_SECRET']
  process.env['EMAIL_UNSUBSCRIBE_SECRET'] = 'test-secret'
})
afterAll(() => {
  if (previousSecret === undefined) {
    delete process.env['EMAIL_UNSUBSCRIBE_SECRET']
  } else {
    process.env['EMAIL_UNSUBSCRIBE_SECRET'] = previousSecret
  }
})

/**
 * A `kind: 'email'` screen is a SCREEN document. `createEmailScreen` writes it
 * under `hosts/{h}/screens/{id}` and the Emails list opens it in the screen
 * besigner, which saves through `use-screen-version`'s converter —
 * `Bytes.fromUint8Array(compress(nodes))`. Only the very first version, the
 * one created from a JSON body through `/api/hosts/versions`, is a plain map;
 * the first save in the designer converts it.
 *
 * The neighbouring `publish-email-template.ts` reading `nodes` raw is NOT
 * evidence that this is fine — it reads `emailTemplates`, a different
 * collection whose besigner saves with a bare `setDoc` and no converter, so
 * those really are plain maps.
 */
describe('a designed campaign whose version is stored compressed (AGL-1394)', () => {
  it('delivers the emailProduct block, not a Buffer', async () => {
    seed(pooledBuffer())
    // Guard the premise: on a zero-offset buffer the byteOffset bug passes.
    const stored = mockState.store['hosts/host-1/screens/screen-1/versions/v1']
    expect((stored['nodes'] as Buffer).byteOffset).toBeGreaterThan(0)

    await expect(send()).resolves.toMatchObject({ recipients: 1, sent: 1 })

    const [message] = mockState.sent
    // The product block is the whole point: resolved by id from the node
    // tree, priced from the catalog, linked absolute for an inbox.
    expect(message['html']).toContain('Aeron Chair')
    expect(message['html']).toContain('$995')
    expect(message['html']).toContain('https://acme.aglyn.app/products/aeron-chair')
    expect(message['html']).toContain('Shop the chair')
    // …and the rest of the design, which travelled in the same Buffer.
    expect(message['html']).toContain('Hi Dana, the sale is on.')
    // The plain-text alternative is built from the same walk. Empty here is
    // the "garbage body" a recipient sees: an unsubscribe footer and nothing
    // above it.
    expect(message['text']).toContain('Hi Dana, the sale is on.')
    expect(message['text']).toContain('Aeron Chair — $995')
  })

  /**
   * The renderer defaults `rootId` to `'root'` for ad-hoc callers, and a
   * besigner map is rooted at `'_@_'` — so a decode that is correct still
   * renders NOTHING unless the root is named (AGL-765). Both other send
   * paths, `renderLoadedSystemEmail` and `renderLoadedHostEmail`, pass it.
   */
  it('renders from the besigner root rather than the default "root"', async () => {
    seed(pooledBuffer())
    await send()

    const [message] = mockState.sent
    // The 600px shell renders whether or not a root was found, so assert on
    // the CONTENT — an empty shell is what shipped before. The section is the
    // first thing under the root, so its wrapper proves the root resolved.
    expect(message['html']).toContain('background-color:#ffffff')
    // And the text alternative is not just the unsubscribe footer.
    expect(String(message['text']).trim().startsWith('—')).toBe(false)
  })

  /**
   * A picked image is stored as `media:{scope}/{mediaId}` and resolves to a
   * SITE-RELATIVE CDN path. Without an origin the renderer DROPS it (AGL-1224)
   * — every image an author picked is simply absent from the delivered mail.
   */
  it('absolutizes a picked image against the site origin', async () => {
    seed(pooledBuffer())
    await send()

    expect(mockState.sent[0]['html']).toContain(
      'https://acme.aglyn.app/api/media/cdn/host-1/banner1',
    )
  })

  /**
   * The empty-template guard exists to stop exactly this outcome, and the raw
   * read is what defeats it: `Object.keys` of a Buffer yields the byte
   * INDICES, so a compressed version reads as a populated template. Once the
   * bytes are decoded the guard sees the truth — an undecodable payload
   * refuses the send instead of mailing an empty design to real customers.
   */
  it('refuses the send when the stored bytes do not decode', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      seed(Buffer.from([0xc1, 0xc1, 0xc1]))
      // The premise: the guard's own test cannot see anything wrong here.
      expect(
        Object.keys(
          mockState.store['hosts/host-1/screens/screen-1/versions/v1'][
            'nodes'
          ] as object,
        ).length,
      ).toBeGreaterThan(0)

      await expect(send()).rejects.toThrow('The email template is empty')
      await expect(send()).rejects.toBeInstanceOf(CampaignSendError)
      expect(mockState.sent).toHaveLength(0)
    } finally {
      spy.mockRestore()
    }
  })

  /** Both storage forms must agree — the first version is still a plain map. */
  it('still delivers a plain-map version unchanged', async () => {
    seed(NODES)
    await expect(send()).resolves.toMatchObject({ sent: 1 })

    expect(mockState.sent[0]['html']).toContain('Aeron Chair')
    expect(mockState.sent[0]['html']).toContain('Hi Dana, the sale is on.')
  })

  it('still refuses a template with no nodes at all', async () => {
    seed(undefined)
    await expect(send()).rejects.toThrow('The email template is empty')
    expect(mockState.sent).toHaveLength(0)
  })
})
