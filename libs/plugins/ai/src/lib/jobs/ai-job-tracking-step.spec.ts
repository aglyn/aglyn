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
 * The tracking step (AGL-3751). Its promises:
 *
 *  - Only the Setup → Tracking card's fields, each held to the pattern the
 *    card and the tenant's loader share; a bad id is named and skipped while
 *    the rest are written.
 *  - Only public ids: no credential, no consent banner setting, no indexing
 *    switch is an argument, so none can be asked for.
 *  - Live on confirm, idempotent: only what differs is written, a removal
 *    deletes the field as the card's cleared box does, with the site-wide
 *    outbox entry; a pass asked again writes nothing.
 *  - Only a member who may edit the site, while nothing freezes it. No
 *    model and no credits; offered to a build as one item, Free included.
 */

jest.mock('./ai-jobs', () => ({
  __esModule: true,
  registerAiJobStep: jest.fn(),
  aiJobStepRunnerFor: () => null,
}))

import { pluginAiCapabilityArgsProblems } from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { FieldValue } from 'firebase-admin/firestore'
import type { AiJob } from '../model/ai-jobs.types'
import { AI_OWNED_CAPABILITIES, aiBuildOpLines } from './ai-build-capabilities'
import { aiJobAdmissionFor } from './ai-job-admission'
import { AI_JOB_ZERO_USAGE } from './ai-job-generation'
import {
  AI_JOB_TRACKING_STEP_MINIMUM_MS,
  AI_TRACKING_LOCKED_COPY,
  AI_TRACKING_NOTHING_COPY,
  AI_TRACKING_ROLE_COPY,
  AI_TRACKING_TAGS,
  AI_TRACKING_WHICH_COPY,
  aiTrackingChanges,
  aiTrackingMissingInput,
  aiTrackingOutputNote,
  aiTrackingRequestOf,
  aiTrackingWarnings,
  createAiJobTrackingStep,
  createAiTrackingJobAdmission,
  registerAiTrackingJob,
  writeAiSiteTracking,
} from './ai-job-tracking-step'
import { registerAiJobStep } from './ai-jobs'

const NOW = new Date('2026-10-13T15:00:00.000Z')
const FREE = { plan: 'free', billingStatus: 'active' }

describe('what a tracking change may ask (AGL-3751)', () => {
  it('writes each id to the field the Tracking card writes', () => {
    const read = aiTrackingRequestOf({
      googleAnalytics: ' G-4R7KX2PQ9Z ',
      googleTagManager: 'GTM-W3K9PX2',
      metaPixel: '123456789012345',
      googleAds: 'AW-123456789',
      linkedinInsight: '5512345',
      tiktokPixel: 'C4ABCDEFGH1234567890',
      pinterestTag: '2612345678901',
    })
    expect(read.problems).toEqual([])
    expect(read.request).toEqual({
      set: {
        'analytics.gaMeasurementId': 'G-4R7KX2PQ9Z',
        'analytics.gtmContainerId': 'GTM-W3K9PX2',
        'analytics.adTags.meta': '123456789012345',
        'analytics.adTags.google-ads': 'AW-123456789',
        'analytics.adTags.linkedin': '5512345',
        'analytics.adTags.tiktok': 'C4ABCDEFGH1234567890',
        'analytics.adTags.pinterest': '2612345678901',
      },
      remove: [],
    })
  })

  it('names every id that is not the card’s shape, and keeps the rest', () => {
    const read = aiTrackingRequestOf({
      googleAnalytics: 'UA-12345-1',
      googleTagManager: 'gtm-abc',
      metaPixel: '12345',
      googleAds: 'G-ABCDEFGH',
      linkedinInsight: '5512345',
      tiktokPixel: 'lowercase-not-ok',
      pinterestTag: '<script>',
    })
    expect(read.request).toEqual({ set: { 'analytics.adTags.linkedin': '5512345' }, remove: [] })
    expect(read.problems).toHaveLength(6)
    expect(read.problems[0]).toBe('“UA-12345-1” is not an ID for Google Analytics, which looks like G-XXXXXXXXXX.')
  })

  it('removes a tag by deleting its field, and refuses a tag both set and removed', () => {
    expect(aiTrackingRequestOf({ remove: ['metaPixel', 'googleTagManager', 'nonsense'] }).request).toEqual({
      set: {},
      remove: ['analytics.gtmContainerId', 'analytics.adTags.meta'],
    })
    const both = aiTrackingRequestOf({ metaPixel: '123456789', remove: ['metaPixel'] })
    expect(both.request).toEqual({ set: {}, remove: [] })
    expect(both.problems).toEqual(['The Meta pixel was both set and removed, so it was left as it is.'])
  })

  it('uses the very patterns the console and the loader share', () => {
    // A drift here would be a field that saves an id the site never loads.
    expect(AI_TRACKING_TAGS.map((tag) => tag.path)).toEqual([
      'analytics.gaMeasurementId',
      'analytics.gtmContainerId',
      'analytics.adTags.meta',
      'analytics.adTags.google-ads',
      'analytics.adTags.linkedin',
      'analytics.adTags.tiktok',
      'analytics.adTags.pinterest',
    ])
  })
})

describe('what a tracking change with no usable id asks (AGL-3751)', () => {
  it('asks nothing of an item that sets or removes a tag', () => {
    expect(aiTrackingMissingInput({ name: 'Analytics', args: { googleAnalytics: 'G-4R7KX2PQ9Z' } })).toBeNull()
    expect(aiTrackingMissingInput({ name: 'Remove TikTok', args: { remove: ['tiktokPixel'] } })).toBeNull()
  })

  it('asks for the id of the tag its name names, in the card’s words', () => {
    expect(aiTrackingMissingInput({ name: 'Meta pixel', args: {} })).toBe(
      'What’s your Meta pixel ID? It’s the number (8–20 digits) shown for your pixel in Meta Events Manager.',
    )
    expect(aiTrackingMissingInput({ name: 'Connect Google Tag Manager', args: {} })).toBe('What’s your Google Tag Manager container ID? It looks like GTM-XXXXXXX.')
    expect(aiTrackingMissingInput({ name: 'Google Ads tag', args: {} })).toBe('What’s your Google Ads conversion ID? It looks like AW-123456789, from Google Ads.')
  })

  it('reads its reason when its name names no tag, and asks which tag when neither does', () => {
    expect(aiTrackingMissingInput({ name: 'Tracking', why: 'They want their Facebook pixel installed.', args: {} })).toContain('Meta pixel ID')
    expect(aiTrackingMissingInput({ name: 'Tracking', why: 'Set up tracking.', args: {} })).toBe(AI_TRACKING_WHICH_COPY)
  })

  it('names an id of the wrong shape, and asks for that tag’s id', () => {
    expect(aiTrackingMissingInput({ name: 'Tracking', args: { tiktokPixel: 'my pixel' } })).toBe(
      '“my pixel” is not an ID for the TikTok pixel, which looks like 16–24 capital letters and digits. What’s your TikTok pixel code? It’s in TikTok Ads Manager → Events, like C4ABCDEFGH1234567890.',
    )
  })

  it('is the capability’s plan-time check', () => {
    const capability = AI_OWNED_CAPABILITIES.find((one) => one.op === 'tracking')
    expect(capability?.missingInput).toBe(aiTrackingMissingInput)
  })
})

describe('what the person is told about the tags (AGL-3751)', () => {
  it('says each change in the card’s order', () => {
    expect(aiTrackingChanges({ set: { 'analytics.adTags.meta': '123456789', 'analytics.gaMeasurementId': 'G-ABCD1234' }, remove: ['analytics.gtmContainerId'] })).toEqual([
      { path: 'analytics.gaMeasurementId', value: 'G-ABCD1234', said: 'Google Analytics is connected (G-ABCD1234).' },
      { path: 'analytics.gtmContainerId', value: null, said: 'Google Tag Manager is removed.' },
      { path: 'analytics.adTags.meta', value: '123456789', said: 'The Meta pixel is connected (123456789).' },
    ])
  })

  it('warns of a container beside a direct Google tag, and of a site whose own consent tool decides', () => {
    expect(aiTrackingWarnings({ analytics: { gaMeasurementId: 'G-ABCD1234' } })).toEqual([])
    expect(aiTrackingWarnings({ analytics: { gaMeasurementId: 'G-ABCD1234', gtmContainerId: 'GTM-ABCDE' } })).toEqual([expect.stringContaining('counts every visit and conversion twice')])
    expect(aiTrackingWarnings({ analytics: { adTags: { 'google-ads': 'AW-1234567' }, gtmContainerId: 'GTM-ABCDE' } })).toHaveLength(1)
    expect(aiTrackingWarnings({ consent: { disabled: true }, analytics: { adTags: { meta: '123456789' } } })).toEqual([expect.stringContaining('its own consent tool')])
    expect(aiTrackingWarnings({ consent: { disabled: true } })).toEqual([])
  })

  it('says it is live, that consent gates it, and what was not done', () => {
    const note = aiTrackingOutputNote(['Google Analytics is connected (G-ABCD1234).'], [], ['“x” is not an ID for the Meta pixel, which looks like 8–20 digits.'], true)
    expect(note).toBe(
      'Google Analytics is connected (G-ABCD1234). Live now, in Setup → Tracking. Tags load only where a visitor’s cookie consent allows them. Not done: “x” is not an ID for the Meta pixel, which looks like 8–20 digits.',
    )
    expect(aiTrackingOutputNote(['Google Analytics is connected (G-ABCD1234).'], [], [], false)).toContain('It already was, so nothing was written.')
  })
})

/** A transaction over one host document and the outbox, as the write sees them. */
function transactionalFirestore(host: Record<string, unknown> | undefined) {
  const state = { host, updates: [] as Record<string, unknown>[], outbox: [] as Record<string, unknown>[] }
  const firestore = {
    collection: (name: string) => ({
      doc: (id?: string) => ({ name, id: name === 'publishOutbox' ? 'outbox-1' : id }),
    }),
    runTransaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        get: async () => ({
          exists: state.host !== undefined,
          data: () => state.host,
          get: (field: string) => state.host?.[field],
        }),
        update: (_ref: unknown, data: Record<string, unknown>) => state.updates.push(data),
        set: (_ref: unknown, data: Record<string, unknown>) => state.outbox.push(data),
      }),
  } as unknown as FirebaseFirestore.Firestore
  return { firestore, state }
}

describe('the tracking write (AGL-3751)', () => {
  it('writes only what differs, deletes a removed tag, with a site-wide outbox entry, and nothing the second time', async () => {
    const { firestore, state } = transactionalFirestore({
      memberRoles: { 'uid-1': 'author' },
      analytics: { gaMeasurementId: 'G-ABCD1234', adTags: { meta: '123456789' } },
      consent: { mode: 'geo' },
    })
    const request = { set: { 'analytics.gaMeasurementId': 'G-ABCD1234', 'analytics.gtmContainerId': 'GTM-ABCDE' }, remove: ['analytics.adTags.meta', 'analytics.adTags.tiktok'] }
    const written = await writeAiSiteTracking(firestore, { hostId: 'host-1', uid: 'uid-1', request, now: NOW })
    expect(written).toEqual({
      ok: true,
      done: [
        'Google Analytics is connected (G-ABCD1234).',
        'Google Tag Manager is connected (GTM-ABCDE).',
        'The Meta pixel is removed.',
        'The TikTok pixel is removed.',
      ],
      changed: ['analytics.gtmContainerId', 'analytics.adTags.meta'],
      warnings: [expect.stringContaining('counts every visit and conversion twice')],
      outboxId: 'outbox-1',
    })
    expect(state.updates).toEqual([{ updatedAt: NOW, 'analytics.gtmContainerId': 'GTM-ABCDE', 'analytics.adTags.meta': FieldValue.delete() }])
    // Nothing about consent is ever written.
    expect(Object.keys(state.updates[0]).some((key) => key.startsWith('consent'))).toBe(false)
    expect(state.outbox).toEqual([expect.objectContaining({ hostId: 'host-1', entireHost: true, attempts: 0 })])

    const again = transactionalFirestore({ memberRoles: { 'uid-1': 'author' }, analytics: { gaMeasurementId: 'G-ABCD1234', gtmContainerId: 'GTM-ABCDE' } })
    expect(await writeAiSiteTracking(again.firestore, { hostId: 'host-1', uid: 'uid-1', request, now: NOW })).toEqual(expect.objectContaining({ ok: true, changed: [], outboxId: null }))
    expect(again.state.updates).toEqual([])
    expect(again.state.outbox).toEqual([])
  })

  it('refuses a member who lost the write role by the time it writes', async () => {
    const { firestore, state } = transactionalFirestore({ memberRoles: { 'uid-1': 'viewer' } })
    expect(await writeAiSiteTracking(firestore, { hostId: 'host-1', uid: 'uid-1', request: { set: { 'analytics.gaMeasurementId': 'G-ABCD1234' }, remove: [] }, now: NOW })).toEqual({
      ok: false,
      error: AI_TRACKING_ROLE_COPY,
    })
    expect(state.updates).toEqual([])
  })
})

describe('the tracking step (AGL-3751)', () => {
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
      $id: 'job-tracking-1',
      orgId: 'org-1',
      hostId: 'host-1',
      kind: 'tracking',
      status: 'running',
      brief: 'Connect Google Analytics G-4R7KX2PQ9Z.',
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
    done: ['Google Analytics is connected (G-4R7KX2PQ9Z).'],
    changed: ['analytics.gaMeasurementId'],
    warnings: [],
    outboxId: 'outbox-1',
  }))
  const dropCache = jest.fn(async () => ({ dropped: 1, skipped: 0, complete: true }))
  const run = (inputs: Record<string, unknown>, lockdown = lockdownOpen) =>
    createAiJobTrackingStep({ write: write as never, lockdown: lockdown as never, dropCache: dropCache as never })({
      job: job(inputs),
      stepIndex: 0,
      now: NOW,
      firestore,
      org: FREE as never,
    })

  beforeEach(() => {
    hosts.clear()
    hosts.set('host-1', { orgId: 'org-1', subdomain: 'juniper', memberRoles: { 'uid-1': 'editor', 'uid-2': 'viewer' } })
    for (const mock of [write, dropCache, lockdownOpen]) mock.mockClear()
  })

  it('saves live at no cost, drops the site’s cache, and says what it did', async () => {
    const outcome = await run({ googleAnalytics: 'G-4R7KX2PQ9Z', metaPixel: 'oops' })
    expect(outcome.failure).toBeUndefined()
    expect(outcome.usage).toEqual(AI_JOB_ZERO_USAGE)
    expect(outcome.estCostUsd).toBe(0)
    expect(write).toHaveBeenCalledWith(firestore, {
      hostId: 'host-1',
      uid: 'uid-1',
      request: { set: { 'analytics.gaMeasurementId': 'G-4R7KX2PQ9Z' }, remove: [] },
      now: NOW,
    })
    expect(dropCache).toHaveBeenCalledWith(expect.objectContaining({ hostIds: ['host-1'] }))
    expect(outcome.outputs).toEqual([expect.objectContaining({ resource: 'tracking', id: 'tracking', hostId: 'host-1', hostSubdomain: 'juniper', label: 'Site tracking' })])
    expect(outcome.outputs[0].note).toContain('Live now, in Setup → Tracking.')
    expect(outcome.outputs[0].note).toContain('Not done: “oops” is not an ID for the Meta pixel')
    expect(lockdownOpen).toHaveBeenCalledWith(expect.objectContaining({ staff: false, uid: 'uid-1', intent: 'write' }))
  })

  it('fails in words when the request names nothing it may set', async () => {
    expect((await run({ consentDisabled: true, accessToken: 'EAAB…' })).failure).toBe(AI_TRACKING_NOTHING_COPY)
    expect((await run({ googleAnalytics: 'my analytics' })).failure).toContain(AI_TRACKING_NOTHING_COPY)
    expect(write).not.toHaveBeenCalled()
  })

  it('refuses a member who may not edit the site and a frozen site, writing nothing', async () => {
    hosts.set('host-1', { orgId: 'org-1', memberRoles: { 'uid-1': 'viewer' } })
    expect((await run({ googleAnalytics: 'G-4R7KX2PQ9Z' })).review).toEqual(expect.objectContaining({ reason: 'limit', message: AI_TRACKING_ROLE_COPY }))
    hosts.set('host-1', { orgId: 'org-1', memberRoles: { 'uid-1': 'editor' } })
    expect((await run({ googleAnalytics: 'G-4R7KX2PQ9Z' }, jest.fn(async () => ({ scope: 'host' })) as never)).review?.message).toBe(AI_TRACKING_LOCKED_COPY)
    expect(write).not.toHaveBeenCalled()
  })

  const admission = createAiTrackingJobAdmission({ ownerOf: async (hostId) => (hostId === 'host-1' ? 'org-1' : 'org-2'), lockdown: lockdownOpen as never })
  const ask = (overrides: Record<string, unknown> = {}) =>
    admission({ firestore, orgId: 'org-1', hostId: 'host-1', inputs: { googleAnalytics: 'G-4R7KX2PQ9Z' }, org: FREE, uid: 'uid-1', ...overrides })

  it('admits an editor naming a tag, and refuses everything else in words', async () => {
    expect(await ask()).toBeNull()
    expect(await ask({ inputs: { remove: ['googleAnalytics'] } })).toBeNull()
    expect(await ask({ hostId: 'host-2' })).toEqual({ status: 404, error: 'Unknown site' })
    expect(await ask({ hostId: null })).toEqual(expect.objectContaining({ status: 400 }))
    expect(await ask({ uid: 'uid-2' })).toEqual({ status: 403, error: AI_TRACKING_ROLE_COPY })
    expect(await ask({ inputs: { consent: 'off' } })).toEqual({ status: 400, error: AI_TRACKING_NOTHING_COPY })
  })

  it('registers its step, with the least time it needs, and its door', () => {
    registerAiTrackingJob()
    expect(registerAiJobStep).toHaveBeenCalledWith('tracking', expect.any(Function), { minimumMs: AI_JOB_TRACKING_STEP_MINIMUM_MS })
    expect(aiJobAdmissionFor('tracking')).toBeTruthy()
  })
})

describe('the tracking operation a build plans (AGL-3751)', () => {
  const capability = AI_OWNED_CAPABILITIES.find((one) => one.op === 'tracking')

  it('is one live item per plan, Free included, at no cost, and offers no credential or consent field', () => {
    expect(capability).toMatchObject({ runnerKind: 'tracking', maxPerPlan: 1, freeAllowed: true, degrade: 'omit', live: true, where: 'Setup → Tracking' })
    expect(capability?.feature).toBeUndefined()
    expect(capability?.estimateCredits({ googleAnalytics: 'G-ABCD1234' })).toBe(0)
    const schema = capability?.argsSchema as NonNullable<typeof capability>['argsSchema']
    expect(Object.keys(schema.properties).sort()).toEqual(
      ['googleAds', 'googleAnalytics', 'googleTagManager', 'linkedinInsight', 'metaPixel', 'pinterestTag', 'remove', 'tiktokPixel'].sort(),
    )
    for (const never of ['accessToken', 'token', 'secret', 'apiKey', 'consent', 'consentMode', 'consentDisabled', 'advertising', 'discourageSearchEngines', 'verification', 'webhookUrl', 'zapier']) {
      expect([never, never in schema.properties]).toEqual([never, false])
    }
    expect(pluginAiCapabilityArgsProblems(schema, { googleAnalytics: 'G-ABCD1234', remove: ['metaPixel'] })).toEqual([])
    expect(pluginAiCapabilityArgsProblems(schema, { remove: ['consentBanner'] })).not.toEqual([])
    expect(pluginAiCapabilityArgsProblems(schema, { accessToken: 'x' })).not.toEqual([])
  })

  it('is listed to the planner as an item operation that never makes up an id', () => {
    const lines = aiBuildOpLines(new Map([['tracking', capability as NonNullable<typeof capability>]]), [])
    const line = lines.find((one) => one.startsWith('- tracking:')) as string
    expect(line).toContain('never one it makes up')
    expect(line).toContain('googleAnalytics: string (optional)')
  })
})
