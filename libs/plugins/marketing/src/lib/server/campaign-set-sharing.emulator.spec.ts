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
 * `setSharing` on a campaign against a real Firestore (AGL-4047): the real field
 * deletes, the transaction with a site being created, the sweep finding what the
 * route wrote, and the site door refusing a marked campaign down to one site.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. With the emulator up:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/plugins/marketing/jest.config.ts \
 *       --testPathPatterns campaign-set-sharing.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { runScopeSharingSweep } from '@aglyn/tenant-data-admin/server/scope-sharing-sweep'
import type { PluginApiResponse } from '@aglyn/aglyn/server'
import { campaignManageHandler } from './campaign-manage'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
if (EMULATED && !getApps().length) initializeApp({ projectId: 'aglyn-main' })

const ORG = 'e2e-campaign-sharing-org'
const CAMPAIGN = 'e2e-campaign-sharing'
const [A, B, C, NEW] = ['e2e-camp-a', 'e2e-camp-b', 'e2e-camp-c', 'e2e-camp-new']

/** Who is asking: a member of the whole workspace, or a site Admin of A alone. */
let mockMember: Record<string, unknown> = { role: 'editor', allHosts: true }

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => {
  const { getFirestore: real, FieldValue } = jest.requireActual('firebase-admin/firestore')
  return {
    __esModule: true,
    default: {
      app: () => ({
        auth: () => ({ verifyIdToken: async () => ({ uid: 'user-1' }) }),
        firestore: () => real(),
      }),
      firestore: { FieldValue },
    },
  }
})
jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  getOrgDoc: async () => ({}),
  memberHasOrgPermission: async () => true,
  resolveOrgIdForHost: async () => 'e2e-campaign-sharing-org',
  resolveOrgMembership: async () => ({ member: mockMember }),
}))

function respond() {
  const result = { status: 0, body: undefined as any }
  const res: PluginApiResponse = {
    status(code) {
      result.status = code
      return res
    },
    json(body) {
      result.body = body
    },
    send(body) {
      result.body = body
    },
    setHeader() {
      /* unused */
    },
    redirect() {
      /* unused */
    },
    end() {
      /* unused */
    },
  }
  return { res, result }
}

async function post(body: Record<string, unknown>) {
  const { res, result } = respond()
  await campaignManageHandler(
    { method: 'POST', query: {}, body, cookies: {}, headers: { authorization: 'Bearer token' } } as never,
    res,
  )
  return result
}

const suite = EMULATED ? describe : describe.skip

suite('a campaign’s sharing against the emulator', () => {
  let db: Firestore
  const setSharing = (choice: Record<string, unknown>) =>
    post({ orgId: ORG, action: 'setSharing', campaignId: CAMPAIGN, choice })
  const campaign = () => db.collection('orgs').doc(ORG).collection('emailCampaigns').doc(CAMPAIGN)
  const stored = async () => (await campaign().get()).data() as Record<string, unknown>
  const hosts = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, true]))

  beforeAll(() => {
    db = getFirestore()
  })

  beforeEach(async () => {
    mockMember = { role: 'editor', allHosts: true }
    await db.recursiveDelete(db.collection('orgs').doc(ORG))
    await db.collection('orgs').doc(ORG).set({ hosts: hosts(A, B, C) })
    await campaign().set({ name: 'Spring sale', visibleTo: ['org'], listIds: [] })
    await db.collection('hosts').doc(A).set({ orgId: ORG, memberRoles: { 'user-1': 'admin' } })
  })

  afterAll(async () => {
    if (!db) return
    await db.recursiveDelete(db.collection('orgs').doc(ORG))
    await db.collection('hosts').doc(A).delete()
  })

  it('writes the sites in and the marker', async () => {
    expect((await setSharing({ mode: 'allExcept', exceptHostIds: [B] })).status).toBe(200)
    expect(await stored()).toMatchObject({
      name: 'Spring sale',
      visibleTo: [`host:${A}`, `host:${C}`],
      scopeMode: 'allExcept',
      scopeExcept: [`host:${B}`],
    })
  })

  it.each([
    ['All sites', { mode: 'all' }, ['org']],
    ['chosen sites', { mode: 'selected', hostIds: [A] }, [`host:${A}`]],
  ])('moving to %s deletes both marker fields, and stores no null', async (_name, choice, visibleTo) => {
    await setSharing({ mode: 'allExcept', exceptHostIds: [B] })
    expect((await setSharing(choice)).status).toBe(200)
    const after = await stored()
    expect(after['visibleTo']).toEqual(visibleTo)
    expect(Object.keys(after)).not.toContain('scopeMode')
    expect(Object.keys(after)).not.toContain('scopeExcept')
  })

  it('what it writes, the sweep finds, and a new site joins', async () => {
    await setSharing({ mode: 'allExcept', exceptHostIds: [B] })
    await db.collection('orgs').doc(ORG).update({ [`hosts.${NEW}`]: true })

    await runScopeSharingSweep({ orgId: ORG })

    expect(await stored()).toMatchObject({
      visibleTo: [`host:${A}`, `host:${C}`, `host:${NEW}`].sort(),
      scopeExcept: [`host:${B}`],
    })
  })

  it('a site created at the same moment always ends up on the campaign', async () => {
    for (let round = 0; round < 10; round += 1) {
      const site = `e2e-camp-race-${round}`
      await campaign().set({ name: 'Spring sale', visibleTo: ['org'], listIds: [] })
      await db.collection('orgs').doc(ORG).set({ hosts: hosts(A, B, C) })
      const claim = async () => {
        await db.collection('orgs').doc(ORG).update({ [`hosts.${site}`]: true })
        await runScopeSharingSweep({ orgId: ORG })
      }
      const [answer] = await Promise.all([setSharing({ mode: 'allExcept', exceptHostIds: [B] }), claim()])
      expect(answer.status).toBe(200)
      expect((await stored())['visibleTo']).toContain(`host:${site}`)
    }
  }, 60_000)

  it('down to one site, it is not that site’s Admin’s to delete', async () => {
    await setSharing({ mode: 'allExcept', exceptHostIds: [B, C] })
    expect((await stored())['visibleTo']).toEqual([`host:${A}`])
    mockMember = { role: 'viewer', allHosts: false, hostAccess: { [A]: 'admin' } }

    const refused = await post({ hostId: A, action: 'deleteCampaign', campaignId: CAMPAIGN })

    expect(refused.status).toBe(403)
    expect((await campaign().get()).exists).toBe(true)
  })

  it('THE CONTROL: the same campaign chosen for that site alone is its Admin’s to delete', async () => {
    await setSharing({ mode: 'selected', hostIds: [A] })
    mockMember = { role: 'viewer', allHosts: false, hostAccess: { [A]: 'admin' } }

    const allowed = await post({ hostId: A, action: 'deleteCampaign', campaignId: CAMPAIGN })

    expect(allowed.status).toBe(200)
    expect((await campaign().get()).exists).toBe(false)
  })
})
