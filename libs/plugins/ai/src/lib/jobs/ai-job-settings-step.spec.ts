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
 * The settings step (AGL-3748). Its promises:
 *
 *  - Only fields a console settings card writes, each held to that card's
 *    limit or rule; anything else is not an argument, and a bad value is
 *    named and skipped while the rest are written.
 *  - Images come from the media library the site may use, written as the
 *    pickers write them (`mediaNodeSrc`), never a private or deleted one.
 *  - A language change is the Languages card's: one language replaced, a
 *    multilingual site's default moved only to a language it lists.
 *  - Live on confirm, idempotent: only what differs is written, with the
 *    site-wide outbox entry, and a pass asked again writes nothing.
 *  - Only a member who may edit the site, while nothing freezes it. No
 *    model and no credits; offered to a build as one item, Free included.
 */

jest.mock('./ai-jobs', () => ({
  __esModule: true,
  registerAiJobStep: jest.fn(),
  aiJobStepRunnerFor: () => null,
}))

import { pluginAiCapabilityArgsProblems } from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import type { AiJob } from '../model/ai-jobs.types'
import { AI_OWNED_CAPABILITIES, aiBuildOpLines } from './ai-build-capabilities'
import { aiJobAdmissionFor } from './ai-job-admission'
import { AI_JOB_ZERO_USAGE } from './ai-job-generation'
import {
  AI_JOB_SETTINGS_STEP_MINIMUM_MS,
  AI_SETTINGS_LOCKED_COPY,
  AI_SETTINGS_NOTHING_COPY,
  AI_SETTINGS_ROLE_COPY,
  aiSettingsChanges,
  aiSettingsLanguageChanges,
  aiSettingsMediaOf,
  aiSettingsRequestOf,
  aiSettingsTitlePatternOk,
  createAiJobSettingsStep,
  createAiSettingsJobAdmission,
  registerAiSettingsJob,
  writeAiSiteSettings,
  type AiSettingsMediaRow,
} from './ai-job-settings-step'
import { registerAiJobStep } from './ai-jobs'

const NOW = new Date('2026-10-12T15:00:00.000Z')
const FREE = { plan: 'free', billingStatus: 'active' }

function image(overrides: Partial<AiSettingsMediaRow> = {}): AiSettingsMediaRow {
  return {
    id: 'm-logo',
    fileName: 'logo.png',
    contentType: 'image/png',
    url: 'https://example.com/logo.png',
    cdnPath: null,
    contentHash: null,
    private: false,
    deleted: false,
    width: 512,
    height: 512,
    alt: 'Juniper Clay Studio',
    ...overrides,
  }
}

describe('what a settings change may ask (AGL-3748)', () => {
  it('reads each value to the console’s own limit, and names what it skips', () => {
    const read = aiSettingsRequestOf({
      name: 'Juniper Clay Studio',
      seoTitle: 'Juniper Clay Studio | Pottery classes',
      seoDescription: 'Wheel and hand-building classes in Asheville.',
      separator: '|',
      telephone: '+1 (828) 555-0142',
      supportEmail: 'hello@juniperclay.com',
      language: 'ES',
      timeZone: 'America/New_York',
      consentMode: 'strict',
      favicon: 'icon.png',
    })
    expect(read.problems).toEqual([])
    expect(read.request).toEqual({
      name: 'Juniper Clay Studio',
      seoTitle: 'Juniper Clay Studio | Pottery classes',
      seoDescription: 'Wheel and hand-building classes in Asheville.',
      separator: '|',
      telephone: '+1 (828) 555-0142',
      supportEmail: 'hello@juniperclay.com',
      language: 'es',
      timeZone: 'America/New_York',
      consentMode: 'strict',
      favicon: 'icon.png',
    })
  })

  it('skips a value past its limit or out of its rule, and keeps the rest', () => {
    const read = aiSettingsRequestOf({
      name: 'A site name far longer than thirty characters',
      seoDescription: 'x'.repeat(156),
      separator: '----',
      supportEmail: 'not an email',
      telephone: 'call me',
      language: 'Spanish',
      timeZone: 'Mars/Olympus',
      consentMode: 'off',
      titlePattern: '{{page.title}} | {{site.name}}',
      seoTitle: 'Kept',
    })
    expect(read.request).toEqual({ seoTitle: 'Kept' })
    expect(read.problems).toHaveLength(9)
    expect(read.problems.join(' ')).toContain('longer than 30 characters')
    expect(read.problems.join(' ')).toContain('“Spanish” is not a language code')
  })

  it('holds a title pattern to the renderer’s own variables', () => {
    expect(aiSettingsTitlePatternOk('{{site.name}} — {{page.name}}')).toBe(true)
    expect(aiSettingsTitlePatternOk('{{ page.name }} {{site.separator}} {{site.name}}')).toBe(true)
    expect(aiSettingsTitlePatternOk('{{page.title}}')).toBe(false)
    expect(aiSettingsTitlePatternOk('{{page.name} broken')).toBe(false)
  })
})

describe('the language a settings change sets (AGL-3748)', () => {
  it('replaces a one-language site’s language and sets a site with none', () => {
    expect(aiSettingsLanguageChanges({}, 'es')).toEqual([
      expect.objectContaining({ path: 'locales', value: ['es'] }),
      expect.objectContaining({ path: 'defaultLocale', value: 'es' }),
    ])
    expect(aiSettingsLanguageChanges({ locales: ['en'], defaultLocale: 'en' }, 'es')).toEqual([
      expect.objectContaining({ path: 'locales', value: ['es'] }),
      expect.objectContaining({ path: 'defaultLocale', value: 'es' }),
    ])
  })

  it('moves a multilingual site’s default only to a language it lists, never adding one', () => {
    expect(aiSettingsLanguageChanges({ locales: ['en', 'es'], defaultLocale: 'en' }, 'es')).toEqual([
      expect.objectContaining({ path: 'defaultLocale', value: 'es' }),
    ])
    expect(aiSettingsLanguageChanges({ locales: ['en', 'es'] }, 'fr')).toEqual({ error: expect.stringContaining('add fr in Settings') })
  })
})

describe('the images a settings change names (AGL-3748)', () => {
  it('takes a public image of the site’s library, by id or file name, as the pickers write it', () => {
    expect(aiSettingsMediaOf('logo', 'm-logo', [image()], 'host-1')).toEqual({
      src: 'https://example.com/logo.png',
      width: 512,
      height: 512,
      alt: 'Juniper Clay Studio',
      fileName: 'logo.png',
    })
    expect(aiSettingsMediaOf('logo', 'logo.png', [image()], 'host-1')).toEqual(expect.objectContaining({ fileName: 'logo.png' }))
  })

  it('refuses a private, deleted, non-image or other site’s asset, and two of one name', () => {
    const none = (rows: AiSettingsMediaRow[]) => aiSettingsMediaOf('favicon', 'logo.png', rows, 'host-1')
    expect(none([image({ private: true })])).toEqual({ error: expect.stringContaining('no image “logo.png”') })
    expect(none([image({ deleted: true })])).toEqual({ error: expect.any(String) })
    expect(none([image({ contentType: 'application/pdf' })])).toEqual({ error: expect.any(String) })
    expect(none([image({ visibleTo: ['host:host-2'] })])).toEqual({ error: expect.any(String) })
    expect(none([image({ visibleTo: null })])).toEqual({ error: expect.any(String) })
    expect(none([image({ visibleTo: ['org'] })])).toEqual(expect.objectContaining({ fileName: 'logo.png' }))
    expect(none([image(), image({ id: 'm-2' })])).toEqual({ error: expect.stringContaining('more than one image') })
  })
})

describe('the changes a settings change makes (AGL-3748)', () => {
  it('writes each value to the field its console control writes', () => {
    const { changes, problems } = aiSettingsChanges(
      { seo: { imageAlt: '' } },
      {
        name: 'Juniper',
        seoTitle: 'Juniper Clay',
        seoDescription: 'Classes.',
        businessName: 'Juniper Clay Studio',
        businessDescription: 'A pottery studio.',
        supportEmail: 'a@b.co',
        address: '1 Main St',
        timeZone: 'America/Chicago',
        consentMode: 'geo',
      },
      { socialImage: { src: 'media:host-1/m-1', width: 1200, height: 630, alt: 'Studio', fileName: 'card.jpg' } },
    )
    expect(problems).toEqual([])
    expect(Object.fromEntries(changes.map((change) => [change.path, change.value]))).toEqual({
      displayName: 'Juniper',
      'seo.title': 'Juniper Clay',
      'seo.description': 'Classes.',
      'seo.entity.name': 'Juniper Clay Studio',
      'seo.entity.description': 'A pottery studio.',
      'business.supportEmail': 'a@b.co',
      'business.address': '1 Main St',
      timeZone: 'America/Chicago',
      'consent.mode': 'geo',
      'seo.image': 'media:host-1/m-1',
      'seo.imageWidth': 1200,
      'seo.imageHeight': 630,
      'seo.imageAlt': 'Studio',
    })
  })

  it('keeps a social image alt someone wrote, as the card does', () => {
    const { changes } = aiSettingsChanges({ seo: { imageAlt: 'Our kiln' } }, {}, { socialImage: { src: 's', width: null, height: null, alt: 'Studio', fileName: 'c' } })
    expect(changes.find((change) => change.path === 'seo.imageAlt')?.value).toBe('Our kiln')
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

describe('the settings write (AGL-3748)', () => {
  it('writes only what differs, with a site-wide outbox entry, and nothing the second time', async () => {
    const { firestore, state } = transactionalFirestore({ memberRoles: { 'uid-1': 'author' }, displayName: 'Old', seo: { title: 'Same' } })
    const written = await writeAiSiteSettings(firestore, { hostId: 'host-1', uid: 'uid-1', request: { name: 'Juniper', seoTitle: 'Same' }, media: {}, now: NOW })
    expect(written).toEqual({ ok: true, done: ['The site is now called “Juniper”.', 'The search title is now “Same”.'], notDone: [], changed: ['displayName'], outboxId: 'outbox-1' })
    expect(state.updates).toEqual([{ updatedAt: NOW, displayName: 'Juniper' }])
    expect(state.outbox).toEqual([expect.objectContaining({ hostId: 'host-1', entireHost: true, attempts: 0 })])

    const again = transactionalFirestore({ memberRoles: { 'uid-1': 'author' }, displayName: 'Juniper', seo: { title: 'Same' } })
    expect(await writeAiSiteSettings(again.firestore, { hostId: 'host-1', uid: 'uid-1', request: { name: 'Juniper', seoTitle: 'Same' }, media: {}, now: NOW })).toEqual(
      expect.objectContaining({ ok: true, changed: [], outboxId: null }),
    )
    expect(again.state.updates).toEqual([])
    expect(again.state.outbox).toEqual([])
  })

  it('refuses a member who lost the write role by the time it writes', async () => {
    const { firestore, state } = transactionalFirestore({ memberRoles: { 'uid-1': 'viewer' } })
    expect(await writeAiSiteSettings(firestore, { hostId: 'host-1', uid: 'uid-1', request: { name: 'X' }, media: {}, now: NOW })).toEqual({ ok: false, error: AI_SETTINGS_ROLE_COPY })
    expect(state.updates).toEqual([])
  })

  it('writes the language as the Languages card does, and names a language it may not add', async () => {
    const { firestore, state } = transactionalFirestore({ memberRoles: { 'uid-1': 'editor' }, locales: ['en', 'de'] })
    const written = await writeAiSiteSettings(firestore, { hostId: 'host-1', uid: 'uid-1', request: { language: 'es', name: 'Kept' }, media: {}, now: NOW })
    expect(written).toEqual(expect.objectContaining({ ok: true, changed: ['displayName'], notDone: [expect.stringContaining('add es in Settings')] }))
    expect(state.updates[0]).not.toHaveProperty('locales')
  })
})

describe('the settings step (AGL-3748)', () => {
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
      $id: 'job-settings-1',
      orgId: 'org-1',
      hostId: 'host-1',
      kind: 'settings',
      status: 'running',
      brief: 'Rename my site to Juniper Clay Studio.',
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
  const write = jest.fn(async (..._args: unknown[]) => ({ ok: true as const, done: ['The site is now called “Juniper Clay Studio”.'], notDone: [], changed: ['displayName'], outboxId: 'outbox-1' }))
  const dropCache = jest.fn(async () => ({ dropped: 1, skipped: 0, complete: true }))
  const syncMemberships = jest.fn(async () => undefined)
  const readMedia = jest.fn(async () => [image()])
  const run = (inputs: Record<string, unknown>, lockdown = lockdownOpen) =>
    createAiJobSettingsStep({ write: write as never, lockdown: lockdown as never, dropCache: dropCache as never, syncMemberships, readMedia })({
      job: job(inputs),
      stepIndex: 0,
      now: NOW,
      firestore,
      org: FREE as never,
    })

  beforeEach(() => {
    hosts.clear()
    hosts.set('host-1', { orgId: 'org-1', subdomain: 'juniper', memberRoles: { 'uid-1': 'editor', 'uid-2': 'viewer' } })
    for (const mock of [write, dropCache, syncMemberships, readMedia, lockdownOpen]) mock.mockClear()
  })

  it('saves live at no cost, drops the site’s cache, resyncs a renamed site, and says what it did', async () => {
    const outcome = await run({ name: 'Juniper Clay Studio', logo: 'logo.png' })
    expect(outcome.failure).toBeUndefined()
    expect(outcome.usage).toEqual(AI_JOB_ZERO_USAGE)
    expect(outcome.estCostUsd).toBe(0)
    expect(write).toHaveBeenCalledWith(firestore, {
      hostId: 'host-1',
      uid: 'uid-1',
      request: { name: 'Juniper Clay Studio', logo: 'logo.png' },
      media: { logo: expect.objectContaining({ src: 'https://example.com/logo.png' }) },
      now: NOW,
    })
    expect(readMedia).toHaveBeenCalledWith(firestore, { hostId: 'host-1', orgId: 'org-1', source: 'logo.png' })
    expect(dropCache).toHaveBeenCalledWith(expect.objectContaining({ hostIds: ['host-1'] }))
    expect(syncMemberships).toHaveBeenCalledWith('org-1', 'host-1')
    expect(outcome.outputs).toEqual([
      expect.objectContaining({ resource: 'settings', id: 'site', hostId: 'host-1', hostSubdomain: 'juniper', label: 'Site settings' }),
    ])
    expect(outcome.outputs[0].note).toContain('Live now, in the site’s Settings.')
    expect(lockdownOpen).toHaveBeenCalledWith(expect.objectContaining({ staff: false, uid: 'uid-1', intent: 'write' }))
  })

  it('says a language change does not translate, and fails in words when nothing could be done', async () => {
    write.mockResolvedValueOnce({ ok: true, done: ['The site’s language is now es.'], notDone: [], changed: ['locales', 'defaultLocale'], outboxId: 'o' })
    expect((await run({ language: 'es' })).outputs[0].note).toContain('does not translate them')
    expect(syncMemberships).not.toHaveBeenCalled()
    expect((await run({ subdomain: 'taken', billing: 'free' })).failure).toBe(AI_SETTINGS_NOTHING_COPY)
  })

  it('refuses a member who may not edit the site and a frozen site, writing nothing', async () => {
    hosts.set('host-1', { orgId: 'org-1', memberRoles: { 'uid-1': 'viewer' } })
    expect((await run({ name: 'X' })).review).toEqual(expect.objectContaining({ reason: 'limit', message: AI_SETTINGS_ROLE_COPY }))
    hosts.set('host-1', { orgId: 'org-1', memberRoles: { 'uid-1': 'editor' } })
    expect((await run({ name: 'X' }, jest.fn(async () => ({ scope: 'host' })) as never)).review?.message).toBe(AI_SETTINGS_LOCKED_COPY)
    expect(write).not.toHaveBeenCalled()
  })

  const admission = createAiSettingsJobAdmission({ ownerOf: async (hostId) => (hostId === 'host-1' ? 'org-1' : 'org-2'), lockdown: lockdownOpen as never })
  const ask = (overrides: Record<string, unknown> = {}) =>
    admission({ firestore, orgId: 'org-1', hostId: 'host-1', inputs: { seoDescription: 'Classes.' }, org: FREE, uid: 'uid-1', ...overrides })

  it('admits an editor naming a setting, and refuses everything else in words', async () => {
    expect(await ask()).toBeNull()
    expect(await ask({ hostId: 'host-2' })).toEqual({ status: 404, error: 'Unknown site' })
    expect(await ask({ hostId: null })).toEqual(expect.objectContaining({ status: 400 }))
    expect(await ask({ uid: 'uid-2' })).toEqual({ status: 403, error: AI_SETTINGS_ROLE_COPY })
    expect(await ask({ inputs: { cname: 'example.com' } })).toEqual({ status: 400, error: AI_SETTINGS_NOTHING_COPY })
  })

  it('registers its step, with the least time it needs, and its door', () => {
    registerAiSettingsJob()
    expect(registerAiJobStep).toHaveBeenCalledWith('settings', expect.any(Function), { minimumMs: AI_JOB_SETTINGS_STEP_MINIMUM_MS })
    expect(aiJobAdmissionFor('settings')).toBeTruthy()
  })
})

describe('the settings operation a build plans (AGL-3748)', () => {
  const capability = AI_OWNED_CAPABILITIES.find((one) => one.op === 'settings')

  it('is one item per plan, Free included, at no cost, and offers no field outside the console’s settings', () => {
    expect(capability).toMatchObject({ runnerKind: 'settings', maxPerPlan: 1, freeAllowed: true, degrade: 'omit', live: true, where: 'the site’s Settings' })
    expect(capability?.feature).toBeUndefined()
    expect(capability?.estimateCredits({ name: 'X' })).toBe(0)
    const schema = capability?.argsSchema as NonNullable<typeof capability>['argsSchema']
    expect(Object.keys(schema.properties).sort()).toEqual(
      ['address', 'businessDescription', 'businessName', 'consentMode', 'favicon', 'language', 'logo', 'name', 'separator', 'seoDescription', 'seoTitle', 'socialImage', 'supportEmail', 'telephone', 'timeZone', 'titlePattern'].sort(),
    )
    for (const never of ['subdomain', 'cname', 'domain', 'memberRoles', 'billing', 'plan', 'enabledPlugins', 'discourageSearchEngines', 'gaMeasurementId', 'verification', 'maintenance']) {
      expect([never, never in schema.properties]).toEqual([never, false])
    }
    expect(pluginAiCapabilityArgsProblems(schema, { name: 'Juniper Clay Studio', language: 'es' })).toEqual([])
    expect(pluginAiCapabilityArgsProblems(schema, { consentMode: 'off' })).not.toEqual([])
    expect(pluginAiCapabilityArgsProblems(schema, { subdomain: 'x' })).not.toEqual([])
  })

  it('is listed to the planner as an item operation, saved live', () => {
    const lines = aiBuildOpLines(new Map([['settings', capability as NonNullable<typeof capability>]]), [])
    const line = lines.find((one) => one.startsWith('- settings:')) as string
    expect(line).toContain('saved to the live site when the plan is confirmed')
    expect(line).toContain('language: string (optional)')
  })
})
