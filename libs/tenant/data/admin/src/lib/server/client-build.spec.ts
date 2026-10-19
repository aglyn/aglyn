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
 * AGL-3958 — the one-screen build for a client, on the server: the record
 * staff keep for it, the intent it derives for the hand-off, and the preview
 * texted and emailed to the owner.
 */

import { registerPluginSmsMessaging } from '@aglyn/aglyn/plugin-manager/plugin-sms-messaging'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'

type Doc = Record<string, unknown>

let store = new Map<string, Doc>()

const mockSnapshot = (path: string) => ({
  exists: store.has(path),
  data: () => store.get(path),
  get: (field: string) => (store.get(path) ?? {})[field],
})
function mockMakeDoc(path: string): any {
  return {
    path,
    collection: (name: string) => mockMakeCollection(`${path}/${name}`),
    get: async () => mockSnapshot(path),
    set: async (data: Doc, options?: { merge?: boolean }) => {
      for (const [key, value] of Object.entries(data)) {
        if (value === undefined) throw new Error(`Cannot use "undefined" as a Firestore value (${key})`)
      }
      store.set(path, options?.merge ? { ...(store.get(path) ?? {}), ...data } : data)
    },
  }
}
function mockMakeCollection(prefix: string): any {
  return { doc: (id: string) => mockMakeDoc(`${prefix}/${id}`) }
}

const mockAudits: Doc[] = []
const mockSent: Doc[] = []
const mockTexts: Doc[] = []
const mockRendered: Doc[] = []

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: {
    app: () => ({ firestore: () => ({ collection: (name: string) => mockMakeCollection(name) }) }),
    firestore: { FieldValue: { serverTimestamp: () => '__now__' } },
  },
}))
jest.mock('./admin-audit-write', () => ({
  __esModule: true,
  addAdminAudit: async (_firestore: unknown, entry: Doc) => {
    mockAudits.push(entry)
  },
}))
jest.mock('./email-metering', () => ({ __esModule: true, meterOrgEmail: async () => undefined }))
jest.mock('./render-system-email', () => ({
  __esModule: true,
  systemEmailBrand: () => ({ merge: { 'brand.productName': 'Aglyn' }, options: {}, fromName: 'Aglyn' }),
  renderSystemEmailContent: async (
    key: string,
    merge: Record<string, string>,
    _brand: unknown,
    fallback: { subject: string; text: string },
  ) => {
    mockRendered.push({ key, merge })
    return fallback
  },
}))
jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => true,
  sendEmail: async (message: Doc) => {
    mockSent.push(message)
    return { sent: true }
  },
}))

import { loadClientBuild, saveClientBuild, sendClientBuildPreview } from './client-build'

const INTAKE = {
  businessName: 'Harbor Plumbing',
  whatTheyDo: 'a family plumbing business',
  towns: 'Austin',
  phone: '(512) 555-0123',
  email: 'owner@example.com',
  hours: '',
  ownerWords: '',
}
const RECORD = 'orgs/org-1/clientBuild/current'

const registerTexts = () =>
  registerPluginSmsMessaging(
    {
      isConfigured: () => true,
      send: async (request) => {
        mockTexts.push(request as unknown as Doc)
        return { status: 'sent', id: 'sm1', to: request.to, segments: 1 }
      },
    },
    { pluginId: 'sms' },
  )

beforeEach(() => {
  store = new Map()
  mockAudits.length = 0
  mockSent.length = 0
  mockTexts.length = 0
  mockRendered.length = 0
  resetPluginServicesForTests()
  store.set('orgs/org-1', {
    name: 'Harbor Plumbing',
    entitlements: { planComp: { plan: 'pro', uncapped: false, reason: 'trial' } },
  })
  store.set('hosts/host-1', { orgId: 'org-1', subdomain: 'harbor', screens: {} })
  store.set('hosts/elsewhere', { orgId: 'org-2', subdomain: 'other', screens: {} })
})

describe('saving a client build (AGL-3958)', () => {
  it('stores the intake with the intent derived from the comp, never from the body', async () => {
    const record = await saveClientBuild({ orgId: 'org-1', actorUid: 'staff-1', patch: { intake: INTAKE }, now: 5 })
    expect(record).toMatchObject({
      intake: INTAKE,
      domain: null,
      intent: { plan: 'pro', addons: ['siteCare'], interval: 'month' },
      hostId: null,
      jobId: null,
      starter: false,
      updatedAt: 5,
      updatedBy: 'staff-1',
    })
    expect(store.get(RECORD)).toEqual(record)
  })

  it('merges a later step over what is stored, and puts the picked domain on the intent', async () => {
    await saveClientBuild({ orgId: 'org-1', actorUid: 'staff-1', patch: { intake: INTAKE } })
    const domain = { choice: 'register', name: 'harborplumbing.com', firstYearUsd: 11.25, renewalUsd: 18.99 }
    await saveClientBuild({ orgId: 'org-1', actorUid: 'staff-1', patch: { domain } })
    const record = await saveClientBuild({ orgId: 'org-1', actorUid: 'staff-1', patch: { hostId: 'host-1' } })
    expect(record).toMatchObject({
      intake: INTAKE,
      domain,
      hostId: 'host-1',
      host: 'harbor',
      intent: { domain: { name: 'harborplumbing.com', firstYearUsd: 11.25, renewalUsd: 18.99 } },
    })
    // Changing the answer to the free address takes the domain off the intent.
    const free = await saveClientBuild({ orgId: 'org-1', actorUid: 'staff-1', patch: { domain: { choice: 'free' } } })
    expect(free.intent).not.toHaveProperty('domain')
    expect(await loadClientBuild('org-1')).toEqual(free)
  })

  it('records the starter site given instead of a guided start, and refuses anything but a yes or no', async () => {
    await saveClientBuild({ orgId: 'org-1', actorUid: 'staff-1', patch: { intake: INTAKE } })
    const record = await saveClientBuild({ orgId: 'org-1', actorUid: 'staff-1', patch: { starter: true } })
    expect(record).toMatchObject({ starter: true, jobId: null })
    expect((await loadClientBuild('org-1'))?.starter).toBe(true)
    await expect(
      saveClientBuild({ orgId: 'org-1', actorUid: 'staff-1', patch: { starter: 'yes' } }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('refuses an unknown workspace, an intake that does not validate, and a site from another workspace', async () => {
    await expect(
      saveClientBuild({ orgId: 'nope', actorUid: 'staff-1', patch: { intake: INTAKE } }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      saveClientBuild({ orgId: 'org-1', actorUid: 'staff-1', patch: { intake: { ...INTAKE, businessName: '' } } }),
    ).rejects.toMatchObject({ status: 400, message: 'Name the business.' })
    await saveClientBuild({ orgId: 'org-1', actorUid: 'staff-1', patch: { intake: INTAKE } })
    await expect(
      saveClientBuild({ orgId: 'org-1', actorUid: 'staff-1', patch: { hostId: 'elsewhere' } }),
    ).rejects.toMatchObject({ status: 400 })
    expect(store.get(RECORD)?.['hostId']).toBeNull()
  })
})

describe('sending the owner the preview (AGL-3958)', () => {
  beforeEach(async () => {
    await saveClientBuild({
      orgId: 'org-1',
      actorUid: 'staff-1',
      patch: { intake: INTAKE, domain: { choice: 'own', name: 'harborplumbing.com' }, hostId: 'host-1' },
    })
  })

  it('waits for a published page', async () => {
    await expect(sendClientBuildPreview({ orgId: 'org-1', actorUid: 'staff-1' })).rejects.toMatchObject({
      status: 409,
      message: 'The site has no published page yet',
    })
    expect(mockSent).toHaveLength(0)
  })

  it('texts and emails the link and the address it will live at, and audits which channels went', async () => {
    registerTexts()
    store.set('hosts/host-1', { orgId: 'org-1', subdomain: 'harbor', screens: { home: {} } })
    const outcome = await sendClientBuildPreview({ orgId: 'org-1', actorUid: 'staff-1', now: 99 })
    expect(outcome).toMatchObject({ emailed: true, text: 'sent', siteAddress: 'harborplumbing.com' })
    expect(outcome.previewUrl).toMatch(/^https:\/\/harbor\./)
    expect(mockRendered).toEqual([
      {
        key: 'client-build-preview',
        merge: {
          'business.name': 'Harbor Plumbing',
          'preview.url': outcome.previewUrl,
          'site.address': 'harborplumbing.com',
        },
      },
    ])
    expect(mockSent).toEqual([
      expect.objectContaining({ to: 'owner@example.com', fromName: 'Aglyn', context: 'client-build-preview' }),
    ])
    expect(mockTexts).toEqual([
      expect.objectContaining({
        to: '+15125550123',
        hostId: 'host-1',
        purpose: 'transactional',
        body: expect.stringContaining('harborplumbing.com'),
      }),
    ])
    expect(mockTexts[0]).not.toHaveProperty('quietHours')
    expect(store.get(RECORD)?.['previewSentAt']).toBe(99)
    expect(mockAudits).toEqual([
      expect.objectContaining({
        actorUid: 'staff-1',
        action: 'client-build.preview-sent',
        target: 'orgs/org-1',
        after: { hostId: 'host-1', emailed: true, text: 'sent' },
      }),
    ])
    expect(JSON.stringify(mockAudits)).not.toMatch(/owner@example|555/)
  })

  it('emails only, and says so, where no text provider is set up', async () => {
    store.set('hosts/host-1', { orgId: 'org-1', subdomain: 'harbor', screens: { home: {} } })
    const outcome = await sendClientBuildPreview({ orgId: 'org-1', actorUid: 'staff-1' })
    expect(outcome).toMatchObject({ emailed: true, text: 'unavailable' })
    expect(mockTexts).toHaveLength(0)
  })
})
