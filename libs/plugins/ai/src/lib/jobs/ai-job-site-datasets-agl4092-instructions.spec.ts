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
 * NO INSTRUCTION TO THE OWNER (AGL-4092). The 2026-10-28 Rut Runners Racing
 * start wrote six sample riders whose every bio ended "Add this rider's story
 * here.", and six past races whose every result was "Add finishing position".
 * The placeholder check knew gap markers ("details to be added", "TBD") and
 * numbered stand-ins, never a sentence telling the owner what to write, so
 * both lists were written as answered and the home page showed the riders.
 *
 * A sample's words now read as finished copy about the sample. An answer
 * that tells the owner what to add is refused and re-asked once; a second
 * such answer is written with the instruction taken out, and a row nothing is
 * left of is dropped. A past sample keeps no instruction for a result.
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
import type { AiBuildPlanCreate } from '../model/ai-build-plan'
import type { AiJob, AiJobPlan } from '../model/ai-jobs.types'
import type { AiCompletion, AiProvider, AiProviderRequest, AiResult } from '../providers/contract'
import {
  AI_DATASET_INSTRUCTIONS,
  AI_DATASET_PLACEHOLDER_CODE,
  AI_DATASET_PLACEHOLDER_REASK,
  aiDatasetPlaceholderRecords,
  aiDatasetValueWithoutInstructions,
  generateAiDataset,
} from '../runtime/ai-dataset-generation'
import { AI_SITE_DATASET_INPUT, aiSiteDatasetInputOf, createAiSiteDatasetRunner } from './ai-job-site-datasets'
import type { AiJobStepContext } from './ai-job-text-step'
import {
  RACE_EVENTS_SAMPLE_ANSWER,
  RIDERS_ANSWER,
  RUT_RUNNERS_BRIEF,
  RUT_RUNNERS_RACE_EVENTS,
  RUT_RUNNERS_SCREENS,
} from './fixtures/ai-site-agl4065-datasets'
import {
  RACE_RESULTS_INSTRUCTION_ANSWER,
  RESULT_INSTRUCTION,
  RIDER_BIOS,
  RIDER_INSTRUCTION,
  RIDERS_FINISHED_ANSWER,
  RIDERS_INSTRUCTION_ANSWER,
  RIDERS_INSTRUCTION_ANSWER_AGAIN,
  RUT_1028_BRIEF,
  RUT_1028_RACE_RESULTS,
  RUT_1028_RIDERS,
  RUT_1028_SCREENS,
} from './fixtures/ai-site-agl4092-datasets'

/** The sentence the re-ask gained (AGL-4092), word for word. */
const NO_INSTRUCTION =
  "Never an instruction to the owner either, such as 'Add this rider's story here' or 'Add finishing position': a sample's words read as finished copy about the sample."

/** What the samples rule gained (AGL-4092), word for word. */
const FINISHED_COPY =
  "A sample’s words read as finished copy about it: never an instruction to the owner, such as \"Add this rider's story here\" or \"Add finishing position\", and never a note that it is a sample, which the console says."

/** Any words a published row must never hold. */
const INSTRUCTION = /\badd (?:this|finishing)\b|\bstory here\b/i

const NOW = new Date('2026-10-28T22:49:00.000Z')

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

const generation = (fake: AiProvider, dataset: AiBuildPlanCreate) =>
  generateAiDataset({
    brief: RUT_1028_BRIEF,
    merchantWords: RUT_1028_BRIEF,
    name: dataset.name,
    why: dataset.why,
    fields: dataset.fields,
    shownIn: aiSiteDatasetInputOf(dataset, RUT_1028_SCREENS).shownIn,
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
          imageField: null,
        },
      }
    },
  }
  return { writes, writerFor: () => ({ pluginId: 'data', writer }) }
}

const firestore = {
  collection: () => ({ doc: () => ({ get: async () => ({ get: (field: string) => (field === 'subdomain' ? 'rut-runners-racing' : undefined) }) }) }),
} as unknown as FirebaseFirestore.Firestore

function unitJob(dataset: AiBuildPlanCreate): AiJob {
  return {
    $id: dataset.id as string,
    orgId: 'org-test',
    hostId: 'host-test',
    kind: 'text',
    status: 'running',
    brief: RUT_1028_BRIEF,
    inputs: { [AI_SITE_DATASET_INPUT]: aiSiteDatasetInputOf(dataset, RUT_1028_SCREENS) },
    steps: [],
    outputs: [],
    creditsReserved: 0,
    creditsSpent: 0,
    createdBy: 'uid-test',
    createdAt: NOW as never,
    updatedAt: NOW as never,
    expiresAt: NOW as never,
    plan: { reuse: [], create: [dataset], screens: [], status: 'confirmed', labels: {}, language: 'en' } as unknown as AiJobPlan,
  }
}

/** The dataset unit with the real generation, answered by the fake provider, and record photos that find none. */
function unit(dataset: AiBuildPlanCreate, answers: AiResult[]) {
  const { fake, requests } = provider(answers)
  const { writes, writerFor } = fakeWriter()
  const runner = createAiSiteDatasetRunner({
    generate: (input) => generateAiDataset({ ...input, provider: fake }),
    writerFor,
    photos: async ({ names }) => names.map(() => ({ src: null, placed: null })),
  })
  const context: AiJobStepContext = { job: unitJob(dataset), stepIndex: 1, now: NOW, firestore, org: { plan: 'pro' } as never }
  return { run: () => runner(context), requests, writes }
}

const shape = (input: { fields: Array<{ name: string }>; records: Array<{ values: string[] }> }) => ({
  fields: input.fields,
  records: input.records.map((record) => record.values),
})

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('a sample that tells the owner what to add (AGL-4092)', () => {
  it('is told a sample reads as finished copy, and the re-ask names the instruction', () => {
    const rules = AI_DATASET_INSTRUCTIONS.map((block) => block.text).join('\n')
    expect(rules).toContain(FINISHED_COPY)
    expect(AI_DATASET_PLACEHOLDER_REASK).toContain(NO_INSTRUCTION)
  })

  it('reads every recorded rider and every past race as a placeholder, and no finished record', () => {
    expect(aiDatasetPlaceholderRecords(shape(RIDERS_INSTRUCTION_ANSWER), 'Riders')).toEqual([0, 1, 2, 3, 4, 5])
    expect(aiDatasetPlaceholderRecords(shape(RACE_RESULTS_INSTRUCTION_ANSWER), 'Race results')).toEqual([5, 6, 7, 8, 9, 10])
    expect(aiDatasetPlaceholderRecords(shape(RIDERS_FINISHED_ANSWER), 'Riders')).toEqual([])
    // What a visitor is told to do is not an instruction to the owner, nor is a menu's add-on.
    const visitor = {
      fields: [{ name: 'Question' }, { name: 'Answer' }],
      records: [
        ['How do young riders join?', 'Fill in the form on the Contact page and we will call you back.'],
        ['Can I add a sponsor logo to the trailer?', 'Yes: every sponsor at the gold level gets a spot on the team trailer.'],
        ['Extras', 'Add avocado'],
        ['What should I bring?', 'Bring your own helmet, boots and water. Enter at the main gate.'],
        ['How do I sign up?', 'Fill in the form here and a coach calls you back.'],
        ['When do riders race?', 'Riders enter the gate early and race later in the afternoon.'],
      ],
    }
    expect(aiDatasetPlaceholderRecords(visitor, 'Questions')).toEqual([])
    // An aside or a sentence's last turn is taken out alone, and the rest kept.
    expect(aiDatasetValueWithoutInstructions('Junior rider (add details later)')).toBe('Junior rider')
    expect(aiDatasetValueWithoutInstructions('Fast on the starts — add more about this rider here.')).toBe('Fast on the starts.')
    expect(aiDatasetValueWithoutInstructions(`A junior rider. ${RIDER_INSTRUCTION}`)).toBe('A junior rider.')
    expect(aiDatasetValueWithoutInstructions(RESULT_INSTRUCTION)).toBe('')
  })

  it('refuses the recorded Riders answer under placeholder-records, and re-asks once', async () => {
    const { fake, requests } = provider([answer(RIDERS_INSTRUCTION_ANSWER), answer(RIDERS_FINISHED_ANSWER)])
    const result = await generation(fake, RUT_1028_RIDERS)
    expect(requests).toHaveLength(2)
    expect(turns(requests[1] as AiProviderRequest)).toContain(AI_DATASET_PLACEHOLDER_REASK)
    expect(result.status).toBe('ok')
    expect(result.status === 'ok' && result.value.records.map((values) => values[4])).toEqual(
      RIDERS_FINISHED_ANSWER.records.map((record) => record.values[4]),
    )
  })

  it('refuses the recorded Race results answer under placeholder-records', async () => {
    const { fake } = provider([answer(RACE_RESULTS_INSTRUCTION_ANSWER), answer(RACE_RESULTS_INSTRUCTION_ANSWER)])
    const result = await generation(fake, RUT_1028_RACE_RESULTS)
    expect(result.status).toBe('needs_input')
    expect(result.status === 'needs_input' && result.violations.map((violation) => violation.code)).toContain(AI_DATASET_PLACEHOLDER_CODE)
  })

  it('writes a second such Riders answer with the instruction taken out, and drops the row nothing is left of', async () => {
    const { run, requests, writes } = unit(RUT_1028_RIDERS, [answer(RIDERS_INSTRUCTION_ANSWER), answer(RIDERS_INSTRUCTION_ANSWER_AGAIN)])
    const outcome = await run()
    expect(requests).toHaveLength(2)
    expect(outcome.failure).toBeUndefined()
    const content = writes[0]?.content as { records: Array<Record<string, string>>; samples?: boolean[] }
    expect(content.records).toHaveLength(6)
    expect(content.records.map((record) => record['Bio'])).toEqual(RIDER_BIOS)
    expect(content.samples).toEqual([true, true, true, true, true, true])
    expect(JSON.stringify(content.records)).not.toContain(RIDER_INSTRUCTION)
    expect(JSON.stringify(content.records)).not.toMatch(INSTRUCTION)
  })

  it('writes a second such Race results answer with every past result left blank, and every race kept', async () => {
    const { run, writes } = unit(RUT_1028_RACE_RESULTS, [answer(RACE_RESULTS_INSTRUCTION_ANSWER), answer(RACE_RESULTS_INSTRUCTION_ANSWER)])
    const outcome = await run()
    expect(outcome.failure).toBeUndefined()
    const content = writes[0]?.content as { records: Array<Record<string, string>> }
    expect(content.records).toHaveLength(11)
    const past = content.records.filter((record) => record['Status'] === 'Past')
    expect(past).toHaveLength(6)
    for (const record of past) expect(record).not.toHaveProperty('Result')
    expect(JSON.stringify(content.records)).not.toContain(RESULT_INSTRUCTION)
    // Each past race still falls before the job's day, each upcoming one after it.
    for (const record of content.records) {
      const at = new Date(`${record['Date']} 12:00 UTC`).getTime()
      expect(record['Status'] === 'Past' ? at < NOW.getTime() : at > NOW.getTime()).toBe(true)
    }
  })

  it('leaves the AGL-4065 samples as they were: finished rows pass on their first answer', async () => {
    for (const [real, dataset] of [
      [RACE_EVENTS_SAMPLE_ANSWER, RUT_RUNNERS_RACE_EVENTS],
      [RIDERS_ANSWER, { ...RUT_RUNNERS_RACE_EVENTS, name: 'Riders', fields: RIDERS_ANSWER.fields.map((field) => field.name) }],
    ] as const) {
      const { fake, requests } = provider([answer(real)])
      const result = await generateAiDataset({
        brief: RUT_RUNNERS_BRIEF,
        merchantWords: RUT_RUNNERS_BRIEF,
        name: dataset.name,
        why: dataset.why,
        fields: dataset.fields,
        shownIn: aiSiteDatasetInputOf(dataset, RUT_RUNNERS_SCREENS).shownIn,
        recordPages: false,
        model: 'test-model',
        provider: fake,
      })
      expect(requests).toHaveLength(1)
      expect(result.status).toBe('ok')
    }
  })
})
