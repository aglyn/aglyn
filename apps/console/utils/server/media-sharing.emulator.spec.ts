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
 * The workspace media library's `set-sharing` against a real Firestore
 * (AGL-4047): the real route, the real field deletes, the folder cascade, the
 * sweep finding what the route wrote, and racing a site being created.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set, so it can never touch
 * production. With the emulator up:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c apps/console/jest.config.ts \
 *       --testPathPatterns media-sharing.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { runScopeSharingSweep } from '@aglyn/tenant-data-admin/server/scope-sharing-sweep'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
if (EMULATED && !getApps().length) initializeApp({ projectId: 'aglyn-main' })

const ORG = 'e2e-media-sharing-org'
const [A, B, C, NEW] = ['e2e-media-a', 'e2e-media-b', 'e2e-media-c', 'e2e-media-new']

/** Who is asking: a member of the whole workspace, or one invited to site A. */
let mockMember: Record<string, unknown> = { role: 'editor', allHosts: true }

jest.mock('@aglyn/tenant-data-admin', () => {
  const { getFirestore: real, FieldValue } = jest.requireActual('firebase-admin/firestore')
  return {
    __esModule: true,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: async () => ({ uid: 'user-1', email_verified: true }) }),
        firestore: () => real(),
        storage: () => ({
          bucket: () => ({
            name: 'bucket',
            file: () => {
              throw new Error('BLOCKED: sharing never reaches Cloud Storage')
            },
          }),
        }),
      }),
      firestore: { FieldValue },
    },
    isImpersonationSession: () => false,
    emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
    getLockdownVerdict: async () => null,
    featureLockdownRefusal: async () => null,
    lockdownJsonResponse: () => Response.json({ error: 'locked' }, { status: 423 }),
    getOrgDoc: async () => ({ plan: 'pro' }),
    getOrgForHost: async () => null,
    resolveOrgMembership: async () => ({ orgId: 'e2e-media-sharing-org', member: mockMember }),
    memberHasOrgPermission: async (_orgId: string, _member: unknown, key: string) => key === 'org.media',
  }
})

import { POST } from '../../app/api/media/folders/route'

const suite = EMULATED ? describe : describe.skip

suite('the media library’s set-sharing against the emulator', () => {
  let db: Firestore
  const org = () => db.collection('orgs').doc(ORG)
  const media = (id: string) => org().collection('media').doc(id)
  const folder = (id: string) => org().collection('mediaFolders').doc(id)
  const stored = async (ref: FirebaseFirestore.DocumentReference) =>
    (await ref.get()).data() as Record<string, unknown>
  const hosts = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, true]))

  const post = (body: Record<string, unknown>) =>
    POST(
      new Request('https://console.test/api/media/folders', {
        method: 'POST',
        headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
        body: JSON.stringify({ orgId: ORG, ...body }),
      }),
    )
  const share = (mediaIds: string[], choice: Record<string, unknown>) =>
    post({ action: 'set-sharing', mediaIds, choice })

  beforeAll(() => {
    db = getFirestore()
  })

  beforeEach(async () => {
    mockMember = { role: 'editor', allHosts: true }
    await db.recursiveDelete(org())
    await org().set({ plan: 'pro', hosts: hosts(A, B, C) })
    await media('hero').set({ fileName: 'hero.png', folderId: 'brand', visibleTo: ['org'] })
    await media('logo').set({ fileName: 'logo.png', folderId: 'inner', visibleTo: ['org'] })
    await media('loose').set({ fileName: 'loose.png', folderId: null, visibleTo: ['org'] })
    await folder('brand').set({ name: 'Brand', parentId: null, visibleTo: ['org'] })
    await folder('inner').set({ name: 'Inner', parentId: 'brand', visibleTo: ['org'] })
  })

  afterAll(async () => {
    if (EMULATED) await db.recursiveDelete(org())
  })

  it('writes the sites in and the marker, on a file', async () => {
    const response = await share(['loose'], { mode: 'allExcept', exceptHostIds: [B] })
    expect(response.status).toBe(200)
    expect(await stored(media('loose'))).toMatchObject({
      visibleTo: [`host:${A}`, `host:${C}`],
      scopeMode: 'allExcept',
      scopeExcept: [`host:${B}`],
    })
  })

  it.each([
    ['All sites', { mode: 'all' }, ['org']],
    ['chosen sites', { mode: 'selected', hostIds: [A] }, [`host:${A}`]],
  ])('moving to %s deletes both marker fields, and stores no null', async (_name, choice, visibleTo) => {
    await share(['loose'], { mode: 'allExcept', exceptHostIds: [B] })
    expect((await share(['loose'], choice)).status).toBe(200)
    const after = await stored(media('loose'))
    expect(after['visibleTo']).toEqual(visibleTo)
    expect(Object.keys(after)).not.toContain('scopeMode')
    expect(Object.keys(after)).not.toContain('scopeExcept')
  })

  it('an older client’s set-scope on a marked folder takes the marker off', async () => {
    await post({ action: 'set-sharing', folderId: 'brand', choice: { mode: 'allExcept', exceptHostIds: [B] } })
    expect(await stored(folder('brand'))).toMatchObject({ scopeMode: 'allExcept' })

    const response = await post({ action: 'set-scope', folderId: 'brand', visibleTo: [`host:${A}`] })
    expect(response.status).toBe(200)
    for (const ref of [folder('brand'), media('hero'), media('logo')]) {
      const after = await stored(ref)
      expect(after['visibleTo']).toEqual([`host:${A}`])
      expect(Object.keys(after)).not.toContain('scopeMode')
    }
  })

  it('a folder carries the choice to every file under it, in slices, and counts first', async () => {
    const preview = await post({ action: 'set-sharing', folderId: 'brand', preview: true })
    expect(await preview.json()).toEqual({ ok: true, preview: true, folders: 1, assets: 2 })
    expect(await stored(media('hero'))).not.toHaveProperty('scopeMode')

    let cursor = 0
    for (;;) {
      const response = await post({
        action: 'set-sharing',
        folderId: 'brand',
        choice: { mode: 'allExcept', exceptHostIds: [C] },
        chunkStart: cursor,
        chunkSize: 2,
      })
      const payload = await response.json()
      expect(response.status).toBe(200)
      cursor = payload.next
      if (payload.done) break
    }
    for (const ref of [folder('brand'), media('hero'), media('logo')]) {
      expect(await stored(ref)).toMatchObject({
        visibleTo: [`host:${A}`, `host:${B}`],
        scopeMode: 'allExcept',
        scopeExcept: [`host:${C}`],
      })
    }
    // A subfolder is a folder, not a file: as before, it keeps its own.
    expect(await stored(folder('inner'))).toMatchObject({ visibleTo: ['org'] })
    expect(await stored(media('loose'))).toMatchObject({ visibleTo: ['org'] })
  })

  it('refuses leaving every site out, and writes nothing', async () => {
    const response = await share(['hero', 'logo'], { mode: 'allExcept', exceptHostIds: [A, B, C] })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/at least one site/i)
    for (const ref of [media('hero'), media('logo')]) {
      expect(await stored(ref)).toMatchObject({ visibleTo: ['org'] })
      expect(await stored(ref)).not.toHaveProperty('scopeMode')
    }
  })

  it('drops a chosen site the workspace doesn’t hold, and names missing files', async () => {
    const response = await share(['hero', 'gone'], { mode: 'selected', hostIds: [A, 'not-ours'] })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ written: 1, missingIds: ['gone'] })
    expect((await stored(media('hero')))['visibleTo']).toEqual([`host:${A}`])
    expect((await media('gone').get()).exists).toBe(false)
  })

  it('refuses a member invited to some sites, as it always has', async () => {
    mockMember = { role: 'editor', allHosts: false, hostAccess: { [A]: 'editor' }, scopeTokens: ['org', `host:${A}`] }
    const response = await share(['hero'], { mode: 'allExcept', exceptHostIds: [B] })
    expect(response.status).toBe(403)
    expect(await stored(media('hero'))).not.toHaveProperty('scopeMode')
  })

  it('what it writes, the sweep finds, and a new site joins', async () => {
    await share(['hero'], { mode: 'allExcept', exceptHostIds: [B] })
    await post({ action: 'set-sharing', folderId: 'inner', choice: { mode: 'allExcept', exceptHostIds: [B] }, cascade: false })
    await org().update({ [`hosts.${NEW}`]: true })

    await runScopeSharingSweep({ orgId: ORG })

    for (const ref of [media('hero'), folder('inner')]) {
      expect(await stored(ref)).toMatchObject({
        visibleTo: [`host:${A}`, `host:${C}`, `host:${NEW}`].sort(),
        scopeExcept: [`host:${B}`],
      })
    }
  })

  it('a site created while the choice is written is never missed', async () => {
    for (const site of ['e2e-media-race-1', 'e2e-media-race-2', 'e2e-media-race-3']) {
      const claim = async () => {
        await org().update({ [`hosts.${site}`]: true })
        await runScopeSharingSweep({ orgId: ORG })
      }
      const [response] = await Promise.all([share(['loose'], { mode: 'allExcept', exceptHostIds: [B] }), claim()])
      expect(response.status).toBe(200)
      expect((await stored(media('loose')))['visibleTo']).toContain(`host:${site}`)
    }
  }, 60_000)
})
