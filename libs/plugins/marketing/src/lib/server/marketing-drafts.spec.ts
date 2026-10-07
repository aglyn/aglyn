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
 * The overlay and A/B test draft writers (AGL-3616) and the AI build
 * capabilities that name them, against a Firestore double.
 *
 * What it proves: an overlay is written switched off and a test stopped; a
 * member without the editor role, a plan without the feature and a full
 * overlays list are refused before anything is written; content past the
 * limits or off the trigger catalog is refused by the pure check; a write
 * asked again replays; and a capability's content names the page a plan
 * built for it.
 */

type Doc = Record<string, unknown>

let mockDocs = new Map<string, Doc>()
const mockWrites: string[] = []

function snapshot(path: string) {
  const data = mockDocs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => (data ?? {})[field],
    ref: ref(path),
  }
}
function collection(path: string): any {
  return {
    doc: (id: string) => ref(`${path}/${id}`),
    count: () => ({
      get: async () => ({
        data: () => ({ count: [...mockDocs.keys()].filter((key) => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1).length }),
      }),
    }),
  }
}
function ref(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    collection: (name: string) => collection(`${path}/${name}`),
    get: async () => snapshot(path),
    create: async (data: Doc) => {
      if (mockDocs.has(path)) throw new Error('ALREADY_EXISTS')
      mockWrites.push(path)
      mockDocs.set(path, data)
    },
  }
}
const firestore = { collection: (name: string) => collection(name) } as unknown as FirebaseFirestore.Firestore

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => ({}) }) },
}))

import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  pluginAiCapability,
  pluginAiCapabilityArgsProblems,
  pluginAiCapabilityProblem,
} from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { pluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { OVERLAY_LIST_CEILING } from '../model/overlay-drafts'
import {
  EXPERIMENT_DRAFT_PLAN_REFUSAL,
  OVERLAY_DRAFT_PLAN_REFUSAL,
  OVERLAY_DRAFT_ROLE_REFUSAL,
  OVERLAY_DRAFT_ROOM_REFUSAL,
  createExperimentDraftWriter,
  createOverlayDraftWriter,
  registerMarketingDraftWriters,
} from './marketing-drafts'
import {
  MARKETING_EXPERIMENT_CAPABILITY,
  MARKETING_OVERLAY_CAPABILITY,
  registerMarketingAiCapabilities,
} from './marketing-ai-capabilities'

const NOW = new Date('2026-10-06T12:00:00Z')
const BUSINESS = { plan: 'business', billingStatus: 'active' }
const context = (patch: Partial<{ uid: string; org: Doc | null }> = {}) => ({
  orgId: 'org-1',
  hostId: 'host-1',
  uid: 'editor-1',
  org: BUSINESS as Doc,
  now: NOW,
  ...patch,
})

beforeEach(() => {
  mockWrites.length = 0
  mockDocs = new Map<string, Doc>([
    ['hosts/host-1', { orgId: 'org-1', memberRoles: { 'editor-1': 'editor', 'viewer-1': 'viewer' } }],
    ['hosts/host-1/screens/home', { name: 'Home', versionId: 'v-live' }],
    ['hosts/host-1/screens/home/versions/v-live', { displayName: 'Live' }],
    ['hosts/host-1/screens/home/versions/v-b', { displayName: 'B' }],
  ])
})

describe('the overlay writer', () => {
  const writer = createOverlayDraftWriter({ firestore: () => firestore })
  const POPUP = { kind: 'popup', headline: 'Book a free call', body: 'Talk it through.', ctaLabel: 'Book', trigger: 'scroll', triggerValue: 40 }

  it('writes a popup switched off, with only the fields it was handed', async () => {
    const write = await writer.write({ ...context(), id: 'ov-1', name: 'Consultation', content: POPUP })
    expect(write).toMatchObject({ ok: true, replayed: false, id: 'ov-1', facts: { kind: 'popup', enabled: false } })
    expect(mockDocs.get('hosts/host-1/overlays/ov-1')).toMatchObject({
      kind: 'popup',
      enabled: false,
      name: 'Consultation',
      popup: { headline: 'Book a free call', body: 'Talk it through.', ctaLabel: 'Book', trigger: 'scroll', triggerValue: 40 },
      createdBy: 'editor-1',
    })
    const stored = mockDocs.get('hosts/host-1/overlays/ov-1') as Doc
    expect(stored['pathPatterns']).toBeUndefined()
    expect(stored['startAtMs']).toBeUndefined()
  })

  it('replays a write asked again, and writes nothing new', async () => {
    await writer.write({ ...context(), id: 'ov-1', name: '', content: POPUP })
    mockWrites.length = 0
    expect(await writer.write({ ...context(), id: 'ov-1', name: '', content: POPUP })).toMatchObject({ ok: true, replayed: true })
    expect(mockWrites).toEqual([])
    expect(await writer.read({ hostId: 'host-1', id: 'ov-1' })).toMatchObject({ id: 'ov-1', facts: { enabled: false } })
  })

  it('refuses a member without the editor role, a plan without overlays, and a full list', async () => {
    expect(await writer.refusal(context({ uid: 'viewer-1' }))).toEqual({ status: 403, error: OVERLAY_DRAFT_ROLE_REFUSAL })
    expect(await writer.refusal(context({ org: { plan: 'free' } }))).toEqual({ status: 403, error: OVERLAY_DRAFT_PLAN_REFUSAL })
    for (let index = 0; index < OVERLAY_LIST_CEILING; index += 1) mockDocs.set(`hosts/host-1/overlays/o${index}`, {})
    expect(await writer.refusal(context())).toEqual({ status: 409, error: OVERLAY_DRAFT_ROOM_REFUSAL })
    expect(await writer.write({ ...context(), id: 'ov-new', name: '', content: POPUP })).toMatchObject({ ok: false, status: 409 })
    expect(mockWrites).toEqual([])
  })

  it('checks the limits and the trigger catalog without I/O', () => {
    expect(writer.check(POPUP, { hostId: 'host-1' })).toMatchObject({ ok: true })
    expect(writer.check({ kind: 'bar', text: 'x'.repeat(500) }, { hostId: 'host-1' })).toMatchObject({ ok: false })
    expect(writer.check({ kind: 'popup', body: 'Hi', trigger: 'teleport' }, { hostId: 'host-1' })).toMatchObject({ ok: false })
    expect(writer.check({ kind: 'popup', body: 'Hi', trigger: 'scroll', triggerValue: 400 }, { hostId: 'host-1' })).toMatchObject({ ok: false })
    expect(writer.check({ kind: 'popup', headline: 'No body' }, { hostId: 'host-1' })).toMatchObject({ ok: false })
  })
})

describe('the experiment writer', () => {
  const writer = createExperimentDraftWriter({ firestore: () => firestore })

  it('writes a test STOPPED, with its variants as drafts pinning versions the page has', async () => {
    const write = await writer.write({
      ...context(),
      id: 'exp-1',
      name: 'Hero headline',
      content: { target: 'screen', screenId: 'home', variants: [{ name: 'Control' }, { name: 'Shorter', versionId: 'v-b' }] },
    })
    expect(write).toMatchObject({ ok: true, replayed: false, facts: { status: 'draft' } })
    expect(mockDocs.get('hosts/host-1/experiments/exp-1')).toMatchObject({
      name: 'Hero headline',
      status: 'draft',
      target: 'screen',
      screenId: 'home',
      variants: [
        { id: 'a', name: 'Control', weight: 1 },
        { id: 'b', name: 'Shorter', weight: 1, versionId: 'v-b' },
      ],
      goal: { event: 'formSubmission' },
    })
  })

  it('refuses a version the page does not have, and a page that does not exist', async () => {
    const missing = await writer.write({
      ...context(),
      id: 'exp-2',
      name: 'Test',
      content: { target: 'screen', screenId: 'home', variants: [{ name: 'A' }, { name: 'B', versionId: 'v-nope' }] },
    })
    expect(missing).toMatchObject({ ok: false, status: 400 })
    const gone = await writer.write({
      ...context(),
      id: 'exp-3',
      name: 'Test',
      content: { target: 'screen', screenId: 'gone', variants: [{ name: 'A' }, { name: 'B' }] },
    })
    expect(gone).toMatchObject({ ok: false, status: 400 })
    expect(mockWrites).toEqual([])
  })

  it('checks the test’s shape and refuses a plan without A/B testing', async () => {
    expect(writer.check({ target: 'email', variants: [{ name: 'A' }] }, { hostId: 'host-1' })).toMatchObject({ ok: false })
    expect(writer.check({ target: 'section', screenId: 'home', variants: [{ name: 'A' }, { name: 'B' }] }, { hostId: 'host-1' })).toMatchObject({ ok: false })
    expect(
      writer.check({ target: 'email', variants: [{ name: 'A', subject: 'Hi' }, { name: 'B', subject: 'Hello' }] }, { hostId: 'host-1' }),
    ).toMatchObject({ ok: true })
    expect(await writer.refusal(context({ org: { plan: 'pro', billingStatus: 'active' } }))).toEqual({
      status: 403,
      error: EXPERIMENT_DRAFT_PLAN_REFUSAL,
    })
  })
})

describe('registration', () => {
  beforeEach(() => resetPluginServicesForTests())

  it('registers both writers and both capabilities under this plugin', () => {
    registerMarketingDraftWriters({ firestore: () => firestore })
    registerMarketingAiCapabilities()
    expect(pluginResourceDraftWriter('overlay')?.pluginId).toBe('marketing')
    expect(pluginResourceDraftWriter('experiment')?.pluginId).toBe('marketing')
    expect(pluginAiCapability('overlay')?.capability.draftResource).toBe('overlay')
    expect(pluginAiCapability('experiment')?.capability.draftResource).toBe('experiment')
  })

  it('declares well-formed capabilities whose arguments the planner can be held to', () => {
    expect(pluginAiCapabilityProblem(MARKETING_OVERLAY_CAPABILITY)).toBeNull()
    expect(pluginAiCapabilityProblem(MARKETING_EXPERIMENT_CAPABILITY)).toBeNull()
    expect(
      pluginAiCapabilityArgsProblems(MARKETING_OVERLAY_CAPABILITY.argsSchema, { kind: 'popup', body: 'Hi', trigger: 'exit' }),
    ).toEqual([])
    expect(pluginAiCapabilityArgsProblems(MARKETING_OVERLAY_CAPABILITY.argsSchema, { kind: 'modal' })).not.toEqual([])
  })

  it('names the page a plan built for a page test', () => {
    const content = MARKETING_EXPERIMENT_CAPABILITY.draftContent?.(
      {
        name: 'hero-test',
        args: { name: 'Hero test', target: 'screen', screen: 'new:landing', variantNames: ['Control', 'Bolder'] },
      },
      { hostId: 'host-1', dependencies: { 'new:landing': { op: 'page', id: 'scr-9' } } },
    )
    expect(content).toEqual({
      name: 'Hero test',
      target: 'screen',
      screenId: 'scr-9',
      variants: [{ name: 'Control' }, { name: 'Bolder' }],
    })
  })
})
