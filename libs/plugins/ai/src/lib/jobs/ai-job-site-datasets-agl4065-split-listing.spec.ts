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
 * TWO LISTS OF ONE DATASET ON ONE PAGE NEVER SHOW THE SAME ROWS (AGL-4065).
 * The 2026-10-25 Rut Runners Racing plan listed "Race events" twice on its
 * Schedule page, "Upcoming races" and "Past results", and both repeated the
 * dataset's first five records. Its Status field (Upcoming or Past) was
 * never turned into a filter.
 *
 * Replayed offline: the recorded plan, the dataset unit with a fake writer
 * and a recorded-shape generation, and the listings the pages are handed.
 */

jest.mock('../providers/routing', () => ({
  __esModule: true,
  ...jest.requireActual('../providers/routing'),
  aiModelForStep: () => 'test-model',
}))

import type { PluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import type { AiBuildPlan } from '../model/ai-build-plan'
import type { AiJob, AiJobOutput, AiJobPlan } from '../model/ai-jobs.types'
import { aiLayoutRepeatFilterOf } from '../layout-language/ai-layout-listings'
import { aiDatasetPrompt, type generateAiDataset } from '../runtime/ai-dataset-generation'
import * as SiteDatasets from './ai-job-site-datasets'
import type { AiJobStepContext } from './ai-job-text-step'
import {
  RACE_EVENTS_EMPTY_ANSWER,
  RACE_EVENTS_MIXED_ANSWER,
  RACE_EVENTS_SAMPLE_ANSWER,
  RUT_RUNNERS_BRIEF,
  RUT_RUNNERS_RACE_EVENTS,
  RUT_RUNNERS_RIDERS,
  RUT_RUNNERS_SCREENS,
} from './fixtures/ai-site-agl4065-datasets'

const { AI_SITE_DATASET_INPUT, aiSiteDatasetInputOf, aiSiteDatasetListings, createAiSiteDatasetRunner } = SiteDatasets

const NOW = new Date('2026-10-25T06:04:00.000Z')

const idOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_')

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
  collection: () => ({ doc: () => ({ get: async () => ({ get: () => undefined }) }) }),
} as unknown as FirebaseFirestore.Firestore

const SPEND = {
  attempts: 1,
  usage: { inputTokens: 900, outputTokens: 700, cacheReadTokens: 0, cacheWriteTokens: 0 },
  estCostUsd: 0.01,
  model: 'test-model',
  stopReason: 'tool_use',
  effort: null,
}

/** An answer of the tool, as its check hands it on: fields typed, a record's values in field order. */
const designed = (raw: { fields: Array<{ name: string; type: string }>; records: Array<{ values: string[]; sample?: boolean }> }) => ({
  fields: raw.fields.map((field) => ({ name: field.name, type: field.type as 'text' })),
  records: raw.records.map((record) => record.values),
  ...(raw.records.some((record) => record.sample) ? { samples: raw.records.map((record) => record.sample === true) } : {}),
})

function unitJob(creation = RUT_RUNNERS_RACE_EVENTS, screens = RUT_RUNNERS_SCREENS): AiJob {
  return {
    $id: creation.id as string,
    orgId: 'org-test',
    hostId: 'host-test',
    kind: 'text',
    status: 'running',
    brief: RUT_RUNNERS_BRIEF,
    inputs: { [AI_SITE_DATASET_INPUT]: aiSiteDatasetInputOf(creation, screens) },
    steps: [],
    outputs: [],
    creditsReserved: 0,
    creditsSpent: 0,
    createdBy: 'uid-test',
    createdAt: NOW as never,
    updatedAt: NOW as never,
    expiresAt: NOW as never,
    plan: { reuse: [], create: [creation], screens: [], status: 'confirmed', labels: {}, language: 'en' } as unknown as AiJobPlan,
  }
}

/** The dataset unit's output for an answer, and what it asked the generation. */
async function built(raw: Parameters<typeof designed>[0]) {
  const generate = jest.fn(async () => ({ ...SPEND, status: 'ok' as const, value: designed(raw) })) as unknown as typeof generateAiDataset
  const { writerFor, writes } = fakeWriter()
  const runner = createAiSiteDatasetRunner({ generate, writerFor, photos: async ({ names }) => names.map(() => ({ src: null, placed: null })) })
  const context: AiJobStepContext = { job: unitJob(), stepIndex: 1, now: NOW, firestore, org: { plan: 'pro' } as never }
  const outcome = await runner(context)
  return { outcome, writes, asked: (generate as unknown as jest.Mock).mock.calls[0]?.[0] as Parameters<typeof generateAiDataset>[0] }
}

/** The Race events listing the pages are handed once the unit delivered `output`. */
function listingOf(output: AiJobOutput, screens = RUT_RUNNERS_SCREENS) {
  const listings = aiSiteDatasetListings({
    outputs: [output],
    datasets: [RUT_RUNNERS_RIDERS, RUT_RUNNERS_RACE_EVENTS],
    screens,
    delivered: new Map([[RUT_RUNNERS_RACE_EVENTS.name.toLowerCase(), output.id]]),
  })
  const listing = listings.find((entry) => entry.datasetId === output.id)
  if (!listing) throw new Error('the Race events listing is missing')
  return listing
}

describe('"Upcoming races" and "Past results" over one "Race events" (AGL-4065)', () => {
  it('tells the dataset which Status each section lists', async () => {
    const { asked } = await built(RACE_EVENTS_MIXED_ANSWER)
    expect(aiDatasetPrompt(asked)).toContain(
      'Sections “Upcoming races” and “Past results” list this dataset: its “Status” field takes exactly “Upcoming” or “Past”.',
    )
  })

  it('gives each section the records of its own Status, and the home its next few unfiltered', async () => {
    const { outcome } = await built(RACE_EVENTS_MIXED_ANSWER)
    const listing = listingOf(outcome.outputs[0] as AiJobOutput)
    const at = (screenId: string, section: number) => listing.placements.find((placement) => placement.screenId === screenId && placement.section === section)
    expect(at('fxSchedule', 1)?.filter).toEqual({ field: 'status', value: 'Upcoming', records: ['Spring opener', 'Summer night series'] })
    expect(at('fxSchedule', 2)?.filter).toEqual({ field: 'status', value: 'Past', records: ['Fall finale'] })
    expect(aiLayoutRepeatFilterOf(at('fxSchedule', 1)?.filter as { field: string; value: string })).toBe('status == Upcoming')
    // The home lists the dataset once: the next few, as it always did.
    expect(at('fxHome', 4)?.filter).toBeUndefined()
  })

  it('holds the Status the model wrote to the values the sections list, whatever its case', async () => {
    const lower = {
      ...RACE_EVENTS_MIXED_ANSWER,
      records: RACE_EVENTS_MIXED_ANSWER.records.slice(0, 3).map((record) => ({ values: [...record.values.slice(0, 6), (record.values[6] as string).toLowerCase()] })),
    }
    const { outcome } = await built(lower)
    const listing = listingOf(outcome.outputs[0] as AiJobOutput)
    expect(listing.placements.find((placement) => placement.screenId === 'fxSchedule' && placement.section === 2)?.filter).toEqual({
      field: 'status',
      value: 'Past',
      records: ['Fall finale'],
    })
  })

  it('gives the upcoming list sample rows dated ahead and the past list sample rows dated behind, never the same rows twice', async () => {
    const { outcome, writes } = await built(RACE_EVENTS_SAMPLE_ANSWER)
    const listing = listingOf(outcome.outputs[0] as AiJobOutput)
    const at = (section: number) => listing.placements.find((placement) => placement.screenId === 'fxSchedule' && placement.section === section)?.filter
    expect(at(1)).toEqual({ field: 'status', value: 'Upcoming', records: ['Hill Country Series Round 1', 'Hill Country Series Round 2', 'Hill Country Series Round 3'] })
    expect(at(2)).toEqual({ field: 'status', value: 'Past', records: ['Fall Classic at Red Mesa', 'Season opener at Cedar Hollow'] })
    const records = (writes[0]?.content as { records: Array<Record<string, string>> }).records
    const when = (record: Record<string, string> | undefined) => new Date(`${record?.['Date']} 12:00 UTC`).getTime()
    const upcoming = records.filter((record) => record['Status'] === 'Upcoming').map(when)
    const past = records.filter((record) => record['Status'] === 'Past').map(when)
    expect(Math.min(...upcoming)).toBeGreaterThan(NOW.getTime())
    expect(Math.max(...past)).toBeLessThan(NOW.getTime())
  })

  it('filters both sections of an empty list, so the owner’s first rows land in the right one', async () => {
    const { outcome } = await built(RACE_EVENTS_EMPTY_ANSWER)
    const listing = listingOf(outcome.outputs[0] as AiJobOutput)
    const filters = listing.placements.filter((placement) => placement.screenId === 'fxSchedule').map((placement) => placement.filter)
    expect(filters).toEqual([
      { field: 'status', value: 'Upcoming', records: [] },
      { field: 'status', value: 'Past', records: [] },
    ])
  })

  it('folds the two sections into one where the dataset has no field to tell them apart', () => {
    const fold = (SiteDatasets as Record<string, unknown>)['aiSettlePlanSplitListings'] as (plan: AiBuildPlan) => AiBuildPlan
    expect(typeof fold).toBe('function')
    const plan: AiBuildPlan = {
      reuse: [],
      create: [{ ...RUT_RUNNERS_RACE_EVENTS, fields: ['Event', 'Date', 'Track', 'Location', 'Class', 'Result'] }],
      screens: RUT_RUNNERS_SCREENS,
    }
    const settled = fold(plan)
    const schedule = settled.screens.find((screen) => screen.id === 'fxSchedule')
    expect(schedule?.sections.map((section) => section.name)).toEqual(['Page intro', 'Upcoming races and past results', 'Race day for families: what to expect'])
    expect(schedule?.sections[1]).toEqual({ name: 'Upcoming races and past results', uses: ['new:Race events'], items: 5 })
    // Every other page is as planned; and a plan whose dataset has a Status keeps both sections.
    expect(settled.screens.filter((screen) => screen.id !== 'fxSchedule')).toEqual(RUT_RUNNERS_SCREENS.filter((screen) => screen.id !== 'fxSchedule'))
    expect(fold({ ...plan, create: [RUT_RUNNERS_RACE_EVENTS] })).toEqual({ ...plan, create: [RUT_RUNNERS_RACE_EVENTS] })
  })
})
