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
 * The privacy step (AGL-4033). Its promises:
 *
 *  - Only the console's three controls: maintenance mode, the Discourage
 *    search engines switch, and a page's visibility as Public, Unlisted or
 *    Members only. Never a page password, which is not an argument.
 *  - Maintenance mode only for a site admin, as the Admin area is; a
 *    non-admin's other changes are still made and the note says why that one
 *    was not. Members only only where the plan serves gated pages.
 *  - Live on confirm, idempotent: only what differs is written, a switch
 *    turned off deletes its field as the cards do, leaving password mode drops
 *    the page's hash, with the site-wide outbox entry; asked again it writes
 *    nothing.
 *  - No model and no credits; offered to a build as one item, Free included.
 */

jest.mock('./ai-jobs', () => ({
  __esModule: true,
  registerAiJobStep: jest.fn(),
  aiJobStepRunnerFor: () => null,
}))

import { HostScreenVisibility } from '@aglyn/aglyn/foundation/definitions/platform.types'
import { pluginAiCapabilityArgsProblems } from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { FieldValue } from 'firebase-admin/firestore'
import type { AiJob } from '../model/ai-jobs.types'
import { AI_OWNED_CAPABILITIES, aiBuildOpLines } from './ai-build-capabilities'
import { aiJobAdmissionFor } from './ai-job-admission'
import { AI_JOB_ZERO_USAGE } from './ai-job-generation'
import {
  AI_JOB_PRIVACY_STEP_MINIMUM_MS,
  AI_PRIVACY_ADMIN_COPY,
  AI_PRIVACY_LOCKED_COPY,
  AI_PRIVACY_MAX_PAGES,
  AI_PRIVACY_NOTHING_COPY,
  AI_PRIVACY_ROLE_COPY,
  aiPrivacyOutputNote,
  aiPrivacyRequestOf,
  createAiJobPrivacyStep,
  createAiPrivacyJobAdmission,
  registerAiPrivacyJob,
  writeAiSitePrivacy,
} from './ai-job-privacy-step'
import { registerAiJobStep } from './ai-jobs'

const NOW = new Date('2026-10-24T15:00:00.000Z')
const FREE = { plan: 'free', billingStatus: 'active' }

describe('what a privacy change may ask (AGL-4033)', () => {
  it('reads both switches and each page’s visibility', () => {
    const read = aiPrivacyRequestOf({
      maintenance: true,
      discourageSearchEngines: false,
      unlistedPages: [' about '],
      membersPages: ['pricing'],
    })
    expect(read.problems).toEqual([])
    expect(read.request).toEqual({
      maintenance: true,
      discourageSearchEngines: false,
      pages: [
        { page: 'about', visibility: 'unlisted' },
        { page: 'pricing', visibility: 'members' },
      ],
    })
  })

  it('ignores what is not a choice, and leaves a page asked to be two things alone', () => {
    const read = aiPrivacyRequestOf({
      maintenance: 'yes',
      passwordPages: ['about'],
      publicPages: ['home', 'home', '', '../other-site/screens/x'],
      unlistedPages: ['home'],
    })
    expect(read.request).toEqual({ maintenance: null, discourageSearchEngines: null, pages: [] })
    expect(read.problems).toEqual(['A page was asked to be two things at once, so it was left as it is.'])
  })

  it('changes at most the page limit and says the rest were not', () => {
    const read = aiPrivacyRequestOf({
      unlistedPages: Array.from({ length: AI_PRIVACY_MAX_PAGES }, (_, index) => `p${index}`),
      publicPages: ['q1', 'q2', 'q3'],
    })
    expect(read.request.pages).toHaveLength(AI_PRIVACY_MAX_PAGES)
    expect(read.problems).toEqual([expect.stringContaining(`first ${AI_PRIVACY_MAX_PAGES} pages`)])
  })

  it('says it is live, and what was not done', () => {
    expect(aiPrivacyOutputNote(['Maintenance mode is off: the site is open to visitors again.'], 'Admin → Error pages', ['x'], true)).toBe(
      'Maintenance mode is off: the site is open to visitors again. Live now, in Admin → Error pages. Not done: x',
    )
    expect(aiPrivacyOutputNote(['a.'], 'here', [], false)).toContain('It already was, so nothing was written.')
  })
})

/** A transaction over one host, its pages and the outbox, as the write sees them. */
function transactionalFirestore(host: Record<string, unknown> | undefined, pages: Record<string, Record<string, unknown>> = {}) {
  const state = { host, pages, updates: [] as { target: string; data: Record<string, unknown> }[], outbox: [] as Record<string, unknown>[] }
  const snapshot = (target: string, data: Record<string, unknown> | undefined) => ({
    exists: data !== undefined,
    ref: { target },
    data: () => data,
    get: (field: string) => data?.[field],
  })
  const firestore = {
    collection: (name: string) => ({
      doc: (id?: string) => ({
        target: name === 'publishOutbox' ? 'outbox' : `host:${id}`,
        id: name === 'publishOutbox' ? 'outbox-1' : id,
        collection: () => ({ doc: (pageId: string) => ({ target: `page:${pageId}` }) }),
      }),
    }),
    runTransaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        get: async (ref: { target: string }) =>
          ref.target.startsWith('page:')
            ? snapshot(ref.target, state.pages[ref.target.slice(5)])
            : snapshot(ref.target, state.host),
        update: (ref: { target: string }, data: Record<string, unknown>) => state.updates.push({ target: ref.target, data }),
        set: (_ref: unknown, data: Record<string, unknown>) => state.outbox.push(data),
      }),
  } as unknown as FirebaseFirestore.Firestore
  return { firestore, state }
}

describe('the privacy write (AGL-4033)', () => {
  const request = (overrides: Partial<ReturnType<typeof aiPrivacyRequestOf>['request']> = {}) => ({
    maintenance: null,
    discourageSearchEngines: null,
    pages: [],
    ...overrides,
  })
  const write = (firestore: FirebaseFirestore.Firestore, asked: ReturnType<typeof request>, contentGating = true) =>
    writeAiSitePrivacy(firestore, { hostId: 'host-1', uid: 'uid-1', request: asked, contentGating, now: NOW })

  it('turns maintenance on for an admin, as the Error pages card writes it, with a site-wide outbox entry', async () => {
    const { firestore, state } = transactionalFirestore({ memberRoles: { 'uid-1': 'admin' }, errorScreens: { unavailable: 'scr-503' } })
    const written = await write(firestore, request({ maintenance: true }))
    expect(written).toEqual({
      ok: true,
      done: [{ output: 'maintenance', said: expect.stringContaining('shows your 503 page to every visitor') }],
      notDone: [],
      changedAny: true,
      outboxId: 'outbox-1',
    })
    expect(state.updates).toEqual([{ target: 'host:host-1', data: { maintenance: true, updatedAt: NOW } }])
    expect(state.outbox).toEqual([expect.objectContaining({ hostId: 'host-1', entireHost: true, attempts: 0 })])
  })

  it('says the plain notice shows when no 503 page is assigned, and deletes the field on the way off', async () => {
    const on = transactionalFirestore({ memberRoles: { 'uid-1': 'admin' } })
    const written = await write(on.firestore, request({ maintenance: true }))
    expect(written.ok && written.done[0].said).toContain('no 503 page is assigned yet')
    const off = transactionalFirestore({ memberRoles: { 'uid-1': 'admin' }, maintenance: true })
    await write(off.firestore, request({ maintenance: false }))
    expect(off.state.updates).toEqual([{ target: 'host:host-1', data: { maintenance: FieldValue.delete(), updatedAt: NOW } }])
  })

  it('never lets an editor change maintenance, and still makes the rest of the request', async () => {
    const { firestore, state } = transactionalFirestore({ memberRoles: { 'uid-1': 'editor' } })
    const written = await write(firestore, request({ maintenance: true, discourageSearchEngines: true }))
    expect(written).toEqual(expect.objectContaining({ ok: true, notDone: [AI_PRIVACY_ADMIN_COPY] }))
    expect(state.updates).toEqual([{ target: 'host:host-1', data: { 'seo.discourageSearchEngines': true, updatedAt: NOW } }])
  })

  it('sets page visibility, drops a password it leaves, and skips what is not a page', async () => {
    const { firestore, state } = transactionalFirestore(
      { memberRoles: { 'uid-1': 'author' } },
      {
        about: { displayName: 'About', visibility: HostScreenVisibility.PASSWORD, protection: { passwordHash: 'abc' } },
        pricing: { displayName: 'Pricing' },
        welcome: { displayName: 'Welcome email', kind: 'email' },
      },
    )
    const written = await write(
      firestore,
      request({
        pages: [
          { page: 'about', visibility: 'unlisted' },
          { page: 'pricing', visibility: 'members' },
          { page: 'welcome', visibility: 'unlisted' },
          { page: 'gone', visibility: 'public' },
        ],
      }),
    )
    expect(written.ok && written.done).toEqual([
      { output: 'pages', said: '“About” is now Unlisted. Its page password was removed.' },
      { output: 'pages', said: '“Pricing” is now Members only.' },
    ])
    expect(written.ok && written.notDone).toHaveLength(2)
    expect(state.updates).toEqual([
      { target: 'page:about', data: { visibility: HostScreenVisibility.UNLISTED, protection: FieldValue.delete(), updatedAt: NOW } },
      { target: 'page:pricing', data: { visibility: HostScreenVisibility.AUTHENTICATED, updatedAt: NOW } },
    ])
  })

  it('makes no page Members only on a plan that does not serve gated pages', async () => {
    const { firestore, state } = transactionalFirestore({ memberRoles: { 'uid-1': 'admin' } }, { pricing: { displayName: 'Pricing' } })
    const written = await write(firestore, request({ pages: [{ page: 'pricing', visibility: 'members' }] }), false)
    expect(written).toEqual(expect.objectContaining({ ok: true, done: [], changedAny: false, outboxId: null }))
    expect(written.ok && written.notDone[0]).toContain('need the Business plan or above')
    expect(state.updates).toEqual([])
  })

  it('writes nothing when everything already is as asked', async () => {
    const { firestore, state } = transactionalFirestore(
      { memberRoles: { 'uid-1': 'admin' }, maintenance: true, seo: { discourageSearchEngines: true } },
      { about: { displayName: 'About', visibility: HostScreenVisibility.UNLISTED } },
    )
    const written = await write(firestore, request({ maintenance: true, discourageSearchEngines: true, pages: [{ page: 'about', visibility: 'unlisted' }] }))
    expect(written).toEqual(expect.objectContaining({ ok: true, changedAny: false, outboxId: null }))
    expect(state.updates).toEqual([])
    expect(state.outbox).toEqual([])
  })

  it('refuses a member who lost the write role by the time it writes', async () => {
    const { firestore, state } = transactionalFirestore({ memberRoles: { 'uid-1': 'viewer' } })
    expect(await write(firestore, request({ discourageSearchEngines: true }))).toEqual({ ok: false, error: AI_PRIVACY_ROLE_COPY })
    expect(state.updates).toEqual([])
  })
})

describe('the privacy step (AGL-4033)', () => {
  const hosts = new Map<string, Record<string, unknown>>()
  const firestore = {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          const data = name === 'hosts' ? hosts.get(id) : undefined
          return { id, exists: data !== undefined, data: () => data, get: (field: string) => data?.[field] }
        },
        delete: jest.fn(async () => undefined),
      }),
    }),
  } as unknown as FirebaseFirestore.Firestore
  const job = (inputs: Record<string, unknown>): AiJob =>
    ({
      $id: 'job-privacy-1',
      orgId: 'org-1',
      hostId: 'host-1',
      kind: 'privacy',
      status: 'running',
      brief: 'Make my site private until launch.',
      inputs,
      steps: [],
      outputs: [],
      creditsReserved: 0,
      creditsSpent: 0,
      createdBy: 'uid-1',
      createdAt: NOW,
      updatedAt: NOW,
      expiresAt: NOW,
    }) as unknown as AiJob
  const lockdownOpen = jest.fn(async () => null)
  const write = jest.fn(async (..._args: unknown[]) => ({
    ok: true as const,
    done: [
      { output: 'maintenance' as const, said: 'Maintenance mode is on: every address shows your 503 page to every visitor.' },
      { output: 'search' as const, said: 'Search engines are asked not to index this site. Anyone with a link can still open it.' },
    ],
    notDone: [],
    changedAny: true,
    outboxId: 'outbox-1',
  }))
  const dropCache = jest.fn(async () => ({ dropped: 1, skipped: 0, complete: true }))
  const run = (inputs: Record<string, unknown>, lockdown = lockdownOpen) =>
    createAiJobPrivacyStep({ write: write as never, lockdown: lockdown as never, dropCache: dropCache as never })({
      job: job(inputs),
      stepIndex: 0,
      now: NOW,
      firestore,
      org: FREE as never,
    })

  beforeEach(() => {
    hosts.clear()
    hosts.set('host-1', { orgId: 'org-1', subdomain: 'juniper', memberRoles: { 'uid-1': 'admin', 'uid-2': 'viewer' } })
    for (const mock of [write, dropCache, lockdownOpen]) mock.mockClear()
  })

  it('saves live at no cost, drops the site’s cache, and gives each change its own output', async () => {
    const outcome = await run({ maintenance: true, discourageSearchEngines: true })
    expect(outcome.failure).toBeUndefined()
    expect(outcome.usage).toEqual(AI_JOB_ZERO_USAGE)
    expect(outcome.estCostUsd).toBe(0)
    expect(write).toHaveBeenCalledWith(firestore, {
      hostId: 'host-1',
      uid: 'uid-1',
      request: { maintenance: true, discourageSearchEngines: true, pages: [] },
      // Free has no content gating.
      contentGating: false,
      now: NOW,
    })
    expect(dropCache).toHaveBeenCalledWith(expect.objectContaining({ hostIds: ['host-1'] }))
    expect(outcome.outputs).toEqual([
      expect.objectContaining({ resource: 'privacy', id: 'maintenance', hostId: 'host-1', hostSubdomain: 'juniper', label: 'Maintenance mode' }),
      expect.objectContaining({ resource: 'privacy', id: 'search', label: 'Search engines' }),
    ])
    expect(outcome.outputs[0].note).toContain('Live now, in Admin → Error pages.')
    expect(outcome.outputs[1].note).toContain('Live now, in Setup → SEO.')
  })

  it('fails in words when the request names nothing it may change', async () => {
    expect((await run({ password: 'hunter2' })).failure).toBe(AI_PRIVACY_NOTHING_COPY)
    expect(write).not.toHaveBeenCalled()
  })

  it('refuses a viewer, an editor asking only for maintenance, and a frozen site, writing nothing', async () => {
    hosts.set('host-1', { orgId: 'org-1', memberRoles: { 'uid-1': 'viewer' } })
    expect((await run({ discourageSearchEngines: true })).review).toEqual(expect.objectContaining({ reason: 'limit', message: AI_PRIVACY_ROLE_COPY }))
    hosts.set('host-1', { orgId: 'org-1', memberRoles: { 'uid-1': 'editor' } })
    expect((await run({ maintenance: true })).review?.message).toBe(AI_PRIVACY_ADMIN_COPY)
    expect((await run({ discourageSearchEngines: true }, jest.fn(async () => ({ scope: 'host' })) as never)).review?.message).toBe(AI_PRIVACY_LOCKED_COPY)
    expect(write).not.toHaveBeenCalled()
  })

  const admission = createAiPrivacyJobAdmission({ ownerOf: async (hostId) => (hostId === 'host-1' ? 'org-1' : 'org-2'), lockdown: lockdownOpen as never })
  const ask = (overrides: Record<string, unknown> = {}) =>
    admission({ firestore, orgId: 'org-1', hostId: 'host-1', inputs: { discourageSearchEngines: true }, org: FREE, uid: 'uid-1', ...overrides })

  it('admits a member naming a change, and refuses everything else in words', async () => {
    expect(await ask()).toBeNull()
    expect(await ask({ inputs: { maintenance: true } })).toBeNull()
    expect(await ask({ hostId: 'host-2' })).toEqual({ status: 404, error: 'Unknown site' })
    expect(await ask({ hostId: null })).toEqual(expect.objectContaining({ status: 400 }))
    expect(await ask({ uid: 'uid-2' })).toEqual({ status: 403, error: AI_PRIVACY_ROLE_COPY })
    expect(await ask({ inputs: { password: 'x' } })).toEqual({ status: 400, error: AI_PRIVACY_NOTHING_COPY })
  })

  it('registers its step, with the least time it needs, and its door', () => {
    registerAiPrivacyJob()
    expect(registerAiJobStep).toHaveBeenCalledWith('privacy', expect.any(Function), { minimumMs: AI_JOB_PRIVACY_STEP_MINIMUM_MS })
    expect(aiJobAdmissionFor('privacy')).toBeTruthy()
  })
})

describe('the privacy operation a build plans (AGL-4033)', () => {
  const capability = AI_OWNED_CAPABILITIES.find((one) => one.op === 'privacy')

  it('is one live item per plan, Free included, at no cost, and never takes a password', () => {
    expect(capability).toMatchObject({ runnerKind: 'privacy', maxPerPlan: 1, freeAllowed: true, degrade: 'omit', live: true })
    expect(capability?.feature).toBeUndefined()
    expect(capability?.estimateCredits({ maintenance: true })).toBe(0)
    const schema = capability?.argsSchema as NonNullable<typeof capability>['argsSchema']
    expect(Object.keys(schema.properties).sort()).toEqual(['discourageSearchEngines', 'maintenance', 'membersPages', 'publicPages', 'unlistedPages'])
    for (const never of ['password', 'pagePassword', 'passwordHash', 'protection', 'errorScreens', 'memberRoles', 'subdomain']) {
      expect([never, never in schema.properties]).toEqual([never, false])
    }
    expect(pluginAiCapabilityArgsProblems(schema, { maintenance: true, unlistedPages: ['about'], membersPages: ['pricing'] })).toEqual([])
    expect(pluginAiCapabilityArgsProblems(schema, { passwordPages: ['about'] })).not.toEqual([])
    expect(pluginAiCapabilityArgsProblems(schema, { password: 'x' })).not.toEqual([])
  })

  it('is listed to the planner as making the site private, without passwords', () => {
    const lines = aiBuildOpLines(new Map([['privacy', capability as NonNullable<typeof capability>]]), [])
    const line = lines.find((one) => one.startsWith('- privacy:')) as string
    expect(line).toContain('making the site private')
    expect(line).toContain('never a page password')
    expect(line).toContain('maintenance: boolean (optional)')
  })
})
