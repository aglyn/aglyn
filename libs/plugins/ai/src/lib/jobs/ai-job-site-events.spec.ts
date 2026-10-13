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

import type { PluginAiCapability } from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import type { PluginDraftRequest, PluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import type { AiBuildItem, AiBuildPlan } from '../model/ai-build-plan'
import type { AiJob } from '../model/ai-jobs.types'
import {
  AI_SITE_EVENT_INPUT,
  AI_SITE_EVENTS_MAX,
  aiSiteEventItemsCheck,
  aiSiteEventLed,
  aiSiteEventListings,
  aiSiteEventPlanLines,
  aiSiteEventZone,
  aiSitePlanEvents,
  createAiSiteEventRunner,
  readAiSiteEventPlanning,
  type AiSiteEventPlanning,
} from './ai-job-site-events'

/**
 * An event-led guided start's first events (AGL-3755): planned only where the
 * events plugin's operation is admitted, held to its schema, written by its
 * writer, and listed where the plan names them. The writer and the registry
 * are doubles; nothing here calls a model.
 */

const NOW = new Date('2026-10-13T15:00:00.000Z')

/** The events-calendar plugin's capability, in the shape it registers (never imported). */
const EVENT: PluginAiCapability = {
  op: 'event',
  noun: 'event',
  where: 'Events',
  intents: ['dated events on the site’s events calendar'],
  argsSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'What the event is called.', maxLength: 150 },
      startsAt: { type: 'string', description: 'When it starts.', maxLength: 16 },
      timezone: { type: 'string', description: 'The IANA zone.', maxLength: 64 },
      description: { type: 'string', description: 'What happens.', maxLength: 2000 },
    },
    required: ['title', 'startsAt', 'timezone', 'description'],
    additionalProperties: false,
  },
  maxPerPlan: 6,
  freeAllowed: true,
  feature: 'eventCalendar',
  draftResource: 'event',
  live: true,
  estimateCredits: () => 0,
  degrade: 'omit',
  pageBlocks: ['eventList'],
  draftContent: (item) => ({ ...item.args }),
}

const OPS = new Map([['event', EVENT]])
const PLANNING: AiSiteEventPlanning = { ops: OPS, timeZone: 'America/Chicago' }

const item = (index: number, name: string, patch: Partial<AiBuildItem> = {}): AiBuildItem => ({
  slot: `i${index}`,
  op: 'event',
  name,
  why: 'the next nights',
  dependsOn: [],
  degrade: 'omit',
  args: { title: name, startsAt: '2026-10-23T19:00', timezone: 'America/Chicago', description: 'An evening of jazz.' },
  ...patch,
})

const screen = (uses: string[], slug = '/') => ({
  id: slug === '/' ? 'home' : 'events',
  title: slug === '/' ? 'Home' : 'Events',
  slug,
  layout: null,
  template: null,
  duplicateOf: null,
  nav: true,
  seoTitle: 'x',
  seoDescription: 'x',
  record: null,
  sections: [
    { name: 'hero', uses: [], items: 0 },
    { name: 'Coming up', uses, items: 0 },
  ],
})

const plan = (items: AiBuildItem[], uses = items.map((one) => `new:${one.name}`)): AiBuildPlan => ({
  reuse: [],
  create: [],
  screens: [screen(uses)],
  items,
})

function job(patch: Partial<AiJob> = {}): AiJob {
  return {
    $id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'site',
    status: 'running',
    brief: 'A website for a jazz club with live music five nights a week.',
    inputs: { businessType: 'jazz club' },
    createdBy: 'uid-1',
    ...patch,
  } as AiJob
}

const firestoreWith = (host: Record<string, unknown> | null) =>
  ({
    collection: () => ({ doc: () => ({ get: async () => ({ data: () => host }) }) }),
  }) as unknown as FirebaseFirestore.Firestore

describe('which starts plan events', () => {
  it('reads a venue, a club, a church, a theater or a studio’s classes as event-led, and an accountant not', () => {
    for (const about of ['jazz club', 'a music venue', 'a church in Tulsa', 'a neighborhood theatre', 'a theater company', 'a pottery studio with weekly classes', 'a monthly founders meetup', 'a civic center']) {
      expect(aiSiteEventLed({ brief: 'A website.', inputs: { businessType: about } })).toBe(true)
    }
    expect(aiSiteEventLed({ brief: 'A website for my accounting firm.', inputs: { businessType: 'accountant' } })).toBe(false)
  })

  it('offers the event operation alone, with the site’s own time zone, where the gate and the writer admit it', async () => {
    const planning = await readAiSiteEventPlanning(
      { job: job(), org: null, firestore: firestoreWith({ timeZone: 'America/Chicago' }), now: NOW, readOps: async () => new Map([...OPS, ['booking-service', { ...EVENT, op: 'booking-service' }]]) },
      { refusal: async () => null },
    )
    expect(planning).toEqual({ ops: OPS, timeZone: 'America/Chicago' })
  })

  it('plans none where the plan or add-on has no events, the member is refused, the brief is not event-led, or the job is not a start', async () => {
    const input = { org: null, firestore: firestoreWith(null), now: NOW }
    // No `eventCalendar` add-on, or the plugin off: the build's gate leaves the operation out.
    expect(await readAiSiteEventPlanning({ ...input, job: job(), readOps: async () => new Map() }, { refusal: async () => null })).toBeNull()
    expect(
      await readAiSiteEventPlanning({ ...input, job: job(), readOps: async () => OPS }, { refusal: async () => 'Editing requires the editor role' }),
    ).toBeNull()
    const readOps = jest.fn(async () => OPS)
    expect(await readAiSiteEventPlanning({ ...input, job: job({ brief: 'A website.', inputs: { businessType: 'accountant' } }), readOps })).toBeNull()
    expect(await readAiSiteEventPlanning({ ...input, job: job({ kind: 'build' }), readOps })).toBeNull()
    expect(readOps).not.toHaveBeenCalled()
    // A read that fails plans none; the start goes on.
    expect(
      await readAiSiteEventPlanning({ ...input, job: job(), readOps: async () => { throw new Error('down') } }, { refusal: async () => null }),
    ).toBeNull()
  })

  it('takes the site’s zone, else the workspace’s, else none', () => {
    expect(aiSiteEventZone({ timeZone: 'Europe/London' }, { timeZone: 'America/Denver' })).toBe('America/Denver')
    expect(aiSiteEventZone({ timeZone: 'Europe/London' }, {})).toBe('Europe/London')
    expect(aiSiteEventZone(null, null)).toBeNull()
    expect(aiSiteEventZone(null, { timeZone: 'Not/AZone' })).toBeNull()
  })
})

describe('what the plan is told and held to', () => {
  it('tells it how many, the zone, never to contradict the brief’s dates, where they go, and today', () => {
    const lines = aiSiteEventPlanLines(PLANNING, NOW).join('\n')
    expect(lines).toContain(`plan its first ${AI_SITE_EVENTS_MAX} upcoming events in items, each with op event`)
    expect(lines).toContain('A day, date or time the brief gives is kept exactly as given; never date an event against it.')
    expect(lines).toContain('every event\'s timezone is America/Chicago')
    expect(lines).toContain('That section is one of the sections the plan already has, never an extra one.')
    expect(lines).toContain('Today is 2026-10-13 (UTC).')
    expect(lines).toContain('startsAt: string — When it starts.')
    expect(aiSiteEventPlanLines({ ...PLANNING, timeZone: null }, NOW).join('\n')).toContain("the IANA zone of the business's city")
  })

  it('admits events named in a section, and refuses anything else with a sentence the re-ask names', () => {
    const check = aiSiteEventItemsCheck(PLANNING)
    expect(check(plan([item(0, 'Friday jazz night'), item(1, 'Open mic')]))).toEqual([])
    expect(check(plan([]))).toEqual([])
    const message = (one: AiBuildPlan, planning: AiSiteEventPlanning | null = PLANNING) => aiSiteEventItemsCheck(planning)(one)[0]?.message
    expect(message(plan([item(0, 'A', { op: 'booking-service' })]))).toContain('only event items')
    expect(message(plan([0, 1, 2, 3].map((index) => item(index, `Night ${index}`))))).toBe('Plan at most 3 events, not 4.')
    expect(message(plan([item(0, 'A', { args: { title: 'A' } })]))).toContain('"startsAt" is required')
    expect(message(plan([item(0, 'A', { dependsOn: ['new:B'] })]))).toContain('depends on nothing')
    expect(message(plan([item(0, 'Friday jazz night')], []))).toContain('put new:Friday jazz night in the uses')
    // A start that may plan none is refused any.
    expect(message(plan([item(0, 'A')]), null)).toBe('This site plan makes no items: leave items empty.')
  })

  it('builds only a start’s first few events, and only events', () => {
    const many = plan([...[0, 1, 2, 3].map((index) => item(index, `Night ${index}`)), item(4, 'A service', { op: 'booking-service' })])
    expect(aiSitePlanEvents(many).map((one) => one.name)).toEqual(['Night 0', 'Night 1', 'Night 2'])
  })
})

describe('the events listed on the pages', () => {
  const written = { resource: 'draft' as const, draftResource: 'event', id: 'ev-0', hostId: 'host-1', label: 'Friday jazz night' }

  it('lists the events written, in every section naming one, featured on the home and in full elsewhere', () => {
    const items = [item(0, 'Friday jazz night'), item(1, 'Open mic')]
    const listings = aiSiteEventListings({
      outputs: [written, { ...written, draftResource: 'dataset', id: 'ds', label: 'Menu' }],
      items,
      screens: [screen(['new:Open mic']), screen(['new:Friday jazz night', 'new:Open mic'], '/events')],
    })
    expect(listings).toEqual([
      {
        id: 'listing:events',
        kind: 'events',
        name: 'the events',
        records: ['Friday jazz night'],
        placements: [
          { screenId: 'home', section: 1, role: 'featured' },
          { screenId: 'events', section: 1, role: 'index' },
        ],
      },
    ])
  })

  it('lists none where nothing was written or no section names them', () => {
    const items = [item(0, 'Friday jazz night')]
    expect(aiSiteEventListings({ outputs: [], items, screens: [screen(['new:Friday jazz night'])] })).toEqual([])
    expect(aiSiteEventListings({ outputs: [written], items, screens: [screen([])] })).toEqual([])
  })
})

describe('an event’s pass', () => {
  function writer(answer: Partial<Awaited<ReturnType<PluginResourceDraftWriter['write']>>> = {}) {
    const requests: PluginDraftRequest[] = []
    const impl: PluginResourceDraftWriter = {
      refusal: async () => null,
      check: (content) => (content['startsAt'] ? { ok: true, facts: {} } : { ok: false, problems: ['The start is a date and time'] }),
      read: async () => null,
      write: async (request) => {
        requests.push(request)
        return {
          ok: true,
          replayed: false,
          id: request.id,
          name: request.name,
          versionId: null,
          facts: { status: 'published' },
          live: true,
          ...answer,
        } as never
      },
    }
    return { impl, requests }
  }

  const derived = (patch: Partial<AiJob> = {}) =>
    job({
      $id: 'drftEvent0',
      kind: 'text',
      inputs: { businessType: 'jazz club', originJobId: 'job-1', [AI_SITE_EVENT_INPUT]: item(0, 'Friday jazz night', { args: { ...item(0, 'x').args, timezone: 'Europe/Paris' } }) },
      ...patch,
    })
  const context = (handed: AiJob, host: Record<string, unknown> | null = { timeZone: 'America/Chicago' }) => ({
    job: handed,
    stepIndex: 1,
    now: NOW,
    firestore: firestoreWith(host),
    org: null,
  })

  it('writes the event through the owner’s writer in the site’s zone, for the start, and says it is live', async () => {
    const { impl, requests } = writer()
    const outcome = await createAiSiteEventRunner({ writerFor: () => impl, capability: () => EVENT })(context(derived()))
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      orgId: 'org-1',
      hostId: 'host-1',
      uid: 'uid-1',
      id: 'drftEvent0',
      name: 'Friday jazz night',
      act: { id: 'job-1', business: 'jazz club' },
      // The site's own zone over the plan's.
      content: expect.objectContaining({ timezone: 'America/Chicago', startsAt: '2026-10-23T19:00' }),
    })
    expect(outcome.estCostUsd).toBe(0)
    expect(outcome.outputs).toEqual([
      { resource: 'draft', id: 'drftEvent0', versionId: null, hostId: 'host-1', label: 'Friday jazz night', draftResource: 'event', note: 'Live now, in Events.' },
    ])
  })

  it('keeps the plan’s zone where the site names none, and says why an event stayed a draft', async () => {
    const { impl, requests } = writer({ live: false, notice: 'Kept as a draft: publishing takes the editor role.' } as never)
    const outcome = await createAiSiteEventRunner({ writerFor: () => impl, capability: () => EVENT })(context(derived(), null))
    expect(requests[0]?.content['timezone']).toBe('Europe/Paris')
    expect(outcome.outputs[0]?.note).toBe('A draft, in Events. Kept as a draft: publishing takes the editor role.')
  })

  it('fails the event with the owner’s sentence where its check or its writer refuses, and with one of its own where events are not here', async () => {
    const { impl } = writer({ ok: false, status: 403, error: 'Editing requires the editor role' } as never)
    const refused = await createAiSiteEventRunner({ writerFor: () => impl, capability: () => EVENT })(context(derived()))
    expect(refused.failure).toBe('Editing requires the editor role')
    const unchecked = await createAiSiteEventRunner({ writerFor: () => writer().impl, capability: () => ({ ...EVENT, draftContent: () => ({}) }) })(context(derived()))
    expect(unchecked.failure).toBe('The start is a date and time')
    const absent = await createAiSiteEventRunner({ writerFor: () => null, capability: () => EVENT })(context(derived()))
    expect(absent.failure).toBe('Events are not available on this site.')
  })
})
