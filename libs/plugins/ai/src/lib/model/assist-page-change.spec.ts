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

import type { AiJobSummary } from './ai-jobs.types'
import {
  ASSIST_OUTCOMES_SENT,
  ASSIST_PAGE_CHANGE_ACTION_ID,
  assistPageChangeOutcome,
  assistThreadOutcomes,
  type AssistPageChangeProposal,
} from './assist-page-change'

const PROPOSAL: AssistPageChangeProposal = {
  id: ASSIST_PAGE_CHANGE_ACTION_ID,
  hostId: 'host-1',
  pageId: 'home',
  pageName: 'Home',
  brief: 'Make the top image fill the background.',
  summary: 'Make the top image fill the background on Home',
}

const job = (patch: Partial<AiJobSummary>) => ({ status: 'running', outputs: [], error: null, ...patch }) as unknown as AiJobSummary

describe('what became of a page change (AGL-4116)', () => {
  it('says nothing of a turn that asked for none', () => {
    expect(assistPageChangeOutcome({})).toBeNull()
    expect(assistPageChangeOutcome({ pageChange: null })).toBeNull()
  })

  it('says it is being made until the job settles', () => {
    expect(assistPageChangeOutcome({ pageChange: PROPOSAL })).toBe('Page change on Home being made.')
    expect(assistPageChangeOutcome({ pageChange: PROPOSAL, pageChangeJob: job({ status: 'running' }) })).toBe(
      'Page change on Home being made.',
    )
  })

  it('carries the job’s own note, which says where the change went and what it left out', () => {
    const note = 'Saved as this page’s draft. Nothing visitors see has changed. Left out: the search title.'
    const outputs = [{ resource: 'screen', id: 'home', versionId: 'v-1', inDraft: true, note }]
    expect(assistPageChangeOutcome({ pageChange: PROPOSAL, pageChangeJob: job({ status: 'done', outputs: outputs as never }) })).toBe(
      `Page change on Home: ${note}`,
    )
  })

  it('says a change that failed or was canceled was not made, and why', () => {
    expect(assistPageChangeOutcome({ pageChange: PROPOSAL, pageChangeJob: job({ status: 'failed', error: 'No change could be made.' }) })).toBe(
      'Page change on Home not made: No change could be made.',
    )
    expect(assistPageChangeOutcome({ pageChange: PROPOSAL, pageChangeJob: job({ status: 'canceled' }) })).toBe(
      'Page change on Home not made: canceled',
    )
  })

  it('says a change that never started did not', () => {
    expect(assistPageChangeOutcome({ pageChange: PROPOSAL, pageChangeNotice: 'You are out of AI credits.' })).toBe(
      'Page change on Home not started: You are out of AI credits.',
    )
  })
})

/**
 * The chat is sent a thread's text and nothing else, so what a thread changed
 * has to reach it some other way. These ride apart from the assistant's turns:
 * added to them, the model read its record of a saved draft as its own
 * forbidden claim and took the change back (AGL-4116).
 */
describe('what a thread changed', () => {
  const saved = job({ status: 'done', outputs: [{ resource: 'screen', id: 'home', versionId: 'v-1', inDraft: true, note: 'Saved as this page’s draft.' }] as never })

  it('lists every change in the order it happened', () => {
    expect(
      assistThreadOutcomes([
        {},
        { pageChange: PROPOSAL, pageChangeJob: saved },
        { edit: { summary: 'Change the button text' }, editOutcome: { kind: 'applied' } },
      ]),
    ).toEqual([
      'Page change on Home: Saved as this page’s draft.',
      'Applied to the open canvas as an unsaved change: Change the button text',
    ])
  })

  it('says what they turned down or could not apply, and nothing of a card still waiting', () => {
    expect(
      assistThreadOutcomes([
        { edit: { summary: 'Change the title' }, editOutcome: { kind: 'dismissed' } },
        { edit: { summary: 'Move the image' }, editOutcome: { kind: 'failed', message: 'It moved.' } },
        { edit: { summary: 'Still waiting' } },
      ]),
    ).toEqual(['Not applied, they turned it down: Change the title', 'Could not be applied: Move the image'])
  })

  it('keeps the newest when a thread has more than ride a question', () => {
    const turns = Array.from({ length: ASSIST_OUTCOMES_SENT + 2 }, (_, index) => ({
      edit: { summary: `Edit ${index}` },
      editOutcome: { kind: 'applied' },
    }))
    const outcomes = assistThreadOutcomes(turns)
    expect(outcomes).toHaveLength(ASSIST_OUTCOMES_SENT)
    expect(outcomes[0]).toContain('Edit 2')
    expect(outcomes.at(-1)).toContain(`Edit ${ASSIST_OUTCOMES_SENT + 1}`)
  })
})
