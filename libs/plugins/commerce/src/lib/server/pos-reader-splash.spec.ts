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
 * A store's card reader start-up screen (AGL-4048), driven through the real
 * handlers and the real image drawing, with Stripe, Firestore and storage
 * faked at their boundaries:
 *
 * - the screen goes on the site's ONE Terminal Configuration (the one tipping
 *   uses), per device type, from a File uploaded with the splash purpose, and
 *   the configuration is assigned to the site's Location once;
 * - applying again with nothing changed makes no Stripe call at all;
 * - a white-label workspace is never given the platform's screen, and one
 *   that showed it before is cleared;
 * - the staff route admits staff only, writes only for super, checks each
 *   image against Stripe's rules, and brings every store up to date.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { fakeDocs, resetFakeFirestore } from '../testing/fake-firestore'

const sharp = require('sharp')

let mockManagePos = true
/** The finer "Registers and devices" key (AGL-4047); undefined follows `managePos`. */
let mockDevices: boolean | undefined
/** Stores the default lock gate answers locked (AGL-4048). */
const mockLockedHosts = new Set<string>()
/** A role or override that grants (true) or refuses (false) the register; undefined: the site role's default. */
let mockRegisterGranted: boolean | undefined
let mockOrg: Record<string, any> = {}
let mockBlocked: 'locked' | 'quarantined' | null = null
let mockPublicIp: string | null = '93.184.216.34'
const mockAudit = jest.fn<Promise<{ id: string }>, unknown[]>(async () => ({ id: 'audit-1' }))
const mockStorage = new Map<string, { body: Buffer; contentType?: string }>()

const TOKENS: Record<string, Record<string, unknown>> = {
  manager: { uid: 'manager-1', email_verified: true },
  viewer: { uid: 'viewer-1', email_verified: true },
  'staff-super': { uid: 'staff-1', email: 'ops@example.com', email_verified: true, staff: true, staffRole: 'super' },
  'staff-support': { uid: 'staff-3', email_verified: true, staff: true, staffRole: 'support' },
  member: { uid: 'manager-1', email_verified: true },
}

// As the real resolver answers for a site (AGL-4047): nothing for someone
// with no access to it, the site role's default otherwise, and a grant or a
// refusal over that default.
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async (uid: string, context: { hostId?: string }) => ({
    permissions: {
      managePos:
        mockManagePos &&
        jest
          .requireActual('../testing/site-register-permissions')
          .siteRegisterVerdict(
            jest.requireActual('../testing/fake-firestore').fakeDocs.get(`hosts/${context?.hostId}`)?.memberRoles,
            uid,
            mockRegisterGranted,
          ),
      ...(mockDevices === undefined ? {} : { posDevices: mockDevices }),
    },
  }),
}))
jest.mock('@aglyn/tenant-data-admin', () => {
  const fake = jest.requireActual('../testing/fake-firestore')
  const file = (path: string) => ({
    download: async () => {
      const stored = mockStorage.get(path)
      if (!stored) throw Object.assign(new Error('No such object'), { code: 404 })
      return [stored.body]
    },
    save: async (body: Buffer, options: { contentType?: string }) => {
      mockStorage.set(path, { body, contentType: options?.contentType })
    },
    delete: async () => {
      mockStorage.delete(path)
    },
  })
  return {
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async (token: string) => {
            const decoded = TOKENS[token]
            if (!decoded) throw Object.assign(new Error('Firebase ID token has expired.'), { code: 'auth/id-token-expired' })
            return decoded
          },
        }),
        firestore: () => fake.fakeFirestore,
        storage: () => ({ bucket: () => ({ file }) }),
      }),
      firestore: { FieldValue: fake.fakeFieldValue },
    },
    getOrgForHost: async () => ({ orgId: 'org-1', org: { id: 'org-1', ...mockOrg } }),
    getOrgDoc: async (orgId: string) => (orgId === 'org-1' ? { $id: 'org-1', ...mockOrg } : null),
    emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
    isImpersonationSession: () => false,
  }
})
// The default lock gate a logo event asks (AGL-4048): every store open
// unless a test locks one.
jest.mock('@aglyn/tenant-data-admin/server/tenant-write-lockdown', () => ({
  siteLockdownJobGate: () => ({ isLocked: async (hostId: string) => mockLockedHosts.has(hostId) }),
}))
jest.mock('@aglyn/tenant-data-admin/server/media-variants', () => ({
  loadSharp: async () => jest.requireActual('sharp'),
}))
jest.mock('@aglyn/tenant-data-admin/server/serve-media-cdn', () => ({
  mediaCdnServeBlock: async () => mockBlocked,
}))
jest.mock('@aglyn/tenant-data-admin/server/media-storage-path', () => ({
  mediaStoragePathInScope: ({ storagePath, base, mediaId }: { storagePath?: string; base: string; mediaId: string }) =>
    storagePath || `${base}/media/${mediaId}`,
}))
jest.mock('@aglyn/tenant-data-admin/server/serve-plugin-fetch', () => ({
  resolvePublicIp: async () => mockPublicIp,
  createPinnedDispatcher: () => ({ close: async () => undefined }),
}))
jest.mock('@aglyn/tenant-data-admin/server/admin-audit-write', () => ({
  addAdminAudit: (...args: unknown[]) => mockAudit(...args),
}))
jest.mock('@aglyn/tenant-data-admin/server/id-token-refusal', () => ({
  invalidIdTokenResponse: (error: any) =>
    error?.code === 'auth/id-token-expired' ? Response.json({ error: 'Unauthenticated' }, { status: 401 }) : null,
}))

import { posReaderSplashImageProblem, POS_READER_SPLASH_FAMILIES } from '../model/pos-reader-splash'
import { posReaderSplashAdmin } from './pos-reader-splash-admin'
import {
  applyPosReaderSplash,
  onOrgLogoChanged,
  POS_READER_SPLASH_RETRY_FAILED_AFTER_MS,
  posReaderSplashHandler,
  refreshPosReaderSplashes,
} from './pos-reader-splash'
import {
  resetPluginEventHandlersForTests,
  runPluginEventHandlers,
} from '@aglyn/aglyn/plugin-manager/plugin-events'
import { registerCommerceServerDeclarations } from '../declarations.server'
import { renderPosReaderSplash } from './pos-reader-splash-render'
import { ensurePosOfflineCardConfiguration, savePosReaderConfiguration, syncPosReaderTipping } from './pos-terminal'

interface StripeCall {
  method: string
  host: string
  path: string
  key: string | null
  params: URLSearchParams
  form?: FormData
}
const stripeCalls: StripeCall[] = []
let fileCounter = 0
let configurationCounter = 0
/** Run as Stripe creates a configuration, to stage a racing first write. */
let onConfigurationCreate: (() => void) | null = null
/** Stripe refuses every configuration write while set. */
let refuseConfigurations = false
let externalImage: Buffer | null = null

const fetchMock = jest.fn(async (url: any, init: any) => {
  const target = new URL(String(url))
  const headers = (init?.headers ?? {}) as Record<string, string>
  if (target.host !== 'api.stripe.com' && target.host !== 'files.stripe.com') {
    stripeCalls.push({ method: 'GET', host: target.host, path: target.pathname, key: null, params: new URLSearchParams() })
    if (!externalImage) return { ok: false, status: 404, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) }
    const body = externalImage
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/png', 'content-length': String(body.length) }),
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    }
  }
  const path = target.pathname.replace(/^\/v1\//, '')
  const isForm = init?.body instanceof FormData
  const params = isForm ? new URLSearchParams() : new URLSearchParams(String(init?.body ?? ''))
  stripeCalls.push({
    method: String(init?.method ?? 'GET'),
    host: target.host,
    path,
    key: headers['Idempotency-Key'] ?? null,
    params,
    ...(isForm ? { form: init.body as FormData } : {}),
  })
  if (target.host === 'files.stripe.com' && path === 'files') {
    return { ok: true, status: 200, json: async () => ({ id: `file_${++fileCounter}` }) }
  }
  if (refuseConfigurations && path.startsWith('terminal/configurations')) {
    return { ok: false, status: 400, json: async () => ({ error: { code: 'parameter_invalid' } }) }
  }
  if (path === 'terminal/configurations' && init?.method === 'POST') {
    onConfigurationCreate?.()
    return { ok: true, status: 200, json: async () => ({ id: `tmc_new${++configurationCounter}` }) }
  }
  if (/^terminal\/configurations\/tmc_/.test(path)) {
    return { ok: true, status: 200, json: async () => ({ id: path.split('/').pop(), deleted: init?.method === 'DELETE' }) }
  }
  if (/^terminal\/locations\/tml_/.test(path)) {
    return { ok: true, status: 200, json: async () => ({ id: path.split('/').pop() }) }
  }
  return { ok: false, status: 404, json: async () => ({ error: { message: 'nope' } }) }
})

function response() {
  const result = { status: 0, body: undefined as any }
  const res = {
    status(code: number) {
      result.status = code
      return res
    },
    json(body: unknown) {
      result.body = body
    },
    send(body: unknown) {
      result.body = body
    },
    setHeader() {},
    redirect() {},
    end() {},
  } as unknown as PluginApiResponse
  return { res, result }
}

async function store(body: Record<string, unknown>, token = 'manager') {
  const { res, result } = response()
  const req: PluginApiRequest = {
    method: 'POST',
    query: {},
    body: { hostId: 'host-1', ...body },
    headers: { authorization: `Bearer ${token}` },
    cookies: {},
    socket: {},
  }
  await posReaderSplashHandler(req, res)
  return result
}

async function staff(method: 'GET' | 'POST', body?: Record<string, unknown>, token = 'staff-super', query = '') {
  const response = await posReaderSplashAdmin(
    new Request(`https://console.example.com/api/commerce/admin/reader-splash${query}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  )
  const isJson = (response.headers.get('content-type') ?? '').includes('json')
  return { status: response.status, body: isJson ? await response.json() : await response.arrayBuffer(), headers: response.headers }
}

/** A flat PNG of `width` × `height`. */
function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 119, b: 173, alpha: 1 } } })
    .png()
    .toBuffer()
}

async function sizeOf(body: Buffer) {
  const meta = await sharp(body).metadata()
  return { width: meta.width, height: meta.height, format: meta.format }
}

const configPath = 'hosts/host-1/terminal/config'
const stripeOnly = () => stripeCalls.filter((call) => call.host.endsWith('stripe.com'))
const configurationWrites = () =>
  stripeOnly().filter((call) => call.path.startsWith('terminal/configurations') && call.method === 'POST')

async function seedPlatformDefault(options: { small?: boolean } = {}) {
  const large = await png(1080, 1920)
  mockStorage.set('platform/commerce/pos-reader-splash/portrait-large-aaaa.png', { body: large })
  const families: Record<string, unknown> = {
    'portrait-large': {
      storagePath: 'platform/commerce/pos-reader-splash/portrait-large-aaaa.png',
      sha256: 'a'.repeat(64),
      contentType: 'image/png',
      bytes: large.length,
      uploadedAtMs: 1,
    },
  }
  if (options.small) {
    const small = await png(720, 1280)
    mockStorage.set('platform/commerce/pos-reader-splash/portrait-small-bbbb.png', { body: small })
    families['portrait-small'] = {
      storagePath: 'platform/commerce/pos-reader-splash/portrait-small-bbbb.png',
      sha256: 'b'.repeat(64),
      contentType: 'image/png',
      bytes: small.length,
      uploadedAtMs: 1,
    }
  }
  fakeDocs.set('platformSettings/posReaderSplash', { families, updatedAtMs: 1 })
}

async function seedOrgLogo(options: { private?: boolean; visibleTo?: string[] } = {}) {
  mockStorage.set('orgs/org-1/media/logo1', { body: await png(512, 512) })
  fakeDocs.set('orgs/org-1/media/logo1', {
    contentType: 'image/png',
    sizeBytes: 2048,
    contentSha256: 'c'.repeat(64),
    visibleTo: options.visibleTo ?? ['org'],
    ...(options.private ? { private: true } : {}),
  })
}

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

beforeEach(() => {
  resetFakeFirestore()
  mockStorage.clear()
  stripeCalls.length = 0
  fileCounter = 0
  configurationCounter = 0
  onConfigurationCreate = null
  refuseConfigurations = false
  externalImage = null
  mockManagePos = true
  mockDevices = undefined
  mockBlocked = null
  mockPublicIp = '93.184.216.34'
  mockAudit.mockClear()
  mockOrg = { plan: 'business', subscriptionStatus: 'active', ownerUid: 'owner-1', slug: 'acme' }
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake'
  delete process.env.STRIPE_TERMINAL_LIVE_ENABLED
  fakeDocs.set('hosts/host-1', { name: 'Corner Cafe', memberRoles: { 'manager-1': 'admin', 'viewer-1': 'viewer' } })
  fakeDocs.set(configPath, { stripeLocationId: 'tml_ours' })
})

describe('Stripe’s rules for a start-up screen', () => {
  const [large, small] = POS_READER_SPLASH_FAMILIES

  it('takes a PNG or JPEG under 2 MB at exactly the reader’s screen', () => {
    expect(posReaderSplashImageProblem({ contentType: 'image/png', bytes: 1000, width: 1080, height: 1920 }, large)).toBeNull()
    expect(posReaderSplashImageProblem({ contentType: 'image/jpeg', bytes: 1000, width: 720, height: 1280 }, small)).toBeNull()
    expect(posReaderSplashImageProblem({ contentType: 'image/png', bytes: 1000, width: 720, height: 1280 }, large)).toMatch(
      /1080 × 1920 pixels; this image is 720 × 1280/,
    )
    expect(posReaderSplashImageProblem({ contentType: 'image/gif', bytes: 1000, width: 1080, height: 1920 }, large)).toMatch(/PNG or JPEG/)
    expect(posReaderSplashImageProblem({ contentType: 'image/png', bytes: 2_000_000, width: 1080, height: 1920 }, large)).toMatch(/under 2 MB/)
  })

  it('draws a logo centered on a white screen at each reader’s size, never stretched', async () => {
    const wide = await png(800, 200)
    for (const family of POS_READER_SPLASH_FAMILIES) {
      const drawn = await renderPosReaderSplash({ source: wide, family, mode: 'logo', sharp })
      expect(drawn.contentType).toBe('image/png')
      expect(drawn.body.length).toBeLessThan(2_000_000)
      expect(await sizeOf(drawn.body)).toEqual({ width: family.width, height: family.height, format: 'png' })
      const { data, info } = await sharp(drawn.body).raw().toBuffer({ resolveWithObject: true })
      const at = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3))
      expect(at(5, 5)).toEqual([255, 255, 255])
      expect(at(Math.floor(family.width / 2), Math.floor(family.height / 2))).toEqual([0, 119, 173])
      // 60% of the width, aspect kept: 800 × 200 → 648 × 162 on the large screen.
      const row = Math.floor(family.height / 2)
      let inked = 0
      for (let x = 0; x < family.width; x += 1) if (at(x, row)[0] === 0) inked += 1
      expect(Math.abs(inked - Math.round(family.width * 0.6))).toBeLessThanOrEqual(2)
    }
  })
})

describe('applying a store’s screen', () => {
  it('makes no Stripe call while there is nothing to show', async () => {
    const result = await applyPosReaderSplash('host-1')
    expect(result.outcome).toBe('unchanged')
    expect(stripeOnly()).toHaveLength(0)
  })

  it('puts the platform default on every device type of one new configuration, assigned once', async () => {
    await seedPlatformDefault()
    const result = await applyPosReaderSplash('host-1')
    expect(result.outcome).toBe('applied')
    const uploads = stripeOnly().filter((call) => call.host === 'files.stripe.com')
    expect(uploads).toHaveLength(2)
    for (const upload of uploads) {
      expect(upload.form?.get('purpose')).toBe('terminal_reader_splashscreen')
      expect(upload.key).toMatch(/^pos-splash-file:host-1:portrait-(large|small):[0-9a-f]{32}$/)
    }
    // The WisePOS E screen staff left empty is drawn from the large one.
    const smallFile = uploads.find((upload) => /portrait-small/.test(String(upload.key)))?.form?.get('file') as Blob
    expect(await sizeOf(Buffer.from(await smallFile.arrayBuffer()))).toEqual({ width: 720, height: 1280, format: 'png' })
    const [create] = configurationWrites()
    expect(create.path).toBe('terminal/configurations')
    expect(create.key).toMatch(/^pos-configuration:host-1:splash:[0-9a-f]{24}$/)
    expect(create.params.get('stripe_s700[splashscreen]')).toBe('file_1')
    expect(create.params.get('stripe_s710[splashscreen]')).toBe('file_1')
    expect(create.params.get('bbpos_wisepos_e[splashscreen]')).toBe('file_2')
    const assign = stripeOnly().find((call) => call.path === 'terminal/locations/tml_ours')
    expect(assign?.params.get('configuration_overrides')).toBe('tmc_new1')
    expect(fakeDocs.get(configPath)).toMatchObject({
      stripeConfigurationId: 'tmc_new1',
      stripeConfigurationAssigned: true,
      splashAppliedKey: expect.stringMatching(/^platform:/),
    })

    stripeCalls.length = 0
    expect((await applyPosReaderSplash('host-1')).outcome).toBe('unchanged')
    expect(stripeOnly()).toHaveLength(0)
  })

  it('sends staff’s own WisePOS E screen as uploaded', async () => {
    await seedPlatformDefault({ small: true })
    await applyPosReaderSplash('host-1')
    const uploads = stripeOnly().filter((call) => call.host === 'files.stripe.com')
    const smallFile = uploads.find((upload) => /portrait-small/.test(String(upload.key)))?.form?.get('file') as Blob
    const sent = Buffer.from(await smallFile.arrayBuffer())
    expect(sent.equals(mockStorage.get('platform/commerce/pos-reader-splash/portrait-small-bbbb.png')?.body as Buffer)).toBe(true)
  })

  it('shares tipping’s configuration: an update, no second configuration, no second assignment', async () => {
    await seedPlatformDefault()
    fakeDocs.set(configPath, { stripeLocationId: 'tml_ours', stripeConfigurationId: 'tmc_tips', tippingKey: '15,18,20' })
    await applyPosReaderSplash('host-1')
    const writes = configurationWrites()
    expect(writes.map((call) => call.path)).toEqual(['terminal/configurations/tmc_tips'])
    expect(writes[0].params.has('tipping[usd][percentages][]')).toBe(false)
    expect(stripeOnly().some((call) => call.path.startsWith('terminal/locations'))).toBe(false)

    // …and tipping's own later write lands on the same configuration, naming only tipping.
    stripeCalls.length = 0
    fakeDocs.set(configPath, { ...fakeDocs.get(configPath), tippingKey: 'old' })
    await syncPosReaderTipping('host-1', { tippingEnabled: true, tipPercentages: [10, 15, 20] } as any)
    const [tipping] = configurationWrites()
    expect(tipping.path).toBe('terminal/configurations/tmc_tips')
    expect(tipping.params.getAll('tipping[usd][percentages][]')).toEqual(['10', '15', '20'])
    expect([...tipping.params.keys()].some((key) => key.includes('splashscreen'))).toBe(false)
  })

  it('a racing first write lands on the winner’s configuration and deletes its own', async () => {
    onConfigurationCreate = () => {
      fakeDocs.set(configPath, { ...fakeDocs.get(configPath), stripeConfigurationId: 'tmc_winner', stripeConfigurationAssigned: true })
    }
    const saved = await savePosReaderConfiguration('host-1', { 'stripe_s700[splashscreen]': 'file_x' }, 'splash:k')
    expect(saved).toEqual({ ok: true, configurationId: 'tmc_winner' })
    const paths = stripeOnly().map((call) => `${call.method} ${call.path}`)
    expect(paths).toEqual([
      'POST terminal/configurations',
      'POST terminal/configurations/tmc_winner',
      'DELETE terminal/configurations/tmc_new1',
    ])
    expect(fakeDocs.get(configPath)?.['stripeConfigurationId']).toBe('tmc_winner')
  })

  it('draws the workspace logo from the org library, read from storage rather than fetched', async () => {
    await seedOrgLogo()
    mockOrg = { ...mockOrg, logoUrl: 'media:org:org-1/logo1' }
    fakeDocs.set(configPath, { stripeLocationId: 'tml_ours', splash: { choice: 'logo', updatedAtMs: 1 } })
    const result = await applyPosReaderSplash('host-1')
    expect(result.outcome).toBe('applied')
    expect(stripeCalls.some((call) => !call.host.endsWith('stripe.com'))).toBe(false)
    const file = stripeOnly().find((call) => call.host === 'files.stripe.com')?.form?.get('file') as Blob
    expect(await sizeOf(Buffer.from(await file.arrayBuffer()))).toMatchObject({ width: 1080, height: 1920 })
  })

  it('refuses a private, quarantined or unshared logo, and says why', async () => {
    mockOrg = { ...mockOrg, logoUrl: 'media:org:org-1/logo1' }
    fakeDocs.set(configPath, { stripeLocationId: 'tml_ours', splash: { choice: 'logo', updatedAtMs: 1 } })
    await seedOrgLogo({ private: true })
    expect((await applyPosReaderSplash('host-1')).problem).toMatch(/Add a logo/)
    await seedOrgLogo({ visibleTo: ['host:other-host'] })
    expect((await applyPosReaderSplash('host-1')).problem).toMatch(/Add a logo/)
    await seedOrgLogo()
    mockBlocked = 'quarantined'
    const result = await applyPosReaderSplash('host-1')
    expect(result.outcome).toBe('failed')
    expect(fakeDocs.get(configPath)?.['splashProblem']).toBe('That image could not be read.')
    expect(stripeOnly()).toHaveLength(0)
  })

  it('fetches an outside logo address only from a public address', async () => {
    externalImage = await png(400, 400)
    mockOrg = { ...mockOrg, logoUrl: 'https://cdn.example.com/logo.png' }
    fakeDocs.set(configPath, { stripeLocationId: 'tml_ours', splash: { choice: 'logo', updatedAtMs: 1 } })
    mockPublicIp = null
    expect((await applyPosReaderSplash('host-1')).outcome).toBe('failed')
    expect(stripeCalls.some((call) => call.host === 'cdn.example.com')).toBe(false)
    mockPublicIp = '93.184.216.34'
    expect((await applyPosReaderSplash('host-1')).outcome).toBe('applied')
  })

  it('never puts the platform’s screen on a white-label workspace’s readers, and clears one shown before', async () => {
    await seedPlatformDefault()
    await applyPosReaderSplash('host-1')
    expect(fakeDocs.get(configPath)?.['splashAppliedKey']).toMatch(/^platform:/)

    stripeCalls.length = 0
    mockOrg = { ...mockOrg, plan: 'agency', brandingProfile: { productName: 'Harbor Suite' } }
    fakeDocs.set(configPath, { ...fakeDocs.get(configPath), splash: { choice: 'platform', updatedAtMs: 1 } })
    const result = await applyPosReaderSplash('host-1')
    expect(result.outcome).toBe('cleared')
    expect(result.plan?.effectiveChoice).toBe('logo')
    const [clear] = configurationWrites()
    expect(clear.path).toBe('terminal/configurations/tmc_new1')
    expect(clear.params.get('stripe_s700')).toBe('')
    expect(clear.params.get('stripe_s710')).toBe('')
    expect(clear.params.get('bbpos_wisepos_e')).toBe('')
    expect(stripeOnly().some((call) => call.host === 'files.stripe.com')).toBe(false)
  })

  it('gives a white-label workspace its brand logo by default', async () => {
    await seedOrgLogo()
    await seedPlatformDefault()
    mockOrg = { ...mockOrg, plan: 'agency', brandingProfile: { productName: 'Harbor Suite', logoUrl: 'media:org:org-1/logo1' } }
    const result = await applyPosReaderSplash('host-1')
    expect(result.plan).toMatchObject({ effectiveChoice: 'logo', whiteLabel: true, productName: 'Harbor Suite' })
    expect(result.outcome).toBe('applied')
    expect(fakeDocs.get(configPath)?.['splashAppliedKey']).toMatch(/^logo:/)
  })

  it('does nothing in live mode until Terminal live mode is on', async () => {
    await seedPlatformDefault()
    process.env.STRIPE_SECRET_KEY = 'sk_live_fake'
    expect((await applyPosReaderSplash('host-1')).outcome).toBe('skipped')
    expect(stripeOnly()).toHaveLength(0)
  })
})

describe('the refresh beat: a logo change reaches the readers with no card opened', () => {
  const open = { isLocked: async () => false }
  const uploads = () => stripeOnly().filter((call) => call.host === 'files.stripe.com')

  async function logoApplied() {
    await seedOrgLogo()
    mockOrg = { ...mockOrg, logoUrl: 'media:org:org-1/logo1' }
    fakeDocs.set(configPath, { stripeLocationId: 'tml_ours', splash: { choice: 'logo', updatedAtMs: 1 } })
    expect((await applyPosReaderSplash('host-1')).outcome).toBe('applied')
    stripeCalls.length = 0
    return String(fakeDocs.get(configPath)?.['splashAppliedKey'])
  }

  it('makes no Stripe call while nothing changed', async () => {
    await logoApplied()
    expect(await refreshPosReaderSplashes(open)).toEqual({ applied: 0, unchanged: 1, failed: 0, skipped: 0, more: false })
    expect(stripeOnly()).toHaveLength(0)
  })

  it('sends a new organization logo on the next beat, onto the same configuration, once', async () => {
    const before = await logoApplied()
    mockStorage.set('orgs/org-1/media/logo2', { body: await png(600, 300) })
    fakeDocs.set('orgs/org-1/media/logo2', { contentType: 'image/png', sizeBytes: 2048, contentSha256: 'd'.repeat(64), visibleTo: ['org'] })
    mockOrg = { ...mockOrg, logoUrl: 'media:org:org-1/logo2' }

    expect(await refreshPosReaderSplashes(open)).toMatchObject({ applied: 1, failed: 0 })
    expect(uploads()).toHaveLength(2)
    expect(configurationWrites().map((call) => call.path)).toEqual(['terminal/configurations/tmc_new1'])
    expect(stripeOnly().some((call) => call.path.startsWith('terminal/locations'))).toBe(false)
    expect(fakeDocs.get(configPath)?.['splashAppliedKey']).not.toBe(before)

    stripeCalls.length = 0
    expect(await refreshPosReaderSplashes(open)).toMatchObject({ applied: 0, unchanged: 1 })
    expect(stripeOnly()).toHaveLength(0)
  })

  it('sends a logo whose file was replaced in the media library', async () => {
    await logoApplied()
    fakeDocs.set('orgs/org-1/media/logo1', { ...fakeDocs.get('orgs/org-1/media/logo1'), contentSha256: 'e'.repeat(64) })
    expect(await refreshPosReaderSplashes(open)).toMatchObject({ applied: 1 })
    expect(uploads()).toHaveLength(2)
  })

  it('leaves a locked store as it is', async () => {
    await logoApplied()
    mockOrg = { ...mockOrg, logoUrl: 'media:org:org-1/logo-gone' }
    const asked: string[] = []
    const locked = { isLocked: async (hostId: string) => (asked.push(hostId), true) }
    expect(await refreshPosReaderSplashes(locked)).toMatchObject({ applied: 0, skipped: 1 })
    expect(asked).toEqual(['host-1'])
    expect(stripeOnly()).toHaveLength(0)
  })

  it('waits before retrying a screen that failed, while opening the card retries at once', async () => {
    await logoApplied()
    fakeDocs.set('orgs/org-1/media/logo1', { ...fakeDocs.get('orgs/org-1/media/logo1'), contentSha256: 'f'.repeat(64) })
    mockBlocked = 'quarantined'
    expect(await refreshPosReaderSplashes(open)).toMatchObject({ failed: 1 })
    const failed = fakeDocs.get(configPath) as Record<string, unknown>
    expect(typeof failed['splashFailedKey']).toBe('string')

    // Inside the wait the beat leaves it, and does not stamp a new failure.
    expect(await refreshPosReaderSplashes(open)).toMatchObject({ failed: 0, skipped: 1 })
    expect(fakeDocs.get(configPath)?.['splashFailedAtMs']).toBe(failed['splashFailedAtMs'])

    // The card's own apply is not held back by it.
    expect((await applyPosReaderSplash('host-1')).outcome).toBe('failed')

    // Once the wait is over the beat tries again, and a fixed logo goes out.
    mockBlocked = null
    fakeDocs.set(configPath, {
      ...fakeDocs.get(configPath),
      splashFailedAtMs: Date.now() - POS_READER_SPLASH_RETRY_FAILED_AFTER_MS - 1,
    })
    expect(await refreshPosReaderSplashes(open)).toMatchObject({ applied: 1 })
    expect(fakeDocs.get(configPath)?.['splashProblem']).toBeUndefined()
  })

  it('does nothing in live mode until Terminal live mode is on', async () => {
    await logoApplied()
    fakeDocs.set('orgs/org-1/media/logo1', { ...fakeDocs.get('orgs/org-1/media/logo1'), contentSha256: '9'.repeat(64) })
    process.env.STRIPE_SECRET_KEY = 'sk_live_fake'
    expect(await refreshPosReaderSplashes(open)).toEqual({ applied: 0, unchanged: 0, failed: 0, skipped: 0, more: false })
    expect(stripeOnly()).toHaveLength(0)
  })

  it('is scheduled: the commerce server registers the beat at module scope, asking the lock', () => {
    const server = readFileSync(join(__dirname, '..', 'server.ts'), 'utf8')
    const block = /registerPluginJob\(\{[\s\S]*?name:\s*'pos-reader-splash-refresh'[\s\S]*?\n\}\)/.exec(server)?.[0] ?? ''
    expect(block).toContain("lockdown: { scope: 'per-host' }")
    expect(block).toContain('refreshPosReaderSplashes(gate)')
    expect(server.indexOf(block)).toBeLessThan(server.indexOf('export function register'))
  })
})

describe('a saved logo reaches the readers at once, through core’s org.logo.changed (AGL-4048)', () => {
  const open = { isLocked: async () => false }
  const uploads = () => stripeOnly().filter((call) => call.host === 'files.stripe.com')

  async function logoApplied() {
    await seedOrgLogo()
    mockOrg = { ...mockOrg, logoUrl: 'media:org:org-1/logo1' }
    fakeDocs.set('hosts/host-1', { ...fakeDocs.get('hosts/host-1'), orgId: 'org-1' })
    fakeDocs.set(configPath, { stripeLocationId: 'tml_ours', splash: { choice: 'logo', updatedAtMs: 1 } })
    expect((await applyPosReaderSplash('host-1')).outcome).toBe('applied')
    stripeCalls.length = 0
  }

  async function newLogo() {
    mockStorage.set('orgs/org-1/media/logo2', { body: await png(600, 300) })
    fakeDocs.set('orgs/org-1/media/logo2', { contentType: 'image/png', sizeBytes: 2048, contentSha256: 'd'.repeat(64), visibleTo: ['org'] })
    mockOrg = { ...mockOrg, logoUrl: 'media:org:org-1/logo2' }
  }

  afterEach(() => mockLockedHosts.clear())

  it('sends the new logo to every store of the workspace with readers, once, and nothing to another workspace', async () => {
    await logoApplied()
    // A store of another workspace, and one of this workspace with no readers.
    fakeDocs.set('hosts/host-9', { orgId: 'org-9' })
    fakeDocs.set('hosts/host-9/terminal/config', { stripeLocationId: 'tml_theirs' })
    fakeDocs.set('hosts/host-2', { orgId: 'org-1' })
    await newLogo()

    expect(await onOrgLogoChanged({ orgId: 'org-1' }, open)).toMatchObject({ applied: 1, failed: 0, unchanged: 0, skipped: 1 })
    expect(uploads()).toHaveLength(2)
    expect(configurationWrites().map((call) => call.path)).toEqual(['terminal/configurations/tmc_new1'])
    expect(fakeDocs.get('hosts/host-9/terminal/config')?.['splashAppliedKey']).toBeUndefined()

    // Raised again with nothing new, it makes no Stripe call.
    stripeCalls.length = 0
    expect(await onOrgLogoChanged({ orgId: 'org-1' }, open)).toMatchObject({ applied: 0, unchanged: 1 })
    expect(stripeOnly()).toHaveLength(0)
  })

  it('arrives through the commerce plugin’s subscription, asking the lock for each store', async () => {
    await logoApplied()
    await newLogo()
    resetPluginEventHandlersForTests()
    registerCommerceServerDeclarations()

    mockLockedHosts.add('host-1')
    await runPluginEventHandlers('org.logo.changed', {
      orgId: 'org-1',
      actor: { uid: 'manager-1', email: null },
      changed: ['logo'],
    })
    expect(stripeOnly()).toHaveLength(0)

    mockLockedHosts.clear()
    const raised = await runPluginEventHandlers('org.logo.changed', {
      orgId: 'org-1',
      actor: { uid: 'manager-1', email: null },
      changed: ['logo'],
    })
    expect(raised).toEqual({ handled: 1, failed: [] })
    expect(uploads()).toHaveLength(2)
  })

  it('does nothing for an unknown workspace, or in live mode until Terminal live mode is on', async () => {
    await logoApplied()
    await newLogo()
    expect(await onOrgLogoChanged({ orgId: 'org-404' }, open)).toMatchObject({ applied: 0, unchanged: 0 })
    process.env.STRIPE_SECRET_KEY = 'sk_live_fake'
    expect(await onOrgLogoChanged({ orgId: 'org-1' }, open)).toEqual({ applied: 0, unchanged: 0, failed: 0, skipped: 0, more: false })
    expect(stripeOnly()).toHaveLength(0)
  })

  it('never throws: a store that fails is counted, and the beat stays to retry it', async () => {
    await logoApplied()
    await newLogo()
    mockBlocked = 'quarantined'
    expect(await onOrgLogoChanged({ orgId: 'org-1' }, open)).toMatchObject({ failed: 1 })
    expect(typeof fakeDocs.get(configPath)?.['splashFailedKey']).toBe('string')
  })
})

describe('offline card mode on the same configuration (AGL-4039)', () => {
  const offlineWrites = () => configurationWrites().filter((call) => call.params.get('offline[enabled]') === 'true')

  it('turns it on in one new configuration, assigned once, and then makes no Stripe call', async () => {
    expect(await ensurePosOfflineCardConfiguration('host-1')).toBe(true)
    const [create] = configurationWrites()
    expect(create.path).toBe('terminal/configurations')
    expect(create.key).toBe('pos-configuration:host-1:offline')
    expect(create.params.get('offline[enabled]')).toBe('true')
    const assign = stripeOnly().find((call) => call.path === 'terminal/locations/tml_ours')
    expect(assign?.params.get('configuration_overrides')).toBe('tmc_new1')
    expect(fakeDocs.get(configPath)).toMatchObject({
      stripeConfigurationId: 'tmc_new1',
      stripeConfigurationAssigned: true,
      offlineEnabled: true,
      offlineConfigurationId: 'tmc_new1',
    })

    stripeCalls.length = 0
    expect(await ensurePosOfflineCardConfiguration('host-1')).toBe(true)
    expect(stripeOnly()).toHaveLength(0)
  })

  it('shares tipping’s configuration: an update naming only offline, no second configuration or assignment', async () => {
    fakeDocs.set(configPath, { stripeLocationId: 'tml_ours', stripeConfigurationId: 'tmc_tips', tippingKey: '15,18,20' })
    expect(await ensurePosOfflineCardConfiguration('host-1')).toBe(true)
    const writes = configurationWrites()
    expect(writes.map((call) => call.path)).toEqual(['terminal/configurations/tmc_tips'])
    expect([...writes[0].params.keys()]).toEqual(['offline[enabled]'])
    expect(stripeOnly().some((call) => call.path.startsWith('terminal/locations'))).toBe(false)
    expect(fakeDocs.get(configPath)).toMatchObject({ stripeConfigurationId: 'tmc_tips', offlineConfigurationId: 'tmc_tips' })
  })

  it('racing tipping to the first write, lands on the winner’s configuration and keeps the winner’s id', async () => {
    // Tipping claims the site's configuration while offline mode's create is
    // in flight. Before AGL-4039's fix offline mode then overwrote the id
    // with its own, unassigned configuration, so the readers kept the
    // winner's, which never had offline turned on.
    onConfigurationCreate = () => {
      fakeDocs.set(configPath, { ...fakeDocs.get(configPath), stripeConfigurationId: 'tmc_tips', stripeConfigurationAssigned: true })
    }
    expect(await ensurePosOfflineCardConfiguration('host-1')).toBe(true)
    expect(stripeOnly().map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST terminal/configurations',
      'POST terminal/configurations/tmc_tips',
      'DELETE terminal/configurations/tmc_new1',
    ])
    expect(offlineWrites().map((call) => call.path)).toEqual(['terminal/configurations', 'terminal/configurations/tmc_tips'])
    expect(fakeDocs.get(configPath)).toMatchObject({
      stripeConfigurationId: 'tmc_tips',
      stripeConfigurationAssigned: true,
      offlineEnabled: true,
      offlineConfigurationId: 'tmc_tips',
    })
  })

  it('finishes an assignment a previous first write left owing', async () => {
    fakeDocs.set(configPath, { stripeLocationId: 'tml_ours', stripeConfigurationId: 'tmc_owed', stripeConfigurationAssigned: false })
    expect(await ensurePosOfflineCardConfiguration('host-1')).toBe(true)
    const assign = stripeOnly().find((call) => call.path === 'terminal/locations/tml_ours')
    expect(assign?.params.get('configuration_overrides')).toBe('tmc_owed')
    expect(fakeDocs.get(configPath)).toMatchObject({ stripeConfigurationAssigned: true, offlineConfigurationId: 'tmc_owed' })
  })

  it.each([
    ['set on a configuration the site no longer uses', { offlineEnabled: true, offlineConfigurationId: 'tmc_old' }],
    ['recorded before it named its configuration', { offlineEnabled: true }],
    ['on a configuration still owed its assignment', { offlineEnabled: true, offlineConfigurationId: 'tmc_tips', stripeConfigurationAssigned: false }],
  ])('sets it again when the flag was %s', async (_label, cached) => {
    fakeDocs.set(configPath, { stripeLocationId: 'tml_ours', stripeConfigurationId: 'tmc_tips', ...cached })
    expect(await ensurePosOfflineCardConfiguration('host-1')).toBe(true)
    expect(offlineWrites().map((call) => call.path)).toEqual(['terminal/configurations/tmc_tips'])
    expect(fakeDocs.get(configPath)?.['offlineConfigurationId']).toBe('tmc_tips')
  })

  it('answers false and records nothing when Stripe refuses it, or the site has no Location', async () => {
    refuseConfigurations = true
    expect(await ensurePosOfflineCardConfiguration('host-1')).toBe(false)
    expect(fakeDocs.get(configPath)?.['offlineEnabled']).toBeUndefined()
    refuseConfigurations = false
    stripeCalls.length = 0
    fakeDocs.set(configPath, {})
    expect(await ensurePosOfflineCardConfiguration('host-1')).toBe(false)
    expect(stripeOnly()).toHaveLength(0)
  })
})

describe('the POS devices card’s setting', () => {
  it('is gated like a sale', async () => {
    expect((await store({ action: 'status' }, 'viewer')).status).toBe(403)
    mockManagePos = false
    expect((await store({ action: 'status' })).status).toBe(403)
  })

  it('asks the permission, not the site role: a viewer granted the register reads it (AGL-4047)', async () => {
    mockRegisterGranted = true
    try {
      expect((await store({ action: 'status' }, 'viewer')).status).toBe(200)
    } finally {
      mockRegisterGranted = undefined
    }
  })

  it('is read by anyone at the register and changed only with the devices key (AGL-4047)', async () => {
    mockDevices = false
    expect((await store({ action: 'status' })).status).toBe(200)
    const refused = await store({ action: 'save', choice: 'platform' })
    expect(refused.status).toBe(403)
    expect(refused.body.error).toContain('Registers and devices')
    expect(stripeCalls).toHaveLength(0)
    mockDevices = undefined
  })

  it('reports the default choice and what it would use', async () => {
    const result = await store({ action: 'status' })
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({
      available: true,
      choice: null,
      effectiveChoice: 'platform',
      whiteLabel: false,
      platformReady: false,
      logoUrl: null,
      locationReady: true,
    })
    expect(typeof result.body.productName).toBe('string')
    expect(result.body.productName.length).toBeGreaterThan(0)
  })

  it('refuses the platform screen to a white-label workspace', async () => {
    mockOrg = { ...mockOrg, plan: 'agency', brandingProfile: { productName: 'Harbor Suite' } }
    const result = await store({ action: 'save', choice: 'platform' })
    expect(result.status).toBe(400)
    expect(fakeDocs.get(configPath)?.['splash']).toBeUndefined()
  })

  it('takes only an image from this site’s or its org’s library', async () => {
    fakeDocs.set('orgs/other-org/media/pic', { contentType: 'image/png', visibleTo: ['org'] })
    expect((await store({ action: 'save', choice: 'image', mediaScope: 'org:other-org', mediaId: 'pic' })).status).toBe(400)
    fakeDocs.set('orgs/org-1/media/clip', { contentType: 'video/mp4', visibleTo: ['org'] })
    expect((await store({ action: 'save', choice: 'image', mediaScope: 'org:org-1', mediaId: 'clip' })).status).toBe(400)
  })

  it('saves an image, checks its shape before anything reaches Stripe, and says why it was refused', async () => {
    mockStorage.set('hosts/host-1/media/wide', { body: await png(1920, 1080) })
    fakeDocs.set('hosts/host-1/media/wide', { contentType: 'image/png', contentSha256: 'd'.repeat(64) })
    const refused = await store({ action: 'save', choice: 'image', mediaScope: 'host-1', mediaId: 'wide' })
    expect(refused.status).toBe(200)
    expect(refused.body.problem).toMatch(/portrait image shaped 9:16/)
    expect(stripeOnly()).toHaveLength(0)

    mockStorage.set('hosts/host-1/media/tall', { body: await png(1080, 1920) })
    fakeDocs.set('hosts/host-1/media/tall', { contentType: 'image/png', contentSha256: 'e'.repeat(64) })
    const saved = await store({ action: 'save', choice: 'image', mediaScope: 'host-1', mediaId: 'tall' })
    expect(saved.body).toMatchObject({ choice: 'image', effectiveChoice: 'image', problem: null })
    expect(saved.body.image).toMatchObject({ mediaScope: 'host-1', mediaId: 'tall' })
    expect(fakeDocs.get(configPath)?.['splash']).toMatchObject({ choice: 'image', mediaId: 'tall', updatedBy: 'manager-1' })
    expect(stripeOnly().filter((call) => call.host === 'files.stripe.com')).toHaveLength(2)
  })

  it('refuses to save while card readers are not offered', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_fake'
    expect((await store({ action: 'save', choice: 'logo' })).status).toBe(409)
    expect((await store({ action: 'status' })).body.available).toBe(false)
  })
})

describe('the staff default', () => {
  it('admits staff only, and writes only for super', async () => {
    expect((await staff('GET', undefined, 'member')).status).toBe(403)
    const read = await staff('GET', undefined, 'staff-support')
    expect(read.status).toBe(200)
    expect(read.body).toMatchObject({ ready: false, canWrite: false })
    expect((await staff('POST', { action: 'apply' }, 'staff-support')).status).toBe(403)
    expect((await staff('GET', undefined, 'nobody')).status).toBe(401)
  })

  it('checks each image against Stripe’s rules before it is kept', async () => {
    const wrong = (await png(720, 1280)).toString('base64')
    const refused = await staff('POST', { action: 'upload', family: 'portrait-large', dataBase64: wrong })
    expect(refused.status).toBe(400)
    expect(refused.body.error).toMatch(/1080 × 1920 pixels; this image is 720 × 1280/)
    expect(mockStorage.size).toBe(0)
    expect(mockAudit).not.toHaveBeenCalled()
  })

  it('stores a good image, audits it, previews it, and brings every store up to date', async () => {
    fakeDocs.set('hosts/host-2/terminal/config', { stripeLocationId: 'tml_two' })
    fakeDocs.set('hosts/host-3/terminal/config', {})
    const good = await png(1080, 1920)
    const saved = await staff('POST', { action: 'upload', family: 'portrait-large', dataBase64: good.toString('base64') })
    expect(saved.status).toBe(200)
    expect(saved.body.ready).toBe(true)
    expect([...mockStorage.keys()]).toEqual([expect.stringMatching(/^platform\/commerce\/pos-reader-splash\/portrait-large-[0-9a-f]{16}\.png$/)])
    expect(mockAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'pos-reader-splash-upload', actorUid: 'staff-1', scope: 'posReaderSplash' }),
    )

    const preview = await staff('GET', undefined, 'staff-support', '?preview=portrait-large')
    expect(preview.status).toBe(200)
    expect(preview.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(preview.body as ArrayBuffer).equals(good)).toBe(true)

    const applied = await staff('POST', { action: 'apply' })
    expect(applied.body).toMatchObject({ applied: 2, failed: 0, more: false })
    expect(fakeDocs.get('hosts/host-2/terminal/config')?.['splashAppliedKey']).toMatch(/^platform:/)
    // Applying again changes nothing anywhere.
    stripeCalls.length = 0
    expect((await staff('POST', { action: 'apply' })).body).toMatchObject({ applied: 0, unchanged: 2 })
    expect(stripeOnly()).toHaveLength(0)

    const removed = await staff('POST', { action: 'remove', family: 'portrait-large' })
    expect(removed.body.ready).toBe(false)
    expect(mockStorage.size).toBe(0)
    expect((await staff('POST', { action: 'apply' })).body).toMatchObject({ applied: 2 })
    expect(fakeDocs.get('hosts/host-2/terminal/config')?.['splashAppliedKey']).toBe('none')
  })
})
