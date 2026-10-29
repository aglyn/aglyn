/**
 * @jest-environment node
 */
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

import { createHash } from 'crypto'
import { registerPluginPersonRecords } from '@aglyn/aglyn/plugin-manager/plugin-person-records'
import { registerCustomerDisplayVerifier, type VerifiedCustomerDisplay } from '@aglyn/aglyn/plugin-manager/plugin-customer-display-verifier'
import { resetPluginServicesForTests, unregisterPluginServices } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { createMemoryFirestore, type MemoryFirestore } from '../testing/memory-firestore'
import { setWaiversDbForTests, setWaiversFilesForTests } from './db'
import { displayScreenRoute, signOnDisplayRoute } from './display-routes'
import { setWaiversEmailSenderForTests, type WaiverEmail } from './emails'
import { signedCopyPath, signedCopyRoute } from './signed-copy'
import { setWaiversGateDepsForTests } from './gate'
import { eraseWaiversPerson, setWaiversErasureDepsForTests } from './person-eraser'
import { publicSignRoute, publicWaiverRoute } from './public-routes'
import { runWaiversRetentionJob } from './retention-job'
import { backfillWaiverNameDobKeys } from './name-dob-backfill'
import { setWaiversClockForTests } from './sign'
import {
  paperRoute,
  signAtWindowRoute,
  signatureFileRoute,
  signaturePdfRoute,
  signatureRoute,
  signaturesRoute,
  statusRoute,
} from './signature-routes'
import { templateRoute, templatesRoute } from './template-routes'

/**
 * The waivers routes (AGL-4042): who may write a waiver and read who signed,
 * the version every saved change starts, the public doors a signer uses with
 * no account (honeypot, rate limit, a press retried once), the window's
 * tablet, a paper waiver with its photo, search, export, the signed PDF,
 * voiding, a person's status for a day, erasure (which keeps a signed waiver
 * for the store's retention period) and the retention job that deletes it.
 */

const captures: Array<Record<string, unknown>> = []
let rateAllowed = true

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => ({}), auth: () => ({}), storage: () => ({ bucket: () => ({ deleteFiles: async () => undefined }) }) }) },
  getOrgForHost: async () => null,
  consumeRateLimit: async () => ({ allowed: rateAllowed, resetMs: Date.now() + 30_000 }),
  hostSendingIdentity: async () => null,
  meterHostEmail: async () => undefined,
  renderHostEmailWithTokens: async () => null,
}))
jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  isEmailVerified: (decoded: { email_verified?: boolean }) => decoded.email_verified === true,
  isImpersonationSession: () => false,
}))
jest.mock('@aglyn/tenant-data-admin/server/id-token-refusal', () => ({ isRefusedIdToken: () => true }))
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({ resolveOrgPermissions: async () => ({ permissions: {} }) }))
jest.mock('@aglyn/shared-util-email', () => ({ isEmailConfigured: () => true, sendEmail: async () => ({ sent: true }) }))
jest.mock('@aglyn/aglyn/plugin-manager/record-captured-contact', () => ({
  __esModule: true,
  default: async (request: Record<string, unknown>) => {
    captures.push(request)
    return { ok: true, record: 'contact', contactId: 'contact-1', created: true }
  },
}))

const ORG = 'org-track'
const HOST = 'host-track'
const OTHER_HOST = 'host-other'
const NOW = Date.UTC(2026, 9, 24, 15, 0) // 10:00 in Chicago, Oct 24

const TOKENS: Record<string, Record<string, unknown> & { uid: string }> = {
  'tok-admin': { uid: 'uid-admin', email: 'ada@example.com', name: 'Ada Admin', email_verified: true },
  'tok-clerk': { uid: 'uid-clerk', email: 'sam@example.com', name: 'Sam Clerk', email_verified: true },
  'tok-viewer': { uid: 'uid-viewer', email: 'vic@example.com', email_verified: true },
  'tok-window': { uid: 'uid-window', email: 'wes@example.com', name: 'Wes Window', email_verified: true },
  'tok-narrowed': { uid: 'uid-narrowed', email: 'nia@example.com', email_verified: true },
  'tok-unverified': { uid: 'uid-admin', email: 'ada@example.com', email_verified: false },
}
/** What each member's role resolves to. The clerk may take signatures and not write waivers. */
const PERMISSIONS: Record<string, Record<string, boolean>> = {
  'uid-admin': { manageWaivers: true, collectWaivers: true },
  'uid-clerk': { manageWaivers: false, collectWaivers: true },
  'uid-viewer': {},
  // A site viewer the workspace trusts at the window (AGL-4047): granted
  // `collectWaivers` by a custom role or an override, with no editor role.
  'uid-window': { manageWaivers: false, collectWaivers: true },
  // A site admin a custom role took both keys from.
  'uid-narrowed': { manageWaivers: false, collectWaivers: false },
}

let db: MemoryFirestore
let sent: WaiverEmail[]
let files: Map<string, Uint8Array>
let plan = 'starter'
/** Each site's waiver retention period, in years, as its settings resolve. */
let retentionYears: Record<string, number> = {}

beforeEach(() => {
  db = createMemoryFirestore()
  setWaiversDbForTests(db)
  sent = []
  files = new Map()
  captures.length = 0
  rateAllowed = true
  plan = 'starter'
  setWaiversEmailSenderForTests(async (email) => {
    sent.push(email)
    return true
  })
  setWaiversFilesForTests({
    save: async (path, bytes) => {
      files.set(path, bytes)
    },
    read: async (path) => files.get(path) ?? null,
  })
  setWaiversClockForTests(() => NOW)
  retentionYears = {}
  setWaiversErasureDepsForTests({
    bucket: () => ({
      deleteFiles: async ({ prefix }) => {
        for (const path of [...files.keys()]) if (path.startsWith(prefix)) files.delete(path)
      },
    }),
    retentionYears: async (_orgId, hostId) => retentionYears[hostId] ?? 7,
  })
  setWaiversGateDepsForTests({
    verifyIdToken: async (token) => {
      const decoded = TOKENS[token]
      if (!decoded) throw new Error('refused')
      return decoded
    },
    permissions: async (uid) => PERMISSIONS[uid] ?? {},
    memberName: async (uid) => {
      const decoded = Object.values(TOKENS).find((one) => one.uid === uid)
      return (decoded?.['name'] as string | undefined) ?? (decoded?.['email'] as string | undefined) ?? null
    },
    orgForHost: async (hostId) =>
      hostId === HOST || hostId === OTHER_HOST ? { orgId: ORG, org: { id: ORG, plan } } : null,
  })
  for (const hostId of [HOST, OTHER_HOST]) {
    db.docs.set(`hosts/${hostId}`, {
      displayName: 'Acme Motocross',
      timeZone: 'America/Chicago',
      // The site's own addresses: the track on its platform address, the
      // other site on a custom domain that serves.
      ...(hostId === HOST ? { subdomain: 'acme-track' } : { subdomain: 'acme-other', cname: 'rides.example.com' }),
      memberRoles: {
        'uid-admin': 'admin',
        'uid-clerk': 'editor',
        'uid-viewer': 'viewer',
        'uid-window': 'viewer',
        'uid-narrowed': 'admin',
      },
    })
  }
})

afterAll(() => {
  setWaiversDbForTests(null)
  setWaiversFilesForTests(null)
  setWaiversEmailSenderForTests(null)
  setWaiversGateDepsForTests(null)
  setWaiversClockForTests(null)
  setWaiversErasureDepsForTests(null)
})

function call(
  route: (request: Request) => Promise<Response>,
  method: 'GET' | 'POST',
  options: { token?: string | null; query?: Record<string, string>; body?: Record<string, unknown>; host?: string } = {},
) {
  const query = new URLSearchParams(method === 'GET' ? { hostId: options.host ?? HOST, ...(options.query ?? {}) } : options.query ?? {}).toString()
  const token = options.token === undefined ? 'tok-admin' : options.token
  return route(
    new Request(`https://console.test/api/waivers/x${query ? `?${query}` : ''}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone) Spec',
        'x-forwarded-for': '203.0.113.7',
        origin: 'https://acme.example.com',
      },
      ...(method === 'POST' ? { body: JSON.stringify({ hostId: options.host ?? HOST, ...(options.body ?? {}) }) } : {}),
    }),
  )
}

const WAIVER = {
  title: 'Rider release',
  body: 'Motocross is **dangerous**.\n\n- Wear a helmet',
  checkboxes: [{ id: 'read', label: 'I have read this waiver.' }],
  allowMinors: true,
  validity: { kind: 'visit' },
}

async function publishedWaiver(overrides: Record<string, unknown> = {}): Promise<{ id: string; version: number }> {
  const created = await (await call(templatesRoute, 'POST', { body: { waiver: { ...WAIVER, ...overrides } } })).json()
  await call(templateRoute, 'POST', { body: { waiverId: created.waiver.id, action: 'publish' } })
  return { id: created.waiver.id, version: created.waiver.version }
}

const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64')}`
const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64')}`

function signing(waiver: { id: string; version: number }, overrides: Record<string, unknown> = {}) {
  return {
    attemptKey: 'attempt-0001',
    waiverId: waiver.id,
    version: waiver.version,
    signer: { name: 'Jordan Lee', email: 'jordan@example.com', phone: '555 0100', dateOfBirth: '1990-04-02' },
    minors: [{ name: 'Pat Lee', dateOfBirth: '2014-09-30' }],
    guardianRelationship: 'Parent',
    checked: ['read'],
    signature: { kind: 'drawn', strokes: [[[10, 10], [20, 30], [40, 60], [80, 90]]] },
    signatureImage: PNG,
    consent: true,
    ...overrides,
  }
}

const signatures = () =>
  [...db.docs.entries()].filter(([path]) => path.startsWith(`orgs/${ORG}/waiverSignatures/`)).map(([, data]) => data)

describe('who may write waivers', () => {
  it('refuses no token, an unverified address, a viewer, a member without the permission, and a plan that does not sell', async () => {
    expect((await call(templatesRoute, 'GET', { token: null })).status).toBe(401)
    expect((await call(templatesRoute, 'GET', { token: 'tok-unverified' })).status).toBe(403)
    expect((await call(templatesRoute, 'GET', { token: 'tok-viewer' })).status).toBe(403)
    expect((await call(templatesRoute, 'POST', { token: 'tok-clerk', body: { waiver: WAIVER } })).status).toBe(403)
    plan = 'free'
    const free = await call(templatesRoute, 'GET')
    expect(free.status).toBe(403)
    expect((await free.json()).error).toMatch(/plans that include the store/)
  })

  it('lets the window clerk read the site’s waivers to pick one', async () => {
    await publishedWaiver()
    const answer = await call(templatesRoute, 'GET', { token: 'tok-clerk' })
    expect(answer.status).toBe(200)
    expect((await answer.json()).waivers).toHaveLength(1)
  })
})

describe('writing a waiver', () => {
  it('creates version 1 as a draft and freezes its words', async () => {
    const response = await call(templatesRoute, 'POST', { body: { waiver: WAIVER } })
    expect(response.status).toBe(201)
    const { waiver } = await response.json()
    expect(waiver).toMatchObject({ title: 'Rider release', status: 'draft', version: 1, hostId: HOST, orgId: ORG })
    expect(db.docs.get(`orgs/${ORG}/waivers/${waiver.id}/versions/1`)).toMatchObject({ version: 1, body: WAIVER.body })
  })

  it('starts a new version for a change to the words, and none for a save that changes nothing', async () => {
    const { waiver } = await (await call(templatesRoute, 'POST', { body: { waiver: WAIVER } })).json()
    const same = await (await call(templatesRoute, 'POST', { body: { waiverId: waiver.id, waiver: WAIVER } })).json()
    expect(same.waiver.version).toBe(1)
    const changed = await (
      await call(templatesRoute, 'POST', { body: { waiverId: waiver.id, waiver: { ...WAIVER, body: `${WAIVER.body}\n\nNo passengers.` } } })
    ).json()
    expect(changed.waiver.version).toBe(2)
    const history = await (await call(templateRoute, 'GET', { query: { waiverId: waiver.id } })).json()
    expect(history.versions.map((row: { version: number }) => row.version)).toEqual([2, 1])
  })

  it('refuses a draft with something to fix, and another site’s waiver', async () => {
    const bad = await call(templatesRoute, 'POST', { body: { waiver: { ...WAIVER, title: '' } } })
    expect(bad.status).toBe(400)
    const { id } = await publishedWaiver()
    expect((await call(templatesRoute, 'POST', { host: OTHER_HOST, body: { waiverId: id, waiver: WAIVER } })).status).toBe(404)
    expect((await call(templateRoute, 'GET', { host: OTHER_HOST, query: { waiverId: id } })).status).toBe(404)
  })
})

describe('the waiver picker’s list (the site’s waiverTitles)', () => {
  const title = (id: string) => db.docs.get(`hosts/${HOST}/waiverTitles/${id}`)

  it('mirrors each waiver’s title and status on every write, and nothing of its words', async () => {
    const { waiver } = await (await call(templatesRoute, 'POST', { body: { waiver: WAIVER } })).json()
    expect(title(waiver.id)).toEqual({ title: 'Rider release', status: 'draft', pickable: true, version: 1, updatedAtMs: waiver.updatedAtMs })
    await call(templatesRoute, 'POST', { body: { waiverId: waiver.id, waiver: { ...WAIVER, title: 'Pit pass' } } })
    expect(title(waiver.id)).toMatchObject({ title: 'Pit pass', version: 2, pickable: true })
    await call(templateRoute, 'POST', { body: { waiverId: waiver.id, action: 'publish' } })
    expect(title(waiver.id)).toMatchObject({ status: 'published', pickable: true })
    await call(templateRoute, 'POST', { body: { waiverId: waiver.id, action: 'retire' } })
    expect(title(waiver.id)).toMatchObject({ status: 'retired', pickable: false })
    expect(JSON.stringify(title(waiver.id))).not.toContain('helmet')
    // Another site's list is untouched.
    expect([...db.docs.keys()].some((path) => path.startsWith(`hosts/${OTHER_HOST}/waiverTitles/`))).toBe(false)
  })

  it('mirrors a waiver written before the list existed the next time the site’s waivers are read, once', async () => {
    const { waiver } = await (await call(templatesRoute, 'POST', { body: { waiver: WAIVER } })).json()
    const path = `orgs/${ORG}/waivers/${waiver.id}`
    const older = { ...(db.docs.get(path) as Record<string, unknown>) }
    delete older['listedAtMs']
    db.docs.set(path, older)
    db.docs.delete(`hosts/${HOST}/waiverTitles/${waiver.id}`)
    await call(templatesRoute, 'GET', { token: 'tok-clerk' })
    expect(title(waiver.id)).toMatchObject({ title: 'Rider release', pickable: true })
    expect(db.docs.get(path)).toMatchObject({ listedAtMs: expect.any(Number) })
  })
})

describe('signing before arriving', () => {
  it('serves only a published waiver, and lists the site’s published ones', async () => {
    const draft = await (await call(templatesRoute, 'POST', { body: { waiver: WAIVER } })).json()
    expect((await call(publicWaiverRoute, 'GET', { token: null, query: { waiverId: draft.waiver.id } })).status).toBe(404)
    const waiver = await publishedWaiver({ title: 'Pit pass' })
    const one = await (await call(publicWaiverRoute, 'GET', { token: null, query: { waiverId: waiver.id } })).json()
    expect(one).toMatchObject({ site: { name: 'Acme Motocross' }, waiver: { id: waiver.id, title: 'Pit pass', version: 1 }, adultAge: 18 })
    expect(one.consent.text).toMatch(/sign this waiver electronically/)
    const list = await (await call(publicWaiverRoute, 'GET', { token: null })).json()
    expect(list.waivers).toEqual([{ id: waiver.id, title: 'Pit pass' }])
  })

  it('stores the signature with the exact text, its hash, the window and the audit trail', async () => {
    const waiver = await publishedWaiver()
    const response = await call(publicSignRoute, 'POST', { token: null, body: signing(waiver) })
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ people: ['Jordan Lee', 'Pat Lee'], window: 'Good for Oct 24, 2026', emailed: true })
    const [stored] = signatures()
    expect(stored).toMatchObject({
      hostId: HOST,
      waiverId: waiver.id,
      version: 1,
      method: 'online',
      dayKey: '2026-10-24',
      validThroughDayKey: '2026-10-24',
      timeZone: 'America/Chicago',
      emailLower: 'jordan@example.com',
      guardianRelationship: 'Parent',
      contactId: 'contact-1',
      consent: { agreed: true, version: 2 },
      audit: { ip: '203.0.113.7', userAgent: 'Mozilla/5.0 (iPhone) Spec', signedOnHost: 'acme.example.com', staffUid: null },
    })
    expect(stored.signedTextSha256).toBe(createHash('sha256').update(stored.signedText).digest('hex'))
    expect(stored.signedText).toContain('Motocross is dangerous.')
    // Firestore holds no nested arrays: strokes are flat per stroke.
    expect(stored.signature).toMatchObject({ kind: 'drawn', strokes: [{ points: [10, 10, 20, 30, 40, 60, 80, 90] }] })
    expect(files.has(stored.signature.imagePath)).toBe(true)
    expect(stored.nameTokens).toEqual(expect.arrayContaining(['jordan', 'lee', 'pat']))
    expect(captures[0]).toMatchObject({ orgId: ORG, hostId: HOST, surface: 'relationship', interaction: { source: 'waiver' } })
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe('jordan@example.com')
    expect(sent[0].attachment.contentType).toBe('application/pdf')
    expect(Buffer.from(sent[0].attachment.content, 'base64').subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('stores one signature and sends one email for a press retried', async () => {
    const waiver = await publishedWaiver()
    await call(publicSignRoute, 'POST', { token: null, body: signing(waiver) })
    const again = await call(publicSignRoute, 'POST', { token: null, body: signing(waiver) })
    expect(again.status).toBe(200)
    expect(signatures()).toHaveLength(1)
    expect(sent).toHaveLength(1)
  })

  it('answers a filled honeypot as a success and stores nothing, and limits a flood', async () => {
    const waiver = await publishedWaiver()
    expect((await call(publicSignRoute, 'POST', { token: null, body: { ...signing(waiver), website: 'spam' } })).status).toBe(201)
    expect(signatures()).toHaveLength(0)
    rateAllowed = false
    const limited = await call(publicSignRoute, 'POST', { token: null, body: signing(waiver) })
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBeTruthy()
  })

  it('sends a signer back to read a waiver that changed, and refuses one who missed something', async () => {
    const waiver = await publishedWaiver()
    const stale = await call(publicSignRoute, 'POST', { token: null, body: signing(waiver, { version: 0 }) })
    expect(stale.status).toBe(409)
    expect((await stale.json()).code).toBe('version')
    const minor = await call(publicSignRoute, 'POST', {
      token: null,
      body: signing(waiver, { signer: { name: 'Kid', email: 'kid@example.com', dateOfBirth: '2012-01-01' } }),
    })
    expect(minor.status).toBe(400)
    expect(signatures()).toHaveLength(0)
  })

  it('lasts as long as the waiver says', async () => {
    const waiver = await publishedWaiver({ validity: { kind: 'days', days: 365 } })
    await call(publicSignRoute, 'POST', { token: null, body: signing(waiver) })
    expect(signatures()[0].validThroughDayKey).toBe('2027-10-23')
  })
})

describe('signing at the window', () => {
  it('takes a signature on staff’s tablet, naming who handed it over, with the email optional', async () => {
    const waiver = await publishedWaiver()
    const response = await call(signAtWindowRoute, 'POST', {
      token: 'tok-clerk',
      body: signing(waiver, { signer: { name: 'Jordan Lee', email: '', phone: '', dateOfBirth: '1990-04-02' }, signature: { kind: 'typed', text: 'Jordan Lee' } }),
    })
    expect(response.status).toBe(201)
    const [stored] = signatures()
    expect(stored).toMatchObject({ method: 'at_window', signature: { kind: 'typed', text: 'Jordan Lee' }, audit: { staffUid: 'uid-clerk', staffName: 'Sam Clerk' } })
    expect(sent).toHaveLength(0)
    expect(captures).toHaveLength(0)
  })

  it('refuses a viewer', async () => {
    const waiver = await publishedWaiver()
    expect((await call(signAtWindowRoute, 'POST', { token: 'tok-viewer', body: signing(waiver) })).status).toBe(403)
  })

  it('decides by the key, not the role: a viewer granted collectWaivers takes it, an admin refused it does not (AGL-4047)', async () => {
    const waiver = await publishedWaiver()
    const taken = await call(signAtWindowRoute, 'POST', { token: 'tok-window', body: signing(waiver) })
    expect(taken.status).toBe(201)
    expect((await call(signaturesRoute, 'GET', { token: 'tok-window' })).status).toBe(200)
    // Collecting is not writing waivers.
    expect((await call(templatesRoute, 'POST', { token: 'tok-window', body: { waiver: WAIVER } })).status).toBe(403)
    expect((await call(signAtWindowRoute, 'POST', { token: 'tok-narrowed', body: signing(waiver) })).status).toBe(403)
    expect((await call(templatesRoute, 'GET', { token: 'tok-narrowed' })).status).toBe(403)
  })
})

describe('signing on the register’s paired customer display (AGL-4042)', () => {
  /**
   * The paired displays, as the plugin that pairs them vouches for them
   * through core's verifier: one at this track, one at the other site. What
   * each shows changes as the register sends it something.
   */
  const TRACK_DISPLAY = 'display-track-0123456789abcdef'
  const OTHER_DISPLAY = 'display-other-0123456789abcdef'
  const displays = new Map<string, VerifiedCustomerDisplay>()
  const waiverScreen = (hostId: string) => ({ pluginId: 'waivers', path: '/display-sign', params: { host: hostId } })
  const waiverScreenFor = (hostId: string, shownBy = 'uid-clerk'): VerifiedCustomerDisplay => ({
    hostId,
    orgId: ORG,
    screen: waiverScreen(hostId),
    shownBy,
  })
  /** Staff send the site's waiver to a display. */
  const send = (credential: string, hostId: string, shownBy = 'uid-clerk') =>
    displays.set(credential, waiverScreenFor(hostId, shownBy))

  beforeAll(() => {
    registerCustomerDisplayVerifier({ verify: async (credential) => displays.get(credential) ?? null }, { pluginId: 'pos-spec' })
  })
  afterAll(() => unregisterPluginServices('pos-spec'))
  beforeEach(() => {
    displays.clear()
    displays.set(TRACK_DISPLAY, { hostId: HOST, orgId: ORG, screen: null, shownBy: null })
    displays.set(OTHER_DISPLAY, { hostId: OTHER_HOST, orgId: ORG, screen: null, shownBy: null })
  })

  function sign(body: Record<string, unknown>) {
    return call(signOnDisplayRoute, 'POST', { token: null, body })
  }
  async function showing(credential: string, host = HOST) {
    const response = await call(displayScreenRoute, 'POST', { token: null, host, body: { display: credential } })
    return (await response.json()).showing
  }

  it('signs with the display’s pairing and no session, naming the staff member who sent it', async () => {
    const waiver = await publishedWaiver()
    send(TRACK_DISPLAY, HOST)
    const response = await sign({
      ...signing(waiver, { signer: { name: 'Jordan Lee', email: '', phone: '', dateOfBirth: '1990-04-02' } }),
      display: TRACK_DISPLAY,
    })
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ people: ['Jordan Lee', 'Pat Lee'], emailed: false })
    const [stored] = signatures()
    expect(stored).toMatchObject({
      method: 'at_window',
      audit: { staffUid: 'uid-clerk', staffName: 'Sam Clerk', ip: '203.0.113.7' },
    })
    // The display's credential is the key, never part of the record.
    expect(JSON.stringify(stored)).not.toContain(TRACK_DISPLAY)
  })

  it('signs ten minutes after it was sent, and an hour after: nothing on it runs out', async () => {
    const waiver = await publishedWaiver()
    send(TRACK_DISPLAY, HOST)
    setWaiversClockForTests(() => NOW + 10 * 60 * 1000)
    expect(await showing(TRACK_DISPLAY)).toBe(true)
    expect((await sign({ ...signing(waiver), display: TRACK_DISPLAY })).status).toBe(201)
    setWaiversClockForTests(() => NOW + 60 * 60 * 1000)
    expect(await showing(TRACK_DISPLAY)).toBe(true)
    expect((await sign({ ...signing(waiver, { attemptKey: 'next-signer-1' }), display: TRACK_DISPLAY })).status).toBe(201)
    expect(signatures()).toHaveLength(2)
  })

  it('refuses a signing without a valid pairing token, and stores nothing', async () => {
    const waiver = await publishedWaiver()
    send(TRACK_DISPLAY, HOST)
    for (const display of [undefined, '', `${TRACK_DISPLAY}x`, 'not-a-display-0123456789']) {
      const refused = await sign({ ...signing(waiver), ...(display === undefined ? {} : { display }) })
      expect(refused.status).toBe(401)
      expect((await refused.json()).error).toMatch(/isn’t this store’s customer display/)
    }
    expect(await showing(`${TRACK_DISPLAY}x`)).toBe(false)
    expect(signatures()).toHaveLength(0)
  })

  it('refuses a display paired to another store', async () => {
    const waiver = await publishedWaiver()
    send(OTHER_DISPLAY, OTHER_HOST)
    // The other store's display, naming this track.
    const refused = await sign({ ...signing(waiver), display: OTHER_DISPLAY })
    expect(refused.status).toBe(401)
    expect(await showing(OTHER_DISPLAY, HOST)).toBe(false)
    // A display whose store's workspace is not the one the site belongs to now.
    displays.set(TRACK_DISPLAY, { ...waiverScreenFor(HOST), orgId: 'org-elsewhere' })
    expect((await sign({ ...signing(waiver), display: TRACK_DISPLAY })).status).toBe(401)
    expect(signatures()).toHaveLength(0)
  })

  it('signs only while the display shows the waiver: once the register shows something else, it is refused', async () => {
    const waiver = await publishedWaiver()
    // Paired, but nothing sent.
    expect((await sign({ ...signing(waiver), display: TRACK_DISPLAY })).status).toBe(409)
    send(TRACK_DISPLAY, HOST)
    expect(await showing(TRACK_DISPLAY)).toBe(true)
    // The register shows a sale's basket (its own screen), or another plugin's page.
    displays.set(TRACK_DISPLAY, { hostId: HOST, orgId: ORG, screen: null, shownBy: null })
    expect(await showing(TRACK_DISPLAY)).toBe(false)
    const refused = await sign({ ...signing(waiver), display: TRACK_DISPLAY })
    expect(refused.status).toBe(409)
    expect((await refused.json()).error).toMatch(/showing something else/)
    displays.set(TRACK_DISPLAY, { hostId: HOST, orgId: ORG, screen: { pluginId: 'acme-forms', path: '/display-fill', params: {} }, shownBy: 'uid-clerk' })
    expect((await sign({ ...signing(waiver), display: TRACK_DISPLAY })).status).toBe(409)
    expect(signatures()).toHaveLength(0)
  })

  it('refuses a waiver sent by a member who does not take signatures here', async () => {
    const waiver = await publishedWaiver()
    send(TRACK_DISPLAY, HOST, 'uid-narrowed')
    const refused = await sign({ ...signing(waiver), display: TRACK_DISPLAY })
    expect(refused.status).toBe(403)
    send(TRACK_DISPLAY, HOST, 'uid-window')
    expect((await sign({ ...signing(waiver), display: TRACK_DISPLAY })).status).toBe(201)
    expect(signatures()[0]).toMatchObject({ audit: { staffUid: 'uid-window', staffName: 'Wes Window' } })
  })

  it('answers a filled honeypot as a success and limits a flood', async () => {
    const waiver = await publishedWaiver()
    send(TRACK_DISPLAY, HOST)
    expect((await sign({ ...signing(waiver), display: TRACK_DISPLAY, website: 'spam' })).status).toBe(201)
    rateAllowed = false
    expect((await sign({ ...signing(waiver), display: TRACK_DISPLAY })).status).toBe(429)
    expect(signatures()).toHaveLength(0)
  })
})

describe('a paper waiver', () => {
  it('needs a photo of the page, keeps it privately, and sends no email', async () => {
    const waiver = await publishedWaiver()
    const body = {
      attemptKey: 'paper-0001',
      waiverId: waiver.id,
      signedOnDayKey: '2026-10-23',
      signer: { name: 'Riley Park', email: 'riley@example.com', phone: '', dateOfBirth: '1985-01-01' },
      minors: [],
    }
    expect((await call(paperRoute, 'POST', { token: 'tok-clerk', body })).status).toBe(400)
    const response = await call(paperRoute, 'POST', { token: 'tok-clerk', body: { ...body, photo: JPEG } })
    expect(response.status).toBe(201)
    const [stored] = signatures()
    expect(stored).toMatchObject({ method: 'paper', dayKey: '2026-10-23', consent: null, signature: { kind: 'paper' }, paper: { recordedByUid: 'uid-clerk' } })
    expect(stored.signedText).not.toContain('Electronic signature consent')
    expect(files.has(stored.paper.photoPath)).toBe(true)
    expect(sent).toHaveLength(0)
    const photo = await call(signatureFileRoute, 'GET', { query: { signatureId: stored.id, kind: 'paper' } })
    expect(photo.headers.get('Content-Type')).toBe('image/jpeg')
  })

  it('refuses a date in the future', async () => {
    const waiver = await publishedWaiver()
    const response = await call(paperRoute, 'POST', {
      token: 'tok-clerk',
      body: { attemptKey: 'paper-0002', waiverId: waiver.id, signedOnDayKey: '2026-10-30', signer: { name: 'Riley Park', dateOfBirth: '1985-01-01' }, photo: JPEG },
    })
    expect(response.status).toBe(400)
  })
})

describe('finding a signature', () => {
  async function seed() {
    const waiver = await publishedWaiver()
    await call(publicSignRoute, 'POST', { token: null, body: signing(waiver) })
    await call(publicSignRoute, 'POST', {
      token: null,
      body: signing(waiver, {
        attemptKey: 'attempt-0002',
        signer: { name: 'Casey Moss', email: 'casey@example.com', phone: '', dateOfBirth: '1980-01-01' },
        minors: [],
      }),
    })
    return waiver
  }

  it('searches by any name word, an email, a day and a waiver', async () => {
    const waiver = await seed()
    const names = async (query: Record<string, string>) =>
      (await (await call(signaturesRoute, 'GET', { token: 'tok-clerk', query })).json()).signatures.map(
        (row: { signerName: string }) => row.signerName,
      )
    expect((await names({})).sort()).toEqual(['Casey Moss', 'Jordan Lee'])
    expect(await names({ q: 'pat' })).toEqual(['Jordan Lee'])
    expect(await names({ q: 'casey@example.com' })).toEqual(['Casey Moss'])
    expect((await names({ q: '2026-10-24' })).length).toBe(2)
    expect(await names({ q: '2026-10-25' })).toEqual([])
    expect((await names({ waiverId: waiver.id, q: 'moss' }))).toEqual(['Casey Moss'])
  })

  it('refuses a viewer the list', async () => {
    await seed()
    expect((await call(signaturesRoute, 'GET', { token: 'tok-viewer' })).status).toBe(403)
  })

  it('exports every match as a spreadsheet', async () => {
    await seed()
    const response = await call(signaturesRoute, 'GET', { query: { format: 'csv' } })
    expect(response.headers.get('Content-Type')).toMatch(/text\/csv/)
    const lines = (await response.text()).split('\n')
    expect(lines[0]).toMatch(/^Signed at,Day,Good through,Waiver/)
    expect(lines).toHaveLength(3)
  })

  it('serves one record without its storage paths, and its signed PDF', async () => {
    await seed()
    const id = signatures()[0].id as string
    const detail = await (await call(signatureRoute, 'GET', { query: { signatureId: id } })).json()
    expect(detail.signature.signature).toMatchObject({ kind: 'drawn', hasImage: true })
    expect(detail.signature.signature.imagePath).toBeUndefined()
    expect(detail.signature.signature.strokes[0]).toEqual([[10, 10], [20, 30], [40, 60], [80, 90]])
    const pdf = await call(signaturePdfRoute, 'GET', { query: { signatureId: id } })
    expect(pdf.headers.get('Content-Type')).toBe('application/pdf')
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-')
    expect((await call(signatureRoute, 'GET', { host: OTHER_HOST, query: { signatureId: id } })).status).toBe(404)
  })
})

describe('voiding and status', () => {
  it('needs the manage permission and a reason, and a voided signature no longer counts', async () => {
    const waiver = await publishedWaiver()
    await call(publicSignRoute, 'POST', { token: null, body: signing(waiver) })
    const id = signatures()[0].id as string
    const status = async () =>
      (await (await call(statusRoute, 'GET', { token: 'tok-clerk', query: { email: 'jordan@example.com', dayKey: '2026-10-24', people: '3' } })).json())
    expect(await status()).toMatchObject({ signed: true, coveredNames: ['Jordan Lee', 'Pat Lee'], label: 'Signed for 2 of 3 riders' })
    expect((await call(signatureRoute, 'POST', { token: 'tok-clerk', body: { signatureId: id, action: 'void', reason: 'Duplicate' } })).status).toBe(403)
    expect((await call(signatureRoute, 'POST', { body: { signatureId: id, action: 'void', reason: '' } })).status).toBe(400)
    const voided = await call(signatureRoute, 'POST', { body: { signatureId: id, action: 'void', reason: 'Duplicate' } })
    expect((await voided.json()).signature).toMatchObject({ voidedBy: 'uid-admin', voidReason: 'Duplicate' })
    expect(await status()).toMatchObject({ signed: false, label: 'Waiver needed' })
  })

  it('looks a person up by their CRM contact too', async () => {
    const waiver = await publishedWaiver()
    await call(publicSignRoute, 'POST', { token: null, body: signing(waiver) })
    const answer = await (await call(statusRoute, 'GET', { query: { contactId: 'contact-1' } })).json()
    expect(answer.signed).toBe(true)
    expect((await call(statusRoute, 'GET', {})).status).toBe(400)
  })
})

describe('matching a rider at check-in: email, else name and date of birth (AGL-4042)', () => {
  const status = async (query: Record<string, string>) =>
    (await (await call(statusRoute, 'GET', { token: 'tok-clerk', query: { dayKey: '2026-10-24', ...query } })).json()) as {
      signed: boolean
      matched: boolean
      matchedBy: string | null
      searchName: string | null
      coveredNames: string[]
      label: string
    }

  beforeEach(async () => {
    // Jordan Lee (born 1990-04-02) signs for themself and for Pat Lee (born 2014-09-30).
    const waiver = await publishedWaiver()
    await call(publicSignRoute, 'POST', { token: null, body: signing(waiver) })
  })

  it('stamps a key for the signer and each minor when it is signed', () => {
    expect(signatures()[0].nameDobKeys).toEqual(['jordan lee|1990-04-02', 'pat lee|2014-09-30'])
  })

  it('matches by email first', async () => {
    expect(await status({ email: 'jordan@example.com', name: 'Someone Else', dateOfBirth: '1970-01-01' })).toMatchObject({
      signed: true,
      matched: true,
      matchedBy: 'email',
      label: 'Waiver signed',
    })
  })

  it('matches an adult by name and date of birth when the email matches nothing, whatever the case and spacing', async () => {
    expect(await status({ email: 'other@example.com', name: '  JORDAN   lee ', dateOfBirth: '1990-04-02' })).toMatchObject({
      signed: true,
      matched: true,
      matchedBy: 'nameDob',
      label: 'Waiver signed',
    })
  })

  it('matches a minor a guardian listed, by their own name and date of birth', async () => {
    expect(await status({ name: 'Pat Lee', dateOfBirth: '2014-09-30' })).toMatchObject({
      signed: true,
      matched: true,
      matchedBy: 'nameDob',
      coveredNames: ['Jordan Lee', 'Pat Lee'],
    })
  })

  it('never matches on a name alone', async () => {
    // No date of birth: not matched, with the name to search by, and no guess.
    expect(await status({ name: 'Pat Lee' })).toEqual({
      dayKey: '2026-10-24',
      signed: false,
      coveredNames: [],
      signatureId: null,
      matched: false,
      matchedBy: null,
      searchName: 'Pat Lee',
      label: 'Waiver not matched — check by name',
    })
    // The right name on another birth date, or the right birth date on another name.
    expect(await status({ name: 'Pat Lee', dateOfBirth: '2014-09-29' })).toMatchObject({ signed: false, matched: false, label: 'Waiver needed' })
    expect(await status({ name: 'Sam Lee', dateOfBirth: '2014-09-30' })).toMatchObject({ signed: false, matched: false, label: 'Waiver needed' })
    // An email that matches nothing, and no birth date: still not a guess.
    expect(await status({ email: 'other@example.com', name: 'Jordan Lee' })).toMatchObject({
      signed: false,
      matched: false,
      label: 'Waiver not matched — check by name',
    })
  })

  it('keeps refusing a lookup with nothing to match by', async () => {
    expect((await call(statusRoute, 'GET', { token: 'tok-clerk', query: { name: '   ' } })).status).toBe(400)
  })

  it('stamps keys on a paper waiver too', async () => {
    const waiver = await publishedWaiver()
    await call(paperRoute, 'POST', {
      token: 'tok-clerk',
      body: {
        attemptKey: 'paper-0009',
        waiverId: waiver.id,
        signedOnDayKey: '2026-10-24',
        signer: { name: 'Riley Park', email: '', phone: '', dateOfBirth: '1985-01-01' },
        minors: [{ name: 'Casey Park', dateOfBirth: '2016-02-03' }],
        guardianRelationship: 'Parent',
        photo: JPEG,
      },
    })
    const paper = signatures().find((one) => one.method === 'paper')
    expect(paper?.nameDobKeys).toEqual(['riley park|1985-01-01', 'casey park|2016-02-03'])
    expect(await status({ name: 'Casey Park', dateOfBirth: '2016-02-03' })).toMatchObject({ signed: true, matchedBy: 'nameDob' })
  })
})

describe('the name and birth date backfill (AGL-4042)', () => {
  beforeEach(async () => {
    const waiver = await publishedWaiver()
    await call(publicSignRoute, 'POST', { token: null, body: signing(waiver) })
    await call(publicSignRoute, 'POST', {
      token: null,
      body: signing(waiver, {
        attemptKey: 'attempt-0077',
        signer: { name: 'Riley Park', email: 'riley@example.com', phone: '', dateOfBirth: '1985-01-01' },
        minors: [],
      }),
    })
    // Both as signatures taken before the keys existed.
    for (const [path, data] of db.docs) {
      if (path.startsWith(`orgs/${ORG}/waiverSignatures/`)) {
        const rest = { ...(data as Record<string, unknown>) }
        delete rest['nameDobKeys']
        db.docs.set(path, rest)
      }
    }
  })

  it('counts and writes nothing on a dry run', async () => {
    const before = JSON.stringify([...db.docs.entries()])
    expect(await backfillWaiverNameDobKeys(db as never, { commit: false })).toEqual({
      read: 2,
      current: 0,
      toStamp: 2,
      stamped: 0,
      skipped: 0,
    })
    expect(JSON.stringify([...db.docs.entries()])).toBe(before)
  })

  it('stamps only the keys when committed, and finds nothing left on a re-run', async () => {
    const before = signatures().map((one) => ({ ...one }))
    expect(await backfillWaiverNameDobKeys(db as never, { orgId: ORG, commit: true, pageSize: 1 })).toMatchObject({
      read: 2,
      toStamp: 2,
      stamped: 2,
    })
    const after = signatures()
    expect(after.map((one) => one.nameDobKeys).sort()).toEqual([
      ['jordan lee|1990-04-02', 'pat lee|2014-09-30'],
      ['riley park|1985-01-01'],
    ])
    // Nothing else on a signature moved.
    for (const one of after) {
      const rest = { ...(one as Record<string, unknown>) }
      delete rest['nameDobKeys']
      expect(before).toContainEqual(rest)
    }
    expect(await backfillWaiverNameDobKeys(db as never, { commit: false })).toMatchObject({ current: 2, toStamp: 0 })
  })
})

describe('a waiver edited after it was signed', () => {
  it('keeps every signature valid for the version it signed, and takes new ones on the new version only', async () => {
    const waiver = await publishedWaiver()
    await call(publicSignRoute, 'POST', { token: null, body: signing(waiver) })
    const [before] = signatures()
    const edited = await (
      await call(templatesRoute, 'POST', {
        body: { waiverId: waiver.id, waiver: { ...WAIVER, body: `${WAIVER.body}\n\nNo passengers.` } },
      })
    ).json()
    expect(edited.waiver.version).toBe(2)
    const [after] = signatures()
    // The record still names version 1 and the exact words it agreed to.
    expect(after).toMatchObject({ version: 1, signedText: before.signedText, signedTextSha256: before.signedTextSha256 })
    expect(after.signedText).not.toContain('No passengers.')
    const status = await (
      await call(statusRoute, 'GET', { token: 'tok-clerk', query: { email: 'jordan@example.com', dayKey: '2026-10-24' } })
    ).json()
    expect(status).toMatchObject({ signed: true, label: 'Waiver signed' })
    // A signer still holding version 1 is sent to read version 2.
    const stale = await call(publicSignRoute, 'POST', { token: null, body: signing(waiver, { attemptKey: 'attempt-0002' }) })
    expect(stale.status).toBe(409)
    const fresh = await call(publicSignRoute, 'POST', {
      token: null,
      body: signing({ id: waiver.id, version: 2 }, { attemptKey: 'attempt-0003' }),
    })
    expect(fresh.status).toBe(201)
    expect(signatures().map((one) => one.version).sort()).toEqual([1, 2])
  })
})

describe('the adult age a waiver sets', () => {
  it('serves it to the signing page and checks every signing against it, at the boundary', async () => {
    const waiver = await publishedWaiver({ adultAge: 21 })
    const answer = await (await call(publicWaiverRoute, 'GET', { token: null, query: { waiverId: waiver.id } })).json()
    expect(answer).toMatchObject({ adultAge: 21, waiver: { adultAge: 21 } })
    const short = await call(publicSignRoute, 'POST', {
      token: null,
      body: signing(waiver, { signer: { name: 'Jordan Lee', email: 'jordan@example.com', dateOfBirth: '2005-10-25' }, minors: [] }),
    })
    expect(short.status).toBe(400)
    expect((await short.json()).error).toBe('Anyone under 21 needs a parent or guardian to sign for them.')
    const today = await call(publicSignRoute, 'POST', {
      token: null,
      body: signing(waiver, {
        attemptKey: 'attempt-0021',
        signer: { name: 'Jordan Lee', email: 'jordan@example.com', dateOfBirth: '2005-10-24' },
        minors: [{ name: 'Sam Lee', dateOfBirth: '2005-10-25' }],
      }),
    })
    expect(today.status).toBe(201)
    expect(signatures()[0]).toMatchObject({ adultAge: 21, minors: [{ name: 'Sam Lee' }] })
  })

  it('starts a version when it changes, and reads an older waiver as 18', async () => {
    const { waiver } = await (await call(templatesRoute, 'POST', { body: { waiver: WAIVER } })).json()
    expect(waiver.adultAge).toBe(18)
    const older = `orgs/${ORG}/waivers/${waiver.id}`
    const stored = { ...(db.docs.get(older) as Record<string, unknown>) }
    delete stored['adultAge']
    db.docs.set(older, stored)
    const unchanged = await (await call(templatesRoute, 'POST', { body: { waiverId: waiver.id, waiver: WAIVER } })).json()
    expect(unchanged.waiver.version).toBe(1)
    const raised = await (
      await call(templatesRoute, 'POST', { body: { waiverId: waiver.id, waiver: { ...WAIVER, adultAge: 19 } } })
    ).json()
    expect(raised.waiver).toMatchObject({ version: 2, adultAge: 19 })
    expect(db.docs.get(`${older}/versions/2`)).toMatchObject({ adultAge: 19 })
  })
})

describe('the share link', () => {
  it('opens on the store’s own site: its platform address, or its custom domain', async () => {
    const waiver = await publishedWaiver()
    const listed = await (await call(templatesRoute, 'GET')).json()
    expect(listed.signPageOrigin).toBe('https://acme-track.aglyn.app')
    const one = await (await call(publicWaiverRoute, 'GET', { token: null, query: { waiverId: waiver.id } })).json()
    expect(one.signUrl).toBe(`https://acme-track.aglyn.app/sign-waiver?waiver=${waiver.id}`)
    const list = await (await call(publicWaiverRoute, 'GET', { token: null })).json()
    expect(list.signUrl).toBe('https://acme-track.aglyn.app/sign-waiver')
    const other = await (await call(templatesRoute, 'GET', { host: OTHER_HOST })).json()
    expect(other.signPageOrigin).toBe('https://rides.example.com')
  })
})

describe('erasing a person', () => {
  const request = { orgId: ORG, email: 'jordan@example.com', key: 'k', atMs: NOW, contactIds: ['contact-1'] }

  async function signed() {
    const waiver = await publishedWaiver()
    await call(publicSignRoute, 'POST', { token: null, body: signing(waiver) })
    return signatures()[0]
  }

  it('keeps each signed waiver as the store’s record, unlinked from the erased person, and counts on a dry run', async () => {
    const before = await signed()
    expect(before.contactId).toBe('contact-1')
    expect(await eraseWaiversPerson({ ...request, dryRun: true })).toEqual({ signatures: 1, kept: 1, deleted: 0 })
    expect(signatures()[0]).toEqual(before)
    expect(await eraseWaiversPerson({ ...request, dryRun: false })).toEqual({ signatures: 1, kept: 1, deleted: 0 })
    const [kept] = signatures()
    // Seven years from the youngest rider (born 2014-09-30) coming of age.
    const until = Date.UTC(2039, 9, 1)
    expect(kept).toMatchObject({
      signer: before.signer,
      minors: before.minors,
      signedText: before.signedText,
      contactId: null,
      erasure: { requestedAtMs: NOW },
      retainUntilMs: until,
    })
    expect(files.has(kept.signature.imagePath)).toBe(true)
    // The list says it is kept, and until when.
    const rows = (await (await call(signaturesRoute, 'GET')).json()).signatures
    expect(rows[0]).toMatchObject({ retainedUntilMs: until, voided: false })
    // Run again (a retried erasure), it writes nothing new.
    await eraseWaiversPerson({ ...request, atMs: NOW + 1000, dryRun: false })
    expect(signatures()[0]).toMatchObject({ erasure: { requestedAtMs: NOW }, retainUntilMs: until })
  })

  it('reads each site’s own period', async () => {
    retentionYears[HOST] = 2
    await signed()
    await eraseWaiversPerson({ ...request, dryRun: false })
    expect(signatures()[0].retainUntilMs).toBe(Date.UTC(2034, 9, 1))
  })

  it('deletes a signed waiver whose period has already run out, with its files', async () => {
    const waiver = await publishedWaiver()
    await call(publicSignRoute, 'POST', { token: null, body: signing(waiver, { minors: [], guardianRelationship: '' }) })
    const [stored] = signatures()
    expect(files.has(stored.signature.imagePath)).toBe(true)
    const tenYearsOn = NOW + 10 * 366 * 24 * 60 * 60 * 1000
    expect(await eraseWaiversPerson({ ...request, atMs: tenYearsOn, dryRun: false })).toEqual({
      signatures: 1,
      kept: 0,
      deleted: 1,
    })
    expect(signatures()).toHaveLength(0)
    expect(files.has(stored.signature.imagePath)).toBe(false)
  })
})

describe('every signature is stamped with its retention period (AGL-4042)', () => {
  const stateOf = (hostId: string) => db.docs.get(`orgs/${ORG}/waiverRetention/${hostId}`)

  it('stamps an online signature, counting from the youngest minor’s adult age, and records the site’s period', async () => {
    const waiver = await publishedWaiver()
    await call(publicSignRoute, 'POST', { token: null, body: signing(waiver) })
    // The rider born 2014-09-30 comes of age on 2032-09-30; seven years on, kept through 2039-09-30.
    expect(signatures()[0]).toMatchObject({ retainUntilMs: Date.UTC(2039, 9, 1), retentionYears: 7 })
    expect(stateOf(HOST)).toMatchObject({ orgId: ORG, hostId: HOST, years: 7, checkedAtMs: NOW, restamp: null })
    // Nothing about it says it was erased, and the list does not call it kept.
    expect(signatures()[0].erasure).toBeUndefined()
    const rows = (await (await call(signaturesRoute, 'GET')).json()).signatures
    expect(rows[0]).toMatchObject({ retainedUntilMs: null })
  })

  it('counts from the last covered day for an adult, with the waiver’s own adult age for a minor', async () => {
    const waiver = await publishedWaiver({ adultAge: 21 })
    await call(publicSignRoute, 'POST', { token: null, body: signing(waiver, { minors: [], guardianRelationship: '' }) })
    await call(publicSignRoute, 'POST', {
      token: null,
      body: signing(waiver, { attemptKey: 'attempt-0002', minors: [{ name: 'Sam Lee', dateOfBirth: '2010-03-15' }] }),
    })
    const [adult, minor] = [...signatures()].sort((a, b) => a.retainUntilMs - b.retainUntilMs)
    expect(adult.retainUntilMs).toBe(Date.UTC(2033, 9, 25))
    // Twenty-one on 2031-03-15, seven years on: kept through 2038-03-15.
    expect(minor.retainUntilMs).toBe(Date.UTC(2038, 2, 16))
  })

  it('stamps a paper waiver with the site’s own period', async () => {
    retentionYears[HOST] = 3
    const waiver = await publishedWaiver()
    const body = {
      attemptKey: 'paper-0003',
      waiverId: waiver.id,
      signedOnDayKey: '2026-10-23',
      signer: { name: 'Riley Park', email: 'riley@example.com', phone: '', dateOfBirth: '1985-01-01' },
      minors: [],
      photo: JPEG,
    }
    expect((await call(paperRoute, 'POST', { token: 'tok-clerk', body })).status).toBe(201)
    expect(signatures()[0]).toMatchObject({ retainUntilMs: Date.UTC(2029, 9, 24), retentionYears: 3 })
    expect(stateOf(HOST)).toMatchObject({ years: 3 })
  })
})

describe('the retention job', () => {
  const HOUR = 60 * 60 * 1000
  const tick = (nowMs: number) => runWaiversRetentionJob({ nowMs, deadlineMs: Date.now() + 60_000 })

  async function twoSigned() {
    const waiver = await publishedWaiver()
    await call(publicSignRoute, 'POST', { token: null, body: signing(waiver, { minors: [], guardianRelationship: '' }) })
    await call(publicSignRoute, 'POST', {
      token: null,
      body: signing(waiver, {
        attemptKey: 'attempt-0002',
        signer: { name: 'Casey Moss', email: 'casey@example.com', phone: '', dateOfBirth: '1980-01-01' },
        minors: [],
      }),
    })
    return signatures()
  }

  it('deletes every signed waiver, with its files, once its period runs out, erased or not', async () => {
    const [first] = await twoSigned()
    await eraseWaiversPerson({ orgId: ORG, email: 'jordan@example.com', key: 'k', atMs: NOW, contactIds: [], dryRun: false })
    const until = Date.UTC(2033, 9, 25)
    expect(signatures().map((one) => one.retainUntilMs)).toEqual([until, until])
    expect(await tick(until - 1)).toMatchObject({ due: 0, deleted: 0, extended: 0 })
    expect(signatures()).toHaveLength(2)
    expect(await tick(until)).toMatchObject({ due: 2, deleted: 2, extended: 0 })
    expect(signatures()).toHaveLength(0)
    expect(files.has(first.signature.imagePath)).toBe(false)
  })

  it('keeps it for the longer period when the store lengthened it since', async () => {
    const [first] = await twoSigned()
    retentionYears[HOST] = 10
    expect(await tick(first.retainUntilMs)).toMatchObject({ sites: 1, restamped: 2, due: 0, deleted: 0 })
    expect(signatures().map((one) => one.retainUntilMs)).toEqual([Date.UTC(2036, 9, 25), Date.UTC(2036, 9, 25)])
  })

  it('reads the period again before deleting, even where the site was compared moments ago', async () => {
    const [first] = await twoSigned()
    retentionYears[HOST] = 10
    db.docs.set(`orgs/${ORG}/waiverRetention/${HOST}`, {
      ...(db.docs.get(`orgs/${ORG}/waiverRetention/${HOST}`) as Record<string, unknown>),
      checkedAtMs: first.retainUntilMs,
    })
    expect(await tick(first.retainUntilMs)).toMatchObject({ sites: 0, due: 2, deleted: 0, extended: 2 })
    expect(signatures().map((one) => one.retainUntilMs)).toEqual([Date.UTC(2036, 9, 25), Date.UTC(2036, 9, 25)])
  })

  it('applies a changed period to the signatures already signed, within the hour', async () => {
    await twoSigned()
    retentionYears[HOST] = 2
    // Within the hour of the last comparison, the site is not looked at again.
    expect(await tick(NOW + HOUR - 1)).toMatchObject({ sites: 0, restamped: 0 })
    expect(await tick(NOW + HOUR)).toMatchObject({ sites: 1, restamped: 2, due: 0 })
    expect(signatures()).toEqual([
      expect.objectContaining({ retainUntilMs: Date.UTC(2028, 9, 25), retentionYears: 2 }),
      expect.objectContaining({ retainUntilMs: Date.UTC(2028, 9, 25), retentionYears: 2 }),
    ])
    expect(db.docs.get(`orgs/${ORG}/waiverRetention/${HOST}`)).toMatchObject({ years: 2, checkedAtMs: NOW + HOUR, restamp: null })
    // An unchanged period is compared and nothing is written.
    expect(await tick(NOW + 2 * HOUR)).toMatchObject({ sites: 1, restamped: 0 })
  })

  it('deletes at once what a shorter period has already run out on', async () => {
    await twoSigned()
    retentionYears[HOST] = 1
    const later = Date.UTC(2028, 0, 1)
    expect(await tick(later)).toMatchObject({ sites: 1, restamped: 2, due: 2, deleted: 2 })
    expect(signatures()).toHaveLength(0)
  })

  it('stamps a changed period on every signature of the site, a page at a time', async () => {
    db.docs.set(`orgs/${ORG}/waiverRetention/${HOST}`, { orgId: ORG, hostId: HOST, years: 5, checkedAtMs: 0, restamp: null })
    for (let index = 0; index < 205; index += 1) {
      db.docs.set(`orgs/${ORG}/waiverSignatures/old-${index}`, {
        id: `old-${index}`,
        orgId: ORG,
        hostId: HOST,
        signedAtMs: NOW - index,
        validThroughDayKey: '2026-10-01',
        minors: [],
        adultAge: 18,
      })
    }
    expect(await tick(NOW)).toMatchObject({ sites: 1, restamped: 205 })
    expect(signatures().every((one) => one.retainUntilMs === Date.UTC(2033, 9, 2) && one.retentionYears === 7)).toBe(true)
    expect(db.docs.get(`orgs/${ORG}/waiverRetention/${HOST}`)).toMatchObject({ years: 7, restamp: null })
  })

  it('carries on a re-stamp it had to leave half done', async () => {
    db.docs.set(`orgs/${ORG}/waiverRetention/${HOST}`, {
      orgId: ORG,
      hostId: HOST,
      years: 5,
      checkedAtMs: 0,
      restamp: { years: 7, afterId: 'old-1' },
    })
    for (let index = 0; index < 3; index += 1) {
      db.docs.set(`orgs/${ORG}/waiverSignatures/old-${index}`, {
        id: `old-${index}`,
        orgId: ORG,
        hostId: HOST,
        signedAtMs: NOW - index,
        validThroughDayKey: '2026-10-01',
        minors: [],
        adultAge: 18,
        // The first two were reached before it stopped; the first carries a
        // marker of its own, so going back over it would show.
        ...(index === 0 ? { retainUntilMs: Date.UTC(2099, 0, 1), retentionYears: 7 } : {}),
        ...(index === 1 ? { retainUntilMs: Date.UTC(2033, 9, 2), retentionYears: 7 } : {}),
      })
    }
    // Only the signature after the one it stopped at is left to stamp.
    expect(await tick(NOW)).toMatchObject({ sites: 1, restamped: 1 })
    expect(db.docs.get(`orgs/${ORG}/waiverSignatures/old-0`)).toMatchObject({ retainUntilMs: Date.UTC(2099, 0, 1) })
    expect(db.docs.get(`orgs/${ORG}/waiverSignatures/old-2`)).toMatchObject({ retainUntilMs: Date.UTC(2033, 9, 2), retentionYears: 7 })
    expect(db.docs.get(`orgs/${ORG}/waiverRetention/${HOST}`)).toMatchObject({ years: 7, restamp: null })
  })

  it('leaves another site’s signatures to that site’s period', async () => {
    await twoSigned()
    retentionYears[OTHER_HOST] = 1
    expect(await tick(NOW + HOUR)).toMatchObject({ sites: 1, restamped: 0 })
    expect(signatures().every((one) => one.retentionYears === 7)).toBe(true)
  })
})

describe('e-sign consent v2 and the signer’s own copy (AGL-4042)', () => {
  const contactHost = () =>
    db.docs.set(`hosts/${HOST}`, {
      ...(db.docs.get(`hosts/${HOST}`) as Record<string, unknown>),
      seo: { entity: { email: 'hello@example.com', telephone: '+1-555-010-0100' } },
    })
  const copyQuery = (copyUrl: string) => Object.fromEntries(new URL(copyUrl, 'https://console.test').searchParams)

  it('stores the consent as this site’s signers read it, with the business and how to reach it', async () => {
    contactHost()
    const waiver = await publishedWaiver()
    const read = await (await call(publicWaiverRoute, 'GET', { token: null, query: { waiverId: waiver.id } })).json()
    expect(read.site).toEqual({ name: 'Acme Motocross', contact: 'hello@example.com or +1-555-010-0100' })
    expect(read.consent).toMatchObject({ heading: 'Signing electronically', version: 2 })
    expect(read.consent.text).toContain('by contacting Acme Motocross at hello@example.com or +1-555-010-0100.')
    await call(publicSignRoute, 'POST', { token: null, body: signing(waiver) })
    const [stored] = signatures()
    // The words signed are the words shown, and the signed text carries them.
    expect(stored.consent).toEqual({ agreed: true, text: read.consent.text, version: 2 })
    expect(stored.signedText).toContain(`Electronic signature consent: ${read.consent.text}`)
    // The signed copy email repeats the paper copy and how to reach the business.
    expect(sent[0].tokens['waiver.contact']).toBe('Contact Acme Motocross at hello@example.com or +1-555-010-0100.')
    expect(sent[0].fallback.text).toContain('a paper copy at no charge')
  })

  it('tells the console how signers reach the business, and when they can’t', async () => {
    const listed = async () => (await (await call(templatesRoute, 'GET')).json()).businessContact
    expect(await listed()).toBeNull()
    contactHost()
    expect(await listed()).toBe('hello@example.com or +1-555-010-0100')
  })

  it('answers an electronic signing with a one-hour link to its own PDF, and nothing else', async () => {
    const waiver = await publishedWaiver()
    const answer = await (await call(publicSignRoute, 'POST', { token: null, body: signing(waiver) })).json()
    expect(answer.copyUrl).toMatch(/^\/api\/waivers\/signed-copy\?/)
    const query = copyQuery(answer.copyUrl)
    const download = await call(signedCopyRoute, 'GET', { token: null, query })
    expect(download.status).toBe(200)
    expect(download.headers.get('content-type')).toBe('application/pdf')
    expect(Buffer.from(await download.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-')
    // The token is stored as a hash, never as itself.
    expect(JSON.stringify(signatures()[0])).not.toContain(query['token'])
    expect((await call(signedCopyRoute, 'GET', { token: null, query: { ...query, token: 'forged-token' } })).status).toBe(404)
    expect((await call(signedCopyRoute, 'GET', { token: null, query: { ...query, hostId: OTHER_HOST } })).status).toBe(404)
    setWaiversClockForTests(() => NOW + 61 * 60 * 1000)
    expect((await call(signedCopyRoute, 'GET', { token: null, query })).status).toBe(404)
  })

  it('gives a signer at the window with no email a copy to scan, and a paper waiver none', async () => {
    const waiver = await publishedWaiver()
    const response = await call(signAtWindowRoute, 'POST', {
      token: 'tok-clerk',
      body: signing(waiver, { signer: { name: 'Jordan Lee', email: '', phone: '', dateOfBirth: '1990-04-02' }, signature: { kind: 'typed', text: 'Jordan Lee' } }),
    })
    const answer = await response.json()
    expect(answer.copyUrl).toMatch(/^\/api\/waivers\/signed-copy\?/)
    expect((await call(signedCopyRoute, 'GET', { token: null, query: copyQuery(answer.copyUrl) })).status).toBe(200)
    expect(await signedCopyPath({ orgId: ORG, hostId: HOST, signature: { id: 'paper-1', method: 'paper' } })).toBeNull()
  })
})

describe('matching a rider at check-in by the birth date on their CRM contact (AGL-4042)', () => {
  const status = async (query: Record<string, string>) =>
    (await (await call(statusRoute, 'GET', { token: 'tok-clerk', query: { dayKey: '2026-10-24', ...query } })).json()) as {
      signed: boolean
      matched: boolean
      matchedBy: string | null
      birthDateFrom?: string | null
      searchName: string | null
      label: string
    }
  const contact = (id: string, facets: Record<string, Record<string, unknown>>, name = 'Pat Lee') =>
    db.docs.set(`orgs/${ORG}/contacts/${id}`, { name, facets })

  // The plugin that keeps people, as core's seam reaches it: waivers never
  // opens a contacts collection itself.
  beforeAll(() => {
    registerPluginPersonRecords({
      find: async () => null,
      read: async (request) =>
        request.records.map((record) => {
          const data = db.docs.get(`orgs/${request.orgId}/contacts/${record.id}`)
          return record.kind === 'contact' && data ? { kind: 'contact', id: record.id, email: null, data } : null
        }),
    }, { pluginId: 'crm' })
  })
  afterAll(() => resetPluginServicesForTests())

  beforeEach(async () => {
    // Jordan Lee (born 1990-04-02) signs for themself and for Pat Lee (born 2014-09-30).
    const waiver = await publishedWaiver()
    await call(publicSignRoute, 'POST', { token: null, body: signing(waiver) })
  })

  it('matches by the name and birth date this site keeps on the contact, when no email matches', async () => {
    contact('contact-pat', { [HOST]: { name: 'Pat Lee', birthdate: '2014-09-30' } })
    expect(await status({ contactId: 'contact-pat' })).toMatchObject({
      signed: true,
      matched: true,
      matchedBy: 'nameDob',
      birthDateFrom: 'contact',
      label: 'Waiver signed',
    })
    // An email that matches nothing still falls back to the contact's birth date.
    expect(await status({ email: 'nobody@example.com', contactId: 'contact-pat', name: 'Pat Lee' })).toMatchObject({
      matched: true,
      matchedBy: 'nameDob',
      birthDateFrom: 'contact',
    })
  })

  it('leaves Find by name for a contact with no birth date, and never reads another site’s record of them', async () => {
    contact('contact-none', { [HOST]: { name: 'Pat Lee' } })
    expect(await status({ contactId: 'contact-none', name: 'Pat Lee' })).toMatchObject({
      matched: false,
      matchedBy: null,
      searchName: 'Pat Lee',
    })
    // Only another site keeps the birth date: this site does not see it.
    contact('contact-other', { [OTHER_HOST]: { name: 'Pat Lee', birthdate: '2014-09-30' } })
    expect(await status({ contactId: 'contact-other', name: 'Pat Lee' })).toMatchObject({ matched: false, searchName: 'Pat Lee' })
  })

  it('takes a date of birth the caller gives over the contact’s', async () => {
    contact('contact-pat', { [HOST]: { name: 'Pat Lee', birthdate: '2014-09-30' } })
    expect(await status({ contactId: 'contact-pat', name: 'Pat Lee', dateOfBirth: '2000-01-01' })).toMatchObject({
      matched: false,
      matchedBy: null,
    })
  })
})
