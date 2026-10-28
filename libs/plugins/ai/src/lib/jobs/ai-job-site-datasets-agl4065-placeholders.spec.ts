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
 * NO PLACEHOLDER ROWS (AGL-4065). The 2026-10-25 Rut Runners Racing start's
 * "Race events" dataset came back as ten numbered placeholders, "Upcoming
 * race 1 (details to be added)" to "Past race 5 (details to be added)": the
 * dataset rules forbid inventing a date, and its first field may not be
 * empty, so the model numbered rows. Nothing checked the names, and both of
 * the schedule page's lists showed them.
 *
 * A list the brief gives no entries for now starts with SAMPLE rows that
 * look complete, each marked a sample in Data, a dated list's dates set by
 * the platform on a season's weekends (`AI_DATASET_LIST_WITHOUT_ENTRIES`).
 * A placeholder is still refused, re-asked once, and never written.
 *
 * Replayed offline through the real generation, its check and its one
 * re-ask, with a fake provider answering the recorded answers, and through
 * the dataset unit with a fake writer. No model is asked.
 */

jest.mock('../providers/routing', () => ({
  __esModule: true,
  ...jest.requireActual('../providers/routing'),
  aiModelForStep: () => 'test-model',
}))

import type { PluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import type { AiJob, AiJobPlan } from '../model/ai-jobs.types'
import type { AiCompletion, AiProvider, AiProviderRequest, AiResult } from '../providers/contract'
import { AI_DATASET_INSTRUCTIONS, generateAiDataset } from '../runtime/ai-dataset-generation'
import {
  AI_SITE_DATASET_INPUT,
  aiSiteDatasetBriefLines,
  aiSiteDatasetInputOf,
  createAiSiteDatasetRunner,
} from './ai-job-site-datasets'
import type { AiJobStepContext } from './ai-job-text-step'
import {
  ITEMS_ANSWER,
  LEVELS_ANSWER,
  RACE_EVENTS_MIXED_ANSWER,
  RACE_EVENTS_PLACEHOLDER_ANSWER,
  RACE_EVENTS_SAMPLE_ANSWER,
  RIDERS_ANSWER,
  RUT_RUNNERS_BRIEF,
  RUT_RUNNERS_RACE_EVENTS,
  RUT_RUNNERS_SCREENS,
} from './fixtures/ai-site-agl4065-datasets'

/** The re-ask under the decided rule (AGL-4065), word for word. */
const REASK =
  "Every record names a real thing the brief gives, or is a sample marked sample: a complete entry of its kind in the brief's own words. Never a placeholder such as 'Upcoming race 1 (details to be added)', 'TBD', 'coming soon' or 'Item 1'."

/** Any text a published row must never hold. */
const GAP = /details to be added|\bTBD\b|\bTBA\b|coming soon|\(details/i

/** The unit's note for a list the brief gave no rows for. */
const EMPTY_NOTE = 'No Race events rows yet: add them in Data › Race events, and every page that lists them follows.'

const NOW = new Date('2026-10-25T06:04:00.000Z')

function answer(input: object): AiCompletion {
  return {
    kind: 'completion',
    text: '',
    toolUse: [{ name: 'submit_dataset', input: input as Record<string, unknown> }],
    usage: { inputTokens: 900, outputTokens: 700, cacheReadTokens: 0, cacheWriteTokens: 0 },
    estCostUsd: 0.01,
    stopReason: 'tool_use',
  }
}

/** A provider that answers from a queue and keeps every request it was sent. */
function provider(answers: AiResult[]): { fake: AiProvider; requests: AiProviderRequest[] } {
  const requests: AiProviderRequest[] = []
  const fake: AiProvider = {
    id: 'fake',
    label: 'Fake',
    apiKeyEnv: 'FAKE_AI_KEY',
    endpointHost: 'ai.test',
    readApiKey: () => 'key',
    models: () => [],
    complete: async (request) => {
      requests.push(request)
      const next = answers.shift()
      if (!next) throw new Error('no answer armed')
      return next
    },
    stream: async () => {
      throw new Error('a dataset never streams')
    },
  }
  return { fake, requests }
}

/** Every user turn a request carried, as text. */
const turns = (request: AiProviderRequest) =>
  request.messages.map((message) => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content))).join('\n')

const generation = (fake: AiProvider) =>
  generateAiDataset({
    brief: RUT_RUNNERS_BRIEF,
    merchantWords: RUT_RUNNERS_BRIEF,
    name: RUT_RUNNERS_RACE_EVENTS.name,
    why: RUT_RUNNERS_RACE_EVENTS.why,
    fields: RUT_RUNNERS_RACE_EVENTS.fields,
    shownIn: aiSiteDatasetInputOf(RUT_RUNNERS_RACE_EVENTS, RUT_RUNNERS_SCREENS).shownIn,
    recordPages: false,
    model: 'test-model',
    provider: fake,
  })

const idOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_')

/** The data plugin's writer, faked: it keeps what it is asked to write and names each field by its id. */
function fakeWriter() {
  const writes: Array<Parameters<PluginResourceDraftWriter['write']>[0]> = []
  const writer: PluginResourceDraftWriter = {
    refusal: async () => null,
    check: () => ({ ok: true, facts: {} }),
    read: async () => null,
    write: async (request) => {
      writes.push(request)
      const content = request.content as { fields: Array<{ name: string; type: string }>; records: unknown[] }
      return {
        ok: true,
        replayed: false,
        id: request.id,
        name: request.name,
        versionId: null,
        facts: {
          fields: content.fields.map((field) => ({ id: idOf(field.name), name: field.name, type: field.type === 'image' ? 'image' : 'text' })),
          records: content.records.length,
          addressField: null,
          imageField: content.fields.some((field) => field.type === 'image') ? 'image' : null,
        },
      }
    },
  }
  return { writes, writerFor: () => ({ pluginId: 'data', writer }) }
}

const firestore = {
  collection: () => ({ doc: () => ({ get: async () => ({ get: (field: string) => (field === 'subdomain' ? 'rut-runners-racing' : undefined) }) }) }),
} as unknown as FirebaseFirestore.Firestore

function unitJob(): AiJob {
  return {
    $id: RUT_RUNNERS_RACE_EVENTS.id as string,
    orgId: 'org-test',
    hostId: 'host-test',
    kind: 'text',
    status: 'running',
    brief: RUT_RUNNERS_BRIEF,
    inputs: { [AI_SITE_DATASET_INPUT]: aiSiteDatasetInputOf(RUT_RUNNERS_RACE_EVENTS, RUT_RUNNERS_SCREENS) },
    steps: [],
    outputs: [],
    creditsReserved: 0,
    creditsSpent: 0,
    createdBy: 'uid-test',
    createdAt: NOW as never,
    updatedAt: NOW as never,
    expiresAt: NOW as never,
    plan: { reuse: [], create: [RUT_RUNNERS_RACE_EVENTS], screens: [], status: 'confirmed', labels: {}, language: 'en' } as unknown as AiJobPlan,
  }
}

const context = (job: AiJob): AiJobStepContext => ({ job, stepIndex: 1, now: NOW, firestore, org: { plan: 'pro' } as never })

/** The dataset unit with the real generation, answered by the fake provider, and record photos that find none. */
function unit(answers: AiResult[]) {
  const { fake, requests } = provider(answers)
  const { writes, writerFor } = fakeWriter()
  const runner = createAiSiteDatasetRunner({
    generate: (input) => generateAiDataset({ ...input, provider: fake }),
    writerFor,
    photos: async ({ names }) => names.map(() => ({ src: null, placed: null })),
  })
  return { run: () => runner(context(unitJob())), requests, writes }
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('a dataset answered with numbered placeholders (AGL-4065)', () => {
  it('is told that a list the brief gives no entries for starts with marked samples', () => {
    const rules = AI_DATASET_INSTRUCTIONS.map((block) => block.text).join('\n')
    expect(rules).toContain('Where the brief gives no entries for the list, write sample records the owner replaces, each marked sample')
    expect(rules).toContain('a sample still gives no price, phone number, email, address, real person’s name or brand')
  })

  it('is refused, and re-asked once for samples that look complete', async () => {
    const { fake, requests } = provider([answer(RACE_EVENTS_PLACEHOLDER_ANSWER), answer(RACE_EVENTS_SAMPLE_ANSWER)])
    const result = await generation(fake)
    expect(requests).toHaveLength(2)
    expect(turns(requests[1] as AiProviderRequest)).toContain(REASK)
    expect(result.status).toBe('ok')
    expect(result.status === 'ok' && result.value.records.map((values) => values[0])).toEqual(RACE_EVENTS_SAMPLE_ANSWER.records.map((record) => record.values[0]))
    expect(result.status === 'ok' && result.value.samples).toEqual([true, true, true, true, true])
  })

  it('refuses stand-ins numbered "Item 1", and a sample that names a make the brief does not', async () => {
    const items = provider([answer(ITEMS_ANSWER), answer(RACE_EVENTS_SAMPLE_ANSWER)])
    await generation(items.fake)
    expect(items.requests).toHaveLength(2)
    expect(turns(items.requests[1] as AiProviderRequest)).toContain(REASK)
    const branded = {
      ...RACE_EVENTS_SAMPLE_ANSWER,
      records: RACE_EVENTS_SAMPLE_ANSWER.records.map((record, index) =>
        index === 0 ? { ...record, values: ['Honda Cup Round 1', ...record.values.slice(1)] } : record,
      ),
    }
    const brands = provider([answer(branded), answer(RACE_EVENTS_SAMPLE_ANSWER)])
    await generation(brands.fake)
    expect(brands.requests).toHaveLength(2)
    expect(turns(brands.requests[1] as AiProviderRequest)).toContain('names the make "Honda"')
  })

  it('writes each sample marked, dated on a season of weekends, the upcoming ahead and the past behind', async () => {
    const { run, writes } = unit([answer(RACE_EVENTS_SAMPLE_ANSWER)])
    const outcome = await run()
    const content = writes[0]?.content as { records: Array<Record<string, string>>; samples?: boolean[] }
    expect(content.samples).toEqual([true, true, true, true, true])
    const dates = content.records.map((record) => new Date(`${record['Date']} 12:00 UTC`))
    for (const [index, date] of dates.entries()) {
      expect(Number.isNaN(date.getTime())).toBe(false)
      // A Saturday.
      expect(date.getUTCDay()).toBe(6)
      // The three to come fall after the job's day, the two past before it.
      expect(index < 3 ? date.getTime() > NOW.getTime() : date.getTime() < NOW.getTime()).toBe(true)
    }
    // Spread across a season, the upcoming in order, the past latest first.
    expect((dates[1] as Date).getTime()).toBeGreaterThan((dates[0] as Date).getTime())
    expect((dates[4] as Date).getTime()).toBeLessThan((dates[3] as Date).getTime())
    expect(content.records[0]?.['Date']).toBe('Sat, Nov 14, 2026')
    // A race still to come has no result.
    expect(content.records[2]).not.toHaveProperty('Result')
    expect(content.records[3]?.['Result']).toBe('Two riders on the podium')
    // Nothing anywhere marks a gap.
    expect(JSON.stringify(content.records)).not.toMatch(GAP)
    expect(outcome.outputs[0]?.note).toBe(
      '5 sample records to start, made because the brief gave none: replace them with your own in Data, and every page that lists them follows.',
    )
  })

  it('answered with placeholders twice is written with its fields and no records, and says where to add them', async () => {
    const { run, requests, writes } = unit([answer(RACE_EVENTS_PLACEHOLDER_ANSWER), answer(RACE_EVENTS_PLACEHOLDER_ANSWER)])
    const outcome = await run()
    expect(requests).toHaveLength(2)
    expect(writes).toHaveLength(1)
    const content = writes[0]?.content as { fields: Array<{ name: string }>; records: unknown[] }
    expect(content.records).toEqual([])
    expect(content.fields.map((field) => field.name)).toEqual(expect.arrayContaining(RUT_RUNNERS_RACE_EVENTS.fields))
    expect(outcome.failure).toBeUndefined()
    expect(outcome.outputs).toHaveLength(1)
    expect(outcome.outputs[0]?.note).toBe(EMPTY_NOTE)
    expect((outcome.outputs[0]?.proposal as { recordNames: string[] }).recordNames).toEqual([])
    // The pages are told the list is empty, so no page names a row (AGL-4065, Q2).
    const lines = aiSiteDatasetBriefLines(outcome.outputs)
    expect(lines.join('\n')).toContain('“Race events” has no records yet')
    expect(lines.join('\n')).not.toContain('details to be added')
  })

  it('keeps the records of a mixed answer that name real things, and drops the placeholders', async () => {
    const { run, writes } = unit([answer(RACE_EVENTS_MIXED_ANSWER), answer(RACE_EVENTS_MIXED_ANSWER)])
    const outcome = await run()
    const content = writes[0]?.content as { records: Array<Record<string, string>> }
    expect(content.records.map((record) => record['Event'])).toEqual(['Spring opener', 'Summer night series', 'Fall finale'])
    expect((outcome.outputs[0]?.proposal as { recordNames: string[] }).recordNames).toEqual(['Spring opener', 'Summer night series', 'Fall finale'])
    expect(outcome.outputs[0]?.note).toBe('3 records to start, in Data. Edit them there and every page that lists them follows.')
  })

  it('leaves a list of real rows alone, numbered ones too, on its first answer', async () => {
    for (const real of [RIDERS_ANSWER, LEVELS_ANSWER]) {
      const fields = real.fields.map((field) => field.name)
      const { fake, requests } = provider([answer(real)])
      const result = await generateAiDataset({
        brief: RUT_RUNNERS_BRIEF,
        merchantWords: RUT_RUNNERS_BRIEF,
        name: fields[0] === 'Class' ? 'Classes' : 'Riders',
        why: 'the list the pages show',
        fields,
        shownIn: [],
        recordPages: false,
        model: 'test-model',
        provider: fake,
      })
      expect(requests).toHaveLength(1)
      expect(result.status).toBe('ok')
      expect(result.status === 'ok' && result.value.records.map((values) => values[0])).toEqual(real.records.map((record) => record.values[0]))
    }
  })
})
