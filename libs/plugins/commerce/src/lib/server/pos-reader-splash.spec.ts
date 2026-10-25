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

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { fakeDocs, resetFakeFirestore } from '../testing/fake-firestore'

const sharp = require('sharp')

let mockManagePos = true
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

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({ permissions: { managePos: mockManagePos } }),
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
    emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
    isImpersonationSession: () => false,
  }
})
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
import { applyPosReaderSplash, posReaderSplashHandler } from './pos-reader-splash'
import { renderPosReaderSplash } from './pos-reader-splash-render'
import { savePosReaderConfiguration, syncPosReaderTipping } from './pos-terminal'

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
  externalImage = null
  mockManagePos = true
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

describe('the POS devices card’s setting', () => {
  it('is gated like a sale', async () => {
    expect((await store({ action: 'status' }, 'viewer')).status).toBe(403)
    mockManagePos = false
    expect((await store({ action: 'status' })).status).toBe(403)
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
