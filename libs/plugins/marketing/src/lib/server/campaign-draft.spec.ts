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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A DRAFTED CAMPAIGN NEVER MAILS ANYBODY (AGL-2912).
 *
 * The campaign draft writer another plugin reaches through the core's
 * resource-drafts seam, against a double that honors transactions. Every
 * assertion is about what a drafted campaign holds and what it cannot do:
 *
 *  - it is the container the create drawer writes and ONE email inside it,
 *    `draft`, naming its design, with no audience, list, segment, addresses,
 *    topic, sender, send time or experiment;
 *  - no send path is reachable from the writer: the module imports none, and
 *    the scheduled processor's query cannot match a draft.
 */

const store = new Map<string, Record<string, unknown>>()
let commits: string[] = []

function snapshotOf(path: string) {
  const data = store.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => (data ? data[field] : undefined),
  }
}

function docRef(path: string): Record<string, unknown> {
  return {
    path,
    id: path.split('/').pop(),
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: async () => snapshotOf(path),
  }
}

function collectionRef(path: string): Record<string, unknown> {
  return { path, doc: (id: string) => docRef(`${path}/${id}`) }
}

function mockFirestore(): FirebaseFirestore.Firestore {
  return {
    collection: (name: string) => collectionRef(name),
    runTransaction: async (body: (transaction: unknown) => Promise<unknown>) => {
      const creates: Array<[string, Record<string, unknown>]> = []
      const outcome = await body({
        get: async (ref: { path: string }) => snapshotOf(ref.path),
        create: (ref: { path: string }, value: Record<string, unknown>) => {
          creates.push([ref.path, value])
        },
      })
      for (const [path, value] of creates) {
        if (store.has(path)) throw new Error(`6 ALREADY_EXISTS: ${path}`)
        store.set(path, value)
        commits.push(path)
      }
      return outcome
    },
  } as unknown as FirebaseFirestore.Firestore
}

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => mockFirestore() }), firestore: { FieldValue: {} } },
}))

jest.mock('@aglyn/tenant-data-admin/server/duplicate-activity', () => ({
  __esModule: true,
  logResourceDuplicated: jest.fn(),
}))

import { setRegisteringPluginId } from '@aglyn/aglyn/app-utils/registering-plugin'
import { pluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { CAMPAIGN_SEND_CONTAINER_FIELD } from '@aglyn/shared-ui-email-campaigns/model'
import {
  CAMPAIGN_DRAFT_DEFAULT_NAME,
  CAMPAIGN_DRAFT_EMAIL_FIELDS,
  CAMPAIGN_DRAFT_RESOURCE,
  CAMPAIGN_DRAFT_ROLE_REFUSAL,
  campaignDraftEmailId,
  campaignDraftWriter,
  createCampaignDraftWriter,
  registerCampaignDraftWriter,
} from './campaign-manage'

const NOW = new Date('2026-09-15T20:00:00.000Z')

const CONTENT = {
  templateScreenId: 'design-1',
  subject: 'Cardamom buns are back',
  preheader: 'Saturday and Sunday mornings, while they last.',
  subjectVariants: ['Cardamom buns are back', 'Guess what is back this weekend', 'Your weekend bun is here'],
  preheaderVariants: ['Saturday and Sunday mornings, while they last.', 'Warm from 7 am.', 'Come early.'],
}

const writer = createCampaignDraftWriter({ firestore: mockFirestore })

const request = (patch: Record<string, unknown> = {}) => ({
  orgId: 'org-1',
  hostId: 'host-1',
  uid: 'uid-1',
  org: null,
  now: NOW,
  id: 'job-1',
  name: 'Weekend buns',
  content: CONTENT,
  ...patch,
})

beforeEach(() => {
  store.clear()
  commits = []
  store.set('hosts/host-1', { memberRoles: { 'uid-1': 'editor', 'uid-2': 'author' } })
  store.set('hosts/host-1/screens/design-1', { displayName: 'Weekend buns', kind: 'email', versionId: 'v-1' })
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

describe('the campaign draft writer', () => {
  it('writes the create drawer’s container and one draft email in it, holding what it says and nothing about who gets it', async () => {
    expect(await writer.write(request())).toEqual({
      ok: true,
      replayed: false,
      id: 'job-1',
      name: 'Weekend buns',
      versionId: null,
      facts: { emailId: 'job-1-email' },
    })
    expect(commits).toEqual(['hosts/host-1/emailCampaigns/job-1', 'hosts/host-1/campaigns/job-1-email'])
    expect(store.get('hosts/host-1/emailCampaigns/job-1')).toEqual({
      name: 'Weekend buns',
      listIds: [],
      createdAtMs: NOW.getTime(),
      createdBy: 'uid-1',
    })
    const email = store.get(`hosts/host-1/campaigns/${campaignDraftEmailId('job-1')}`) as Record<string, unknown>
    expect(email).toEqual({
      subject: CONTENT.subject,
      preheader: CONTENT.preheader,
      templateScreenId: 'design-1',
      subjectVariants: CONTENT.subjectVariants,
      preheaderVariants: CONTENT.preheaderVariants,
      [CAMPAIGN_SEND_CONTAINER_FIELD]: 'job-1',
      status: 'draft',
      createdAtMs: NOW.getTime(),
      draftedAt: NOW,
      draftedBy: 'uid-1',
    })
    expect(Object.keys(email).every((key) => (CAMPAIGN_DRAFT_EMAIL_FIELDS as readonly string[]).includes(key))).toBe(true)
    for (const decision of ['audience', 'listId', 'segmentId', 'emails', 'topicId', 'senderId', 'sendAtMs', 'scheduledAt', 'experimentId']) {
      expect([decision, decision in email]).toEqual([decision, false])
    }
    // The campaign's own id and its email's are different documents' ids.
    expect(campaignDraftEmailId('job-1')).not.toBe('job-1')
  })

  it('reports the campaign a run already drafted under the id, and writes nothing', async () => {
    await writer.write(request())
    commits = []
    expect(await writer.write(request({ name: 'Another name' }))).toEqual({
      ok: true,
      replayed: true,
      id: 'job-1',
      name: 'Weekend buns',
      versionId: null,
      facts: { emailId: 'job-1-email' },
    })
    expect(commits).toEqual([])
    expect(await writer.read({ hostId: 'host-1', id: 'job-1' })).toMatchObject({ name: 'Weekend buns' })
    expect(await writer.read({ hostId: 'host-1', id: 'job-9' })).toBeNull()
  })

  it('refuses where the send route refuses, and a design that is not an email design', async () => {
    expect(await writer.refusal({ orgId: 'org-1', hostId: 'host-9', uid: 'uid-1', org: null, now: NOW })).toEqual({
      status: 404,
      error: 'Unknown site',
    })
    expect(await writer.refusal({ orgId: 'org-1', hostId: 'host-1', uid: 'uid-2', org: null, now: NOW })).toEqual({
      status: 403,
      error: CAMPAIGN_DRAFT_ROLE_REFUSAL,
    })
    expect(await writer.write(request({ uid: 'uid-2' }))).toEqual({ ok: false, status: 403, error: CAMPAIGN_DRAFT_ROLE_REFUSAL })
    const manage = readFileSync(join(__dirname, 'campaign-manage.ts'), 'utf8')
    expect(manage).toContain("memberRole !== 'admin' && memberRole !== 'editor'")

    store.set('hosts/host-1/screens/page-1', { displayName: 'Home' })
    expect(await writer.write(request({ content: { ...CONTENT, templateScreenId: 'page-1' } }))).toEqual({
      ok: false,
      status: 400,
      error: 'Unknown email design',
    })
    store.set('hosts/host-1/campaigns/job-2-email', { status: 'sent' })
    expect(await writer.write(request({ id: 'job-2' }))).toEqual({ ok: false, status: 409, error: 'That email already exists' })
    expect(commits).toEqual([])
  })

  it('refuses content with no design or no subject, and names a campaign asked for with no name', async () => {
    expect(writer.check({ subject: '' }, { hostId: 'host-1' })).toEqual({
      ok: false,
      problems: ['A drafted campaign needs the email design it sends', 'A drafted campaign needs a subject line'],
    })
    expect(await writer.write(request({ content: { ...CONTENT, preheader: 'p'.repeat(201) } }))).toEqual({
      ok: false,
      status: 400,
      error: 'A preheader is longer than 200 characters',
    })
    expect(await writer.write(request({ name: '   ' }))).toMatchObject({ ok: true, name: CAMPAIGN_DRAFT_DEFAULT_NAME })
  })
})

describe('no send path is reachable from a drafted campaign', () => {
  it('imports no sender, and the scheduled processor cannot pick a draft up', async () => {
    // The code, without the comments that explain which paths DO send.
    const manage = readFileSync(join(__dirname, 'campaign-manage.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(manage).not.toMatch(/from '\.\/campaign-send'/)
    for (const sender of ['performCampaignSend', 'sendEmail', 'reserveCampaignEmailSends', 'campaignProcessScheduledHandler']) {
      expect([sender, new RegExp(`\\b${sender}\\b`).test(manage)]).toEqual([sender, false])
    }
    const processor = readFileSync(join(__dirname, 'campaign-process-scheduled.ts'), 'utf8')
    expect(processor).toContain(".where('status', '==', 'scheduled')")
    await writer.write(request())
    expect(store.get('hosts/host-1/campaigns/job-1-email')).toMatchObject({ status: 'draft' })
    expect(store.get('hosts/host-1/campaigns/job-1-email')).not.toHaveProperty('sendAtMs')
  })
})

describe('registration', () => {
  it('registers the writer as the marketing plugin’s, from the console surface alone', () => {
    registerCampaignDraftWriter()
    expect(pluginResourceDraftWriter(CAMPAIGN_DRAFT_RESOURCE)).toEqual({
      pluginId: 'marketing',
      writer: campaignDraftWriter,
    })
    const server = readFileSync(join(__dirname, '..', 'server.ts'), 'utf8')
    const surface = (name: string) =>
      new RegExp(`export function ${name}\\(\\): void \\{[\\s\\S]*?\\n\\}`).exec(server)?.[0] ?? ''
    expect(surface('registerMarketingConsoleApi')).toMatch(/^export function registerMarketingConsoleApi\(\): void \{(\s*\/\/[^\n]*)*\s*registerCampaignDraftWriter\(\)/)
    // The AI jobs that write through it run only on the console (AGL-3026),
    // so the tenant surface that serves published sites registers nothing.
    expect(surface('registerMarketingApi')).not.toBe('')
    expect(surface('registerMarketingApi')).not.toContain('registerCampaignDraftWriter')
  })
})
