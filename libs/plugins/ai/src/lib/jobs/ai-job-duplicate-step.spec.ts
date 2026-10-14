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
 * The duplicate step (AGL-3740). Its promises:
 *
 *  - A copy is core's `duplicateResource` — the console's own Duplicate… —
 *    of exactly the kinds the console copies, with the job's id as the
 *    attempt key so a pass asked again makes no second copy.
 *  - The source is the id the inventory lists, or the one row of that name;
 *    two of one name, none, or something this build has yet to make are
 *    refused in words.
 *  - Only a member who may edit the site, while nothing freezes it, at the
 *    door and again before the copy. A plan counter is a limit, not a fault.
 *  - No model and no credits; offered to a build as an item.
 */

jest.mock('./ai-jobs', () => ({
  __esModule: true,
  registerAiJobStep: jest.fn(),
  aiJobStepRunnerFor: () => null,
}))

import { DUPLICABLE_HOST_RESOURCE_KINDS } from '@aglyn/aglyn/app-utils/duplicate-resource'
import { pluginAiCapabilityArgsProblems } from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import type { AiJob } from '../model/ai-jobs.types'
import { AI_OWNED_CAPABILITIES, aiBuildOpLines } from './ai-build-capabilities'
import { aiJobAdmissionFor } from './ai-job-admission'
import { AI_JOB_ZERO_USAGE } from './ai-job-generation'
import {
  AI_DUPLICATE_LOCKED_COPY,
  AI_DUPLICATE_NOT_YET_COPY,
  AI_DUPLICATE_OUTPUT_RESOURCES,
  AI_DUPLICATE_ROLE_COPY,
  AI_DUPLICATE_UNREADABLE_COPY,
  AI_JOB_DUPLICATE_STEP_MINIMUM_MS,
  aiDuplicateRequestOf,
  aiDuplicateSourceId,
  createAiDuplicateJobAdmission,
  createAiJobDuplicateStep,
  readAiDuplicateSourceRows,
  registerAiDuplicateJob,
  type AiDuplicateSourceRow,
} from './ai-job-duplicate-step'
import { registerAiJobStep } from './ai-jobs'

const NOW = new Date('2026-10-12T15:00:00.000Z')
const PRO = { plan: 'pro', billingStatus: 'active' }

const hosts = new Map<string, Record<string, unknown>>()
const hostSnapshot = (id: string) => {
  const data = hosts.get(id)
  return {
    id,
    exists: data !== undefined,
    data: () => (data ? { ...data } : undefined),
    get: (field: string) => data?.[field],
  }
}
const selected: string[][] = []
const collections = new Map<string, Array<{ id: string } & Record<string, unknown>>>()
const firestore = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      get: async () => (name === 'hosts' ? hostSnapshot(id) : { exists: false, data: () => undefined, get: () => undefined }),
      collection: (sub: string) => ({
        select: (...fields: string[]) => {
          selected.push(fields)
          return {
            get: async () => ({
              docs: (collections.get(`${id}/${sub}`) ?? []).map((row) => ({ id: row.id, get: (field: string) => row[field] })),
            }),
          }
        },
      }),
    }),
  }),
} as unknown as FirebaseFirestore.Firestore

function job(inputs: Record<string, unknown>, overrides: Partial<AiJob> = {}): AiJob {
  return {
    $id: 'job-dup-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'duplicate',
    status: 'running',
    brief: 'Make another page like Services.',
    inputs,
    steps: [],
    outputs: [],
    creditsReserved: 0,
    creditsSpent: 0,
    createdBy: 'uid-1',
    createdAt: NOW as never,
    updatedAt: NOW as never,
    expiresAt: NOW as never,
    ...overrides,
  } as AiJob
}

const ROWS: AiDuplicateSourceRow[] = [
  { id: 's-services', name: 'Services', kind: undefined, deleted: false },
  { id: 's-old', name: 'Old', kind: undefined, deleted: true },
  { id: 's-welcome', name: 'Welcome', kind: 'email', deleted: false },
  { id: 's-twin-a', name: 'Twin', kind: undefined, deleted: false },
  { id: 's-twin-b', name: 'twin', kind: undefined, deleted: false },
]

const lockdownOpen = jest.fn(async () => null)
const duplicate = jest.fn(async (..._args: unknown[]) => ({ ok: true as const, id: 'copy-1', versionId: 'v-copy', name: 'Copy of Services' }))

const step = (lockdown = lockdownOpen) =>
  createAiJobDuplicateStep({ duplicate: duplicate as never, readRows: async () => ROWS, lockdown: lockdown as never })
const run = (inputs: Record<string, unknown>, lockdown = lockdownOpen) =>
  step(lockdown)({ job: job(inputs), stepIndex: 0, now: NOW, firestore, org: PRO as never })

beforeEach(() => {
  hosts.clear()
  hosts.set('host-1', { orgId: 'org-1', subdomain: 'juniper', memberRoles: { 'uid-1': 'editor', 'uid-2': 'viewer' } })
  collections.clear()
  selected.length = 0
  duplicate.mockClear()
  lockdownOpen.mockClear()
})

describe('what a copy names (AGL-3740)', () => {
  it('reads the kind, the source and the name, and refuses what it cannot', () => {
    expect(aiDuplicateRequestOf({ kind: 'screen', source: 's-services', name: 'Services 2' })).toEqual({ kind: 'screen', sourceId: 's-services', name: 'Services 2' })
    expect(aiDuplicateRequestOf({ kind: 'form', source: 'f-1' })).toEqual({ kind: 'form', sourceId: 'f-1', name: null })
    expect(aiDuplicateRequestOf({ kind: 'screen', source: 'new:Pricing' })).toBe(AI_DUPLICATE_NOT_YET_COPY)
    // Not a kind the console copies: a product, a dataset, a theme.
    for (const kind of ['product', 'dataset', 'theme', 'campaign']) {
      expect([kind, aiDuplicateRequestOf({ kind, source: 'x' })]).toEqual([kind, AI_DUPLICATE_UNREADABLE_COPY])
    }
    expect(aiDuplicateRequestOf({ kind: 'screen', source: '' })).toBe(AI_DUPLICATE_UNREADABLE_COPY)
  })

  it('finds the source by id or by its one name, and never a deleted row or the other kind sharing its collection', () => {
    expect(aiDuplicateSourceId('screen', 's-services', ROWS)).toEqual({ id: 's-services' })
    expect(aiDuplicateSourceId('screen', 'services', ROWS)).toEqual({ id: 's-services' })
    expect(aiDuplicateSourceId('emailDesign', 'Welcome', ROWS)).toEqual({ id: 's-welcome' })
    expect(aiDuplicateSourceId('screen', 'Welcome', ROWS)).toEqual({ error: 'This site has no page “Welcome” to copy.' })
    expect(aiDuplicateSourceId('emailDesign', 's-services', ROWS)).toEqual({ error: 'This site has no email design “s-services” to copy.' })
    expect(aiDuplicateSourceId('screen', 's-old', ROWS)).toEqual({ error: 'This site has no page “s-old” to copy.' })
    expect(aiDuplicateSourceId('screen', 'Twin', ROWS)).toEqual({ error: 'This site has more than one page called “Twin”; name the one to copy.' })
  })

  it('reads the rows of the collection core copies the kind from', async () => {
    collections.set('host-1/layouts', [{ id: 'lay-1', displayName: 'Site', deletedAt: null }])
    expect(await readAiDuplicateSourceRows(firestore as never, 'host-1', 'layout')).toEqual([{ id: 'lay-1', name: 'Site', kind: undefined, deleted: false }])
    expect(selected).toEqual([['displayName', 'kind', 'deletedAt']])
  })
})

describe('the duplicate step (AGL-3740)', () => {
  it('copies through core’s duplicate, once per job, at no cost, and hands back the draft', async () => {
    const outcome = await run({ kind: 'screen', source: 'Services', name: 'Consulting' })
    expect(outcome.failure).toBeUndefined()
    expect(outcome.usage).toEqual(AI_JOB_ZERO_USAGE)
    expect(outcome.estCostUsd).toBe(0)
    expect(duplicate).toHaveBeenCalledWith('screen', {
      orgId: 'org-1',
      hostId: 'host-1',
      sourceId: 's-services',
      name: 'Consulting',
      uid: 'uid-1',
      email: null,
      org: PRO,
      attemptKey: 'ai-job:job-dup-1',
    })
    expect(outcome.outputs).toEqual([
      expect.objectContaining({ resource: 'screen', id: 'copy-1', versionId: 'v-copy', hostId: 'host-1', hostSubdomain: 'juniper', label: 'Copy of Services' }),
    ])
    expect(outcome.outputs[0].note).toContain('saved as a draft')
    expect(lockdownOpen).toHaveBeenCalledWith(expect.objectContaining({ staff: false, uid: 'uid-1', intent: 'write' }))
  })

  it('opens each copy where the console lists its kind', () => {
    expect(Object.keys(AI_DUPLICATE_OUTPUT_RESOURCES).sort()).toEqual([...DUPLICABLE_HOST_RESOURCE_KINDS].sort())
    expect(AI_DUPLICATE_OUTPUT_RESOURCES).toMatchObject({ component: 'reusableComponent', emailDesign: 'emailScreen' })
  })

  it('refuses a member who may not edit the site and a frozen site, copying nothing', async () => {
    hosts.set('host-1', { orgId: 'org-1', memberRoles: { 'uid-1': 'viewer' } })
    expect((await run({ kind: 'screen', source: 's-services' })).review).toEqual(expect.objectContaining({ reason: 'limit', message: AI_DUPLICATE_ROLE_COPY }))
    hosts.set('host-1', { orgId: 'org-1', memberRoles: { 'uid-1': 'editor' } })
    expect((await run({ kind: 'screen', source: 's-services' }, jest.fn(async () => ({ scope: 'host' })) as never)).review?.message).toBe(AI_DUPLICATE_LOCKED_COPY)
    expect(duplicate).not.toHaveBeenCalled()
  })

  it('relays a plan counter as a limit and any other refusal as the failure, in core’s words', async () => {
    duplicate.mockResolvedValueOnce({ ok: false, status: 403, error: 'Your plan includes 5 pages' } as never)
    expect((await run({ kind: 'screen', source: 's-services' })).review).toEqual(expect.objectContaining({ reason: 'limit', message: 'Your plan includes 5 pages' }))
    duplicate.mockResolvedValueOnce({ ok: false, status: 404, error: 'Unknown page' } as never)
    expect((await run({ kind: 'screen', source: 's-services' })).failure).toBe('Unknown page')
    expect((await run({ kind: 'screen', source: 'Nowhere' })).failure).toBe('This site has no page “Nowhere” to copy.')
  })
})

describe('the duplicate door (AGL-3740)', () => {
  const admission = createAiDuplicateJobAdmission({
    ownerOf: async (hostId) => (hostId === 'host-1' ? 'org-1' : 'org-2'),
    readRows: async () => ROWS,
    lockdown: lockdownOpen as never,
  })
  const ask = (overrides: Record<string, unknown> = {}) =>
    admission({ firestore, orgId: 'org-1', hostId: 'host-1', inputs: { kind: 'screen', source: 's-services' }, org: PRO, uid: 'uid-1', ...overrides })

  it('admits an editor copying something the site has, and refuses everything else in words', async () => {
    expect(await ask()).toBeNull()
    expect(await ask({ hostId: 'host-2' })).toEqual({ status: 404, error: 'Unknown site' })
    expect(await ask({ hostId: null })).toEqual(expect.objectContaining({ status: 400 }))
    expect(await ask({ uid: 'uid-2' })).toEqual({ status: 403, error: AI_DUPLICATE_ROLE_COPY })
    expect(await ask({ inputs: { kind: 'screen', source: 'Twin' } })).toEqual(expect.objectContaining({ status: 400 }))
    expect(await ask({ inputs: { kind: 'product', source: 'p-1' } })).toEqual({ status: 400, error: AI_DUPLICATE_UNREADABLE_COPY })
  })

  it('registers its step, with the least time it needs, and its door', () => {
    registerAiDuplicateJob()
    expect(registerAiJobStep).toHaveBeenCalledWith('duplicate', expect.any(Function), { minimumMs: AI_JOB_DUPLICATE_STEP_MINIMUM_MS })
    expect(aiJobAdmissionFor('duplicate')).toBeTruthy()
  })
})

describe('the duplicate operation a build plans (AGL-3740)', () => {
  const capability = AI_OWNED_CAPABILITIES.find((one) => one.op === 'duplicate')

  it('is offered for every kind the console copies, costs no credits, and holds the planner to its arguments', () => {
    expect(capability).toMatchObject({ runnerKind: 'duplicate', maxPerPlan: 3, freeAllowed: true, degrade: 'omit' })
    expect(capability?.feature).toBeUndefined()
    expect(capability?.estimateCredits({ kind: 'screen', source: 's-1' })).toBe(0)
    const schema = capability?.argsSchema as NonNullable<typeof capability>['argsSchema']
    expect(schema.properties['kind'].enum).toEqual(DUPLICABLE_HOST_RESOURCE_KINDS)
    expect(pluginAiCapabilityArgsProblems(schema, { kind: 'screen', source: 's-services', name: 'Consulting' })).toEqual([])
    expect(pluginAiCapabilityArgsProblems(schema, { kind: 'product', source: 'p-1' })).toEqual([
      `"kind" must be one of ${DUPLICABLE_HOST_RESOURCE_KINDS.join(', ')}`,
    ])
    expect(pluginAiCapabilityArgsProblems(schema, { kind: 'screen' })).not.toEqual([])
  })

  it('is listed to the planner as an item operation, with its arguments', () => {
    const lines = aiBuildOpLines(new Map([['duplicate', capability as NonNullable<typeof capability>]]), [])
    const line = lines.find((one) => one.startsWith('- duplicate:')) as string
    expect(line).toContain('a copy of a page, component, layout, template, form, email design or workflow the site already has')
    expect(line).toContain(`kind: string one of ${DUPLICABLE_HOST_RESOURCE_KINDS.join('|')}`)
    expect(line).toContain('name: string (optional)')
  })
})
