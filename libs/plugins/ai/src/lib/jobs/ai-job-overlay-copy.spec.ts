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

const mockRunAiRequest = jest.fn()

jest.mock('../runtime/ai-runtime', () => ({
  __esModule: true,
  ...jest.requireActual('../runtime/ai-runtime'),
  runAiRequest: (...args: unknown[]) => mockRunAiRequest(...args),
}))

import type { AiJob } from '../model/ai-jobs.types'
import {
  AI_OVERLAY_COPY_CEILINGS,
  aiOverlayLimits,
  aiOverlayTriggerRanges,
  checkAiOverlayCopy,
  readAiOverlayCopy,
  type AiOverlayCopyAnswer,
} from '../model/ai-overlay-copy'
import { AI_OVERLAY_TOOL_NAME } from '../tools/ai-overlay-tool'
import {
  AI_OVERLAY_NO_COPY_COPY,
  AI_OVERLAY_NO_KIND_COPY,
  AI_OVERLAY_SYSTEM,
} from './ai-job-overlay-copy'
import { runAiJobTextStep } from './ai-job-text-step'

/**
 * Overlay copy (AGL-3603): the `text` step asked for a bar's or a popup's
 * copy as fields, against a stubbed provider.
 *
 * What it proves: the answer is held to the limits and the triggers the
 * request named and is a proposal on the job's output — never a write; a
 * trigger outside the catalog is dropped rather than invented; copy carrying
 * markup or a link is refused; and a text job that asks for nothing of the
 * kind is still answered as prose.
 */

const MODEL = 'claude-sonnet-5'
const usage = () => ({ inputTokens: 400, outputTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0 })
const called = (input: unknown) => ({
  kind: 'completion',
  text: '',
  toolUse: [{ name: AI_OVERLAY_TOOL_NAME, input }],
  usage: usage(),
  estCostUsd: 0.002,
  stopReason: 'tool_use',
})

const POPUP_INPUTS = {
  task: 'overlay',
  overlayKind: 'popup',
  triggers: 'delay:0-120,scroll:1-100,exit',
  limit_headline: '20',
}

function jobOf(inputs: Record<string, string>, brief = 'Invite visitors to book a free consultation'): AiJob {
  return {
    $id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'text',
    brief,
    inputs,
    createdBy: 'uid-1',
  } as unknown as AiJob
}

const run = (job: AiJob) =>
  runAiJobTextStep({
    job,
    stepIndex: 0,
    now: new Date('2026-10-06T12:00:00Z'),
    firestore: {} as FirebaseFirestore.Firestore,
    modelFor: () => MODEL,
  })

const answer = (overrides: Partial<AiOverlayCopyAnswer> = {}): AiOverlayCopyAnswer => ({
  name: 'Consultation popup',
  text: '',
  headline: 'Book a free call',
  body: 'Talk through your project with us.',
  ctaLabel: 'Book now',
  trigger: 'delay',
  triggerValue: 5,
  rationale: 'Leads with the free call.',
  ...overrides,
})

beforeEach(() => {
  mockRunAiRequest.mockReset()
})

describe('the overlay rules', () => {
  it('holds each field to the tighter of the caller’s limit and the step’s ceiling', () => {
    const limits = aiOverlayLimits({ limit_headline: '20', limit_body: '99999', limit_text: 'nope' })
    expect(limits.headline).toBe(20)
    expect(limits.body).toBe(AI_OVERLAY_COPY_CEILINGS.body)
    expect(limits.text).toBe(AI_OVERLAY_COPY_CEILINGS.text)
  })

  it('reads the trigger catalog the caller named, and drops an id the runtime does not know', () => {
    const triggers = aiOverlayTriggerRanges({ triggers: 'delay:0-120,hover:1-2,exit' })
    expect([...triggers.keys()]).toEqual(['delay', 'exit'])
    expect(triggers.get('delay')).toEqual({ min: 0, max: 120 })
    expect(triggers.get('exit')).toBeNull()
  })

  it('cuts a long field rather than refusing it, and says so', () => {
    const checked = checkAiOverlayCopy(
      answer({ headline: 'A headline that runs well past twenty characters' }),
      'popup',
      aiOverlayLimits({ limit_headline: '20' }),
      aiOverlayTriggerRanges({ triggers: 'delay:0-120' }),
    )
    expect(checked?.proposal.headline.length).toBeLessThanOrEqual(20)
    expect(checked?.findings).toEqual(['headline cut to 20 characters'])
  })

  it('keeps a trigger value inside its range', () => {
    const checked = checkAiOverlayCopy(
      answer({ trigger: 'scroll', triggerValue: 400 }),
      'popup',
      aiOverlayLimits({}),
      aiOverlayTriggerRanges({ triggers: 'scroll:1-100' }),
    )
    expect(checked?.proposal).toMatchObject({ trigger: 'scroll', triggerValue: 100 })
  })

  it('drops a trigger the caller did not offer, rather than inventing one', () => {
    const checked = checkAiOverlayCopy(
      answer({ trigger: 'exit' }),
      'popup',
      aiOverlayLimits({}),
      aiOverlayTriggerRanges({ triggers: 'delay:0-120' }),
    )
    expect(checked?.proposal.trigger).toBeNull()
    expect(checked?.findings[0]).toMatch(/exit/)
  })

  it('refuses copy carrying markup or a link, and a popup with no body', () => {
    const rules = [aiOverlayLimits({}), aiOverlayTriggerRanges({ triggers: 'delay:0-120' })] as const
    expect(checkAiOverlayCopy(answer({ body: 'See <b>this</b>' }), 'popup', ...rules)).toBeNull()
    expect(checkAiOverlayCopy(answer({ body: 'Visit https://example.com' }), 'popup', ...rules)).toBeNull()
    expect(checkAiOverlayCopy(answer({ body: '   ' }), 'popup', ...rules)).toBeNull()
    expect(checkAiOverlayCopy(answer({ text: '' }), 'bar', ...rules)).toBeNull()
  })

  it('keeps only the fields a bar has', () => {
    const checked = checkAiOverlayCopy(
      answer({ text: 'Free delivery this weekend' }),
      'bar',
      aiOverlayLimits({}),
      aiOverlayTriggerRanges({ triggers: 'delay:0-120' }),
    )
    expect(checked?.proposal).toMatchObject({ kind: 'bar', text: 'Free delivery this weekend', headline: '', body: '', trigger: null })
  })
})

describe('the text step asked for overlay copy', () => {
  it('answers through the strict tool, with the brief, the triggers and the current copy in the user turn', async () => {
    mockRunAiRequest.mockResolvedValue(called(answer()))
    const outcome = await run(jobOf({ ...POPUP_INPUTS, current: 'Book a call' }))

    const request = mockRunAiRequest.mock.calls[0][0]
    expect(request.system).toBe(AI_OVERLAY_SYSTEM)
    expect(request.tools[0].name).toBe(AI_OVERLAY_TOOL_NAME)
    expect(request.tools[0].inputSchema.properties.trigger.enum).toEqual(['delay', 'scroll', 'exit', 'none'])
    const turn = request.messages[0].content as string
    expect(turn).toContain('Invite visitors to book a free consultation')
    expect(turn).toContain('scroll (percent of the page scrolled, 1 to 100)')
    expect(turn).toContain('Book a call')

    expect(outcome.failure).toBeUndefined()
    expect(outcome.outputs).toHaveLength(1)
    const [output] = outcome.outputs
    expect(output.resource).toBe('text')
    expect(output.text).toContain('Book a free call')
    expect(readAiOverlayCopy(output.proposal)).toMatchObject({
      kind: 'popup',
      headline: 'Book a free call',
      body: 'Talk through your project with us.',
      ctaLabel: 'Book now',
      trigger: 'delay',
      triggerValue: 5,
    })
  })

  it('fails the job, metered, when the answer cannot be used', async () => {
    mockRunAiRequest.mockResolvedValue(called(answer({ body: '<p>hi</p>' })))
    const outcome = await run(jobOf(POPUP_INPUTS))
    expect(outcome.outputs).toEqual([])
    expect(outcome.failure).toBe(AI_OVERLAY_NO_COPY_COPY)
    expect(outcome.estCostUsd).toBeGreaterThan(0)
  })

  it('asks nothing when the inputs name no overlay kind', async () => {
    const outcome = await run(jobOf({ task: 'overlay' }))
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(outcome.failure).toBe(AI_OVERLAY_NO_KIND_COPY)
  })

  it('reports a refusal as one', async () => {
    mockRunAiRequest.mockResolvedValue({ kind: 'refusal', usage: usage(), estCostUsd: 0.001, stopReason: 'refusal' })
    const outcome = await run(jobOf(POPUP_INPUTS))
    expect(outcome.refused).toBe(true)
  })

  it('leaves a text job that asks for no overlay answered as prose', async () => {
    mockRunAiRequest.mockResolvedValue({
      kind: 'completion',
      text: 'Sourdough before sunrise.',
      toolUse: [],
      usage: usage(),
      estCostUsd: 0.001,
      stopReason: 'end_turn',
    })
    const outcome = await run(jobOf({}, 'A tagline for a bakery'))
    expect(mockRunAiRequest.mock.calls[0][0].tools).toBeUndefined()
    expect(outcome.outputs[0]).toMatchObject({ resource: 'text', text: 'Sourdough before sunrise.' })
    expect(outcome.outputs[0].proposal).toBeUndefined()
  })
})
