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
 * The campaign step (AGL-2912). One brief becomes an email design and the
 * DRAFT campaign that would send it, and this spec is where the two promises
 * the published disclosure makes are held:
 *
 *  - nothing about the audience reaches the model — not a list name, not a
 *    contact, not what a past send did — and the suggestion reaches the
 *    person instead, as the output's note;
 *  - nothing is sent, scheduled or queued: the drafted campaign carries no
 *    field a send reads, and no send path is reachable from the step.
 */

const mockRunAiRequest = jest.fn()
const mockReadInventory = jest.fn()
const mockDocs = new Map<string, Record<string, unknown>>()
const mockOwners = new Map<string, string>()
const mockLists: Array<{ id: string; name: string }> = []

jest.mock('../runtime/ai-runtime', () => ({
  __esModule: true,
  ...jest.requireActual('../runtime/ai-runtime'),
  runAiRequest: (...args: unknown[]) => mockRunAiRequest(...args),
}))

jest.mock('../providers/routing', () => ({
  __esModule: true,
  ...jest.requireActual('../providers/routing'),
  aiModelForStep: () => 'routed-model',
}))

jest.mock('../runtime/site-inventory', () => ({
  __esModule: true,
  readSiteInventory: (...args: unknown[]) => mockReadInventory(...args),
}))

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async (hostId: string) => mockOwners.get(hostId) ?? null,
  orgDataCollectionForHost: async () => ({
    parent: {
      collection: () => ({
        select: () => ({
          limit: () => ({
            get: async () => ({
              docs: mockLists.map((list) => ({
                id: list.id,
                get: (field: string) => (field === 'name' ? list.name : undefined),
              })),
            }),
          }),
        }),
      }),
    },
  }),
}))

jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({
  __esModule: true,
  filterEnabledPluginsByReleaseFlags: async (ids: readonly string[]) => [...ids],
}))

jest.mock('./ai-jobs', () => ({
  __esModule: true,
  registerAiJobStep: jest.fn(),
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import {
  registerPluginResourceDraftWriter,
  type PluginDraftRecord,
  type PluginResourceDraftWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { renderEmailHtml } from '@aglyn/shared-util-email/email-render'
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import type { AiJob } from '../model/ai-jobs.types'
import { emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import { aiJobAdmissionRefusal } from './ai-job-admission'
import { AI_JOB_ZERO_USAGE } from './ai-job-generation'
import { AI_EMAIL_DESIGN_RESOURCE } from './ai-job-email-step'
import {
  AI_CAMPAIGN_PLAN_REFUSAL,
  AI_CAMPAIGN_RESOURCE,
  createAiJobCampaignStep,
  runAiJobCampaignStep,
  registerAiCampaignJob,
  AI_JOB_CAMPAIGN_STEP_MINIMUM_MS,
} from './ai-job-campaign-step'
import { registerAiJobStep } from './ai-jobs'

const NOW = new Date('2026-09-15T20:00:00.000Z')
/** Starter sends no campaign email: `emailSendsPerMonth` resolves to 0. */
const STARTER_ORG = { plan: 'starter', billingStatus: 'active', enabledPlugins: ['email', 'marketing'] }
const PRO_ORG = { plan: 'pro', billingStatus: 'active', enabledPlugins: ['email', 'marketing'] }
const USAGE = { inputTokens: 3_000, outputTokens: 900, cacheReadTokens: 6_000, cacheWriteTokens: 0 }

const GOLDENS = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'ai-job-email-goldens.json'), 'utf8'),
) as Record<string, any>

// ── Sentinels: what must never reach the model ───────────────────────────

const LIST_NAME = 'Autumn regulars zzlist'
const OTHER_LIST_NAME = 'Lapsed since spring zzother'
const CONTACT_EMAIL = 'zzcontact@example.test'
const DELIVERED = '4821'
const OPENS = '1907'

// ── Firestore double ─────────────────────────────────────────────────────

function valueAt(data: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
      data,
    )
}

function snapshotOf(path: string) {
  const data = mockDocs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => (data ? valueAt(data, field) : undefined),
  }
}

function childKeys(path: string): string[] {
  return [...mockDocs.keys()]
    .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
    .sort()
}

function queryRef(path: string): Record<string, unknown> {
  const query: Record<string, unknown> = {
    where: () => query,
    select: () => query,
    limit: () => query,
    get: async () => ({ docs: childKeys(path).map(snapshotOf) }),
  }
  return query
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
  return { path, doc: (id: string) => docRef(`${path}/${id}`), ...queryRef(path) }
}

const firestore = {
  collection: (name: string) => collectionRef(name),
} as unknown as FirebaseFirestore.Firestore

// ── The two writers, as their owning plugins register them ───────────────

interface FakeDraft {
  id: string
  name: string
  content: Record<string, unknown>
}

let designs: FakeDraft[] = []
let campaigns: FakeDraft[] = []

function designRecord(design: FakeDraft): PluginDraftRecord {
  return {
    id: design.id,
    name: design.name,
    versionId: `ver-${design.id}`,
    facts: {
      subject: design.content['subject'],
      preheader: design.content['preheader'],
      subjectVariants: design.content['subjectVariants'],
      preheaderVariants: design.content['preheaderVariants'],
    },
  }
}

const designWriter: PluginResourceDraftWriter = {
  refusal: async () => null,
  check: (content) => {
    const nodes = content['nodes'] as NodesMap | undefined
    if (!nodes || !Object.keys(nodes).length) return { ok: false, problems: ['The design has no blocks'] }
    const rendered = renderEmailHtml({
      nodes: nodes as never,
      rootId: CANVAS_ROOT_ELEMENT_ID,
      subject: String(content['subject'] ?? ''),
      preheader: String(content['preheader'] ?? ''),
      sanitize: (html: string) => html,
    })
    return rendered.text.trim()
      ? { ok: true, facts: { messageText: rendered.text } }
      : { ok: false, problems: ['The design renders no message'] }
  },
  read: async ({ id }) => {
    const design = designs.find((one) => one.id === id)
    return design ? designRecord(design) : null
  },
  write: async (request) => {
    const existing = designs.find((one) => one.id === request.id)
    if (existing) return { ok: true, replayed: true, ...designRecord(existing) }
    const design = { id: request.id, name: request.name, content: { ...request.content } }
    designs.push(design)
    return { ok: true, replayed: false, ...designRecord(design) }
  },
}

/** The keys the marketing plugin writes a drafted campaign email with. */
const CAMPAIGN_DRAFT_KEYS = [
  'templateScreenId',
  'subject',
  'preheader',
  'subjectVariants',
  'preheaderVariants',
]

const campaignWriter: PluginResourceDraftWriter = {
  refusal: async () => null,
  check: (content) =>
    content['templateScreenId']
      ? { ok: true, facts: {} }
      : { ok: false, problems: ['A drafted campaign needs the email design it sends'] },
  read: async ({ id }) => {
    const campaign = campaigns.find((one) => one.id === id)
    return campaign
      ? { id: campaign.id, name: campaign.name, versionId: null, facts: {} }
      : null
  },
  write: async (request) => {
    const existing = campaigns.find((one) => one.id === request.id)
    if (existing) {
      return { ok: true, replayed: true, id: existing.id, name: existing.name, versionId: null, facts: {} }
    }
    const campaign = { id: request.id, name: request.name, content: { ...request.content } }
    campaigns.push(campaign)
    return { ok: true, replayed: false, id: campaign.id, name: campaign.name, versionId: null, facts: {} }
  },
}

const writerFor = (resource: string) => {
  if (resource === AI_EMAIL_DESIGN_RESOURCE) return designWriter
  if (resource === AI_CAMPAIGN_RESOURCE) return campaignWriter
  return null
}

// The admission reads the real registry, as the create and resume doors do,
// so the fakes stand where the email and marketing plugins register theirs.
beforeAll(() => {
  registerPluginResourceDraftWriter(AI_EMAIL_DESIGN_RESOURCE, designWriter, { pluginId: 'email' })
  registerPluginResourceDraftWriter(AI_CAMPAIGN_RESOURCE, campaignWriter, { pluginId: 'marketing' })
})

// ── Fixtures ─────────────────────────────────────────────────────────────

const INVENTORY: AiSiteInventory = {
  ...emptyAiSiteInventory('host-1'),
  screens: [
    { id: 'scr-home', name: 'Home', slug: '/', layoutId: null, template: false },
    { id: 'scr-sub', name: 'Subscription', slug: 'subscription', layoutId: null, template: false },
  ],
}

function job(patch: Partial<AiJob> = {}): AiJob {
  return {
    $id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'campaign',
    status: 'running',
    brief: GOLDENS['launch'].brief,
    inputs: {},
    steps: [{ name: 'generate', status: 'running', creditsSpent: 0 }],
    outputs: [],
    creditsReserved: 50,
    creditsSpent: 0,
    createdBy: 'uid-1',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
    plan: null,
    review: null,
    ...patch,
  } as AiJob
}

function emailAnswer(golden: { tree: unknown; subjects: string[]; preheaders: string[] }) {
  return {
    kind: 'completion',
    text: '',
    toolUse: [
      {
        name: 'submit_email',
        input: {
          tree: JSON.stringify(golden.tree),
          subjects: golden.subjects,
          preheaders: golden.preheaders,
        },
      },
    ],
    usage: USAGE,
    estCostUsd: 0.02,
    stopReason: 'tool_use',
  }
}

const run = (patch: Partial<AiJob> = {}) =>
  createAiJobCampaignStep({ readInventory: mockReadInventory as never, writerFor })({
    job: job(patch),
    stepIndex: 0,
    now: NOW,
    firestore,
  } as never)

const sentToModel = () => JSON.stringify(mockRunAiRequest.mock.calls)

beforeEach(() => {
  mockRunAiRequest.mockReset()
  mockReadInventory.mockReset().mockResolvedValue(INVENTORY)
  mockDocs.clear()
  mockOwners.clear()
  mockLists.length = 0
  designs = []
  campaigns = []
  mockOwners.set('host-1', 'org-1')
  mockDocs.set('hosts/host-1', { subdomain: 'brightside', enabledPlugins: ['email', 'marketing'] })
  mockDocs.set('orgs/org-1', PRO_ORG)
})

describe('the campaign step', () => {
  it('registers the campaign runner', () => {
    registerAiCampaignJob()
    expect(registerAiJobStep).toHaveBeenCalledWith('campaign', runAiJobCampaignStep, {
      minimumMs: AI_JOB_CAMPAIGN_STEP_MINIMUM_MS,
    })
  })

  it('drafts an email design AND the campaign that would send it', async () => {
    mockRunAiRequest.mockResolvedValueOnce(emailAnswer(GOLDENS['launch']))
    const outcome = await run({ inputs: { name: 'Box launch' } })
    expect(outcome.failure).toBeUndefined()
    expect(outcome.review).toBeUndefined()
    expect(outcome.outputs.map((output) => output.resource)).toEqual(['emailScreen', 'campaign'])
    expect(designs).toHaveLength(1)
    expect(campaigns).toHaveLength(1)
    expect(campaigns[0].name).toBe('Box launch')
    expect(campaigns[0].content['templateScreenId']).toBe(designs[0].id)
  })

  it('names the campaign after its strongest subject line when the job names none', async () => {
    mockRunAiRequest.mockResolvedValueOnce(emailAnswer(GOLDENS['launch']))
    await run()
    expect(campaigns[0].name).toBe(GOLDENS['launch'].subjects[0])
  })

  it('reports both drafts an earlier run wrote, and spends nothing', async () => {
    mockRunAiRequest.mockResolvedValueOnce(emailAnswer(GOLDENS['launch']))
    await run()
    mockRunAiRequest.mockClear()
    const again = await run()
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(again.usage).toEqual(AI_JOB_ZERO_USAGE)
    expect(again.outputs.map((output) => output.resource)).toEqual(['emailScreen', 'campaign'])
    expect(designs).toHaveLength(1)
    expect(campaigns).toHaveLength(1)
  })

  it('drafts the campaign from a design an earlier run left behind, without asking again', async () => {
    mockRunAiRequest.mockResolvedValueOnce(emailAnswer(GOLDENS['launch']))
    await run()
    campaigns = []
    mockRunAiRequest.mockClear()
    const again = await run()
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(again.usage).toEqual(AI_JOB_ZERO_USAGE)
    expect(campaigns).toHaveLength(1)
    expect(campaigns[0].content['subject']).toBe(GOLDENS['launch'].subjects[0])
    expect(campaigns[0].content['subjectVariants']).toEqual(GOLDENS['launch'].subjects)
  })
})

describe('where campaign email begins', () => {
  beforeAll(registerAiCampaignJob)

  const ask = (org: object) =>
    aiJobAdmissionRefusal('campaign', {
      firestore,
      orgId: 'org-1',
      hostId: 'host-1',
      inputs: {},
      org,
      uid: 'uid-1',
    })

  it('refuses a workspace whose plan sends no campaign email, naming no plan', async () => {
    expect(await ask(STARTER_ORG)).toEqual({ status: 403, error: AI_CAMPAIGN_PLAN_REFUSAL })
    expect(AI_CAMPAIGN_PLAN_REFUSAL).not.toMatch(/starter|pro\b|business|scale|agency|enterprise/i)
  })

  it('admits a workspace whose plan does', async () => {
    expect(await ask(PRO_ORG)).toBeNull()
  })

  it('stops the job for a person when the plan changed after it was admitted', async () => {
    mockDocs.set('orgs/org-1', STARTER_ORG)
    const outcome = await run()
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(outcome.review).toEqual({
      reason: 'limit',
      message: AI_CAMPAIGN_PLAN_REFUSAL,
      findings: [],
    })
    expect(campaigns).toHaveLength(0)
  })
})

describe('who a drafted campaign is for', () => {
  beforeEach(() => {
    mockLists.push({ id: 'list-1', name: LIST_NAME })
    // A second list the brief does not name: the org's list inventory is read
    // on the server and must not travel with the request.
    mockLists.push({ id: 'list-2', name: OTHER_LIST_NAME })
    // Past sends of that list, which the send-time rule reads and the model never sees.
    for (let index = 0; index < 4; index += 1) {
      mockDocs.set(`hosts/host-1/campaigns/sent-${index}`, {
        listId: 'list-1',
        status: 'sent',
        // A Tuesday at 09:00Z, four weeks running.
        sentAt: new Date(Date.UTC(2026, 7, 4 + index * 7, 9, 0, 0)),
        stats: { delivered: Number(DELIVERED), uniqueOpens: Number(OPENS) },
        recipient: CONTACT_EMAIL,
      })
    }
  })

  it('leaves the campaign aimed at nobody and puts the suggestion in the note', async () => {
    mockRunAiRequest.mockResolvedValueOnce(emailAnswer(GOLDENS['launch']))
    const outcome = await run({ brief: `Announce the box to the ${LIST_NAME}.` })
    const campaign = outcome.outputs.find((output) => output.resource === 'campaign')
    expect(campaign?.note).toContain(LIST_NAME)
    expect(campaign?.note).toContain('aimed at nobody yet')
    // Nothing the draft stores names an audience.
    expect(Object.keys(campaigns[0].content).sort()).toEqual([...CAMPAIGN_DRAFT_KEYS].sort())
  })

  it('suggests a send time from the list’s own history, and sends none of it to the model', async () => {
    mockRunAiRequest.mockResolvedValueOnce(emailAnswer(GOLDENS['launch']))
    const outcome = await run({ brief: `Announce the box to the ${LIST_NAME}.` })
    const campaign = outcome.outputs.find((output) => output.resource === 'campaign')
    expect(campaign?.note).toMatch(/opened most when sent on/)
    const sent = sentToModel()
    for (const secret of [OTHER_LIST_NAME, CONTACT_EMAIL, DELIVERED, OPENS, 'list-1']) {
      expect(sent).not.toContain(secret)
    }
    // The named list reaches the model only inside the brief the member wrote.
    const briefLine = `Brief: Announce the box to the ${LIST_NAME}.`
    expect(sent.split(LIST_NAME)).toHaveLength(2)
    expect(sent).toContain(JSON.stringify(briefLine).slice(1, -1))
  })

  it('says so plainly when the brief names no list', async () => {
    mockRunAiRequest.mockResolvedValueOnce(emailAnswer(GOLDENS['launch']))
    const outcome = await run({ brief: 'Announce the subscription box.' })
    const campaign = outcome.outputs.find((output) => output.resource === 'campaign')
    expect(campaign?.note).toContain('aimed at nobody yet')
    expect(campaign?.note).not.toContain(LIST_NAME)
  })
})

describe('a drafted campaign is never a sent one', () => {
  it('writes only the fields a draft holds: no audience, schedule, sender or experiment', async () => {
    mockRunAiRequest.mockResolvedValueOnce(emailAnswer(GOLDENS['launch']))
    await run()
    const keys = Object.keys(campaigns[0].content)
    expect(keys.sort()).toEqual([...CAMPAIGN_DRAFT_KEYS].sort())
    for (const forbidden of [
      'audience',
      'listId',
      'listIds',
      'segment',
      'emails',
      'topic',
      'fromName',
      'replyTo',
      'scheduledAt',
      'sendAt',
      'experimentId',
      'status',
    ]) {
      expect(keys).not.toContain(forbidden)
    }
  })

  it('calls no send function, and imports no other plugin’s internals', () => {
    const sources = ['ai-job-campaign-step.ts', 'ai-job-email-step.ts', 'ai-email-bindings.ts'].map(
      (name) => readFileSync(join(__dirname, name), 'utf8'),
    )
    for (const source of sources) {
      // Called, not merely mentioned: a doc comment may name the send path it
      // is explaining that it does not take.
      for (const call of [
        'performCampaignSend(',
        'sendCampaign(',
        'scheduleCampaign(',
        'reserveCampaignEmailSends(',
        'sendCampaignEmail(',
      ]) {
        expect(source).not.toContain(call)
      }
      for (const plugin of ['@aglyn/plugins-marketing', '@aglyn/plugins-email']) {
        expect(source).not.toContain(plugin)
      }
    }
  })

  it('reports no campaign, and so no finished job, when the campaign cannot be drafted', async () => {
    mockRunAiRequest.mockResolvedValueOnce(emailAnswer(GOLDENS['launch']))
    jest
      .spyOn(campaignWriter, 'write')
      .mockResolvedValueOnce({ ok: false, status: 400, error: 'Unknown email design' })
    const outcome = await run()
    expect(outcome.outputs).toEqual([])
    expect(outcome.failure).toBeTruthy()
    jest.restoreAllMocks()
  })
})
