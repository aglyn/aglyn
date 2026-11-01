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
  ASSIST_PAGE_CHANGE_ACTION_ID,
  assistPageChangeHistoryNote,
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

/**
 * The chat is sent a thread's text and nothing else, so what became of a page
 * change has to be in that text or the model reads its own "I'll make this
 * change" with no outcome (AGL-4116).
 */
describe('what the next question hears of a page change', () => {
  it('says nothing of a turn that asked for none', () => {
    expect(assistPageChangeHistoryNote({})).toBeNull()
    expect(assistPageChangeHistoryNote({ pageChange: null })).toBeNull()
  })

  it('says it is being made until the job settles', () => {
    expect(assistPageChangeHistoryNote({ pageChange: PROPOSAL })).toBe('(Page change on Home being made.)')
    expect(assistPageChangeHistoryNote({ pageChange: PROPOSAL, pageChangeJob: job({ status: 'running' }) })).toBe(
      '(Page change on Home being made.)',
    )
  })

  it('carries the job’s own note, which says where the change went and what it left out', () => {
    const note = 'Saved as this page’s draft. Nothing visitors see has changed. Left out: the search title.'
    const outputs = [{ resource: 'screen', id: 'home', versionId: 'v-1', inDraft: true, note }]
    expect(assistPageChangeHistoryNote({ pageChange: PROPOSAL, pageChangeJob: job({ status: 'done', outputs: outputs as never }) })).toBe(
      `(Page change on Home: ${note})`,
    )
  })

  it('says a change that failed or was canceled was not made, and why', () => {
    expect(assistPageChangeHistoryNote({ pageChange: PROPOSAL, pageChangeJob: job({ status: 'failed', error: 'No change could be made.' }) })).toBe(
      '(Page change on Home not made: No change could be made.)',
    )
    expect(assistPageChangeHistoryNote({ pageChange: PROPOSAL, pageChangeJob: job({ status: 'canceled' }) })).toBe(
      '(Page change on Home not made: canceled)',
    )
  })

  it('says a change that never started did not', () => {
    expect(assistPageChangeHistoryNote({ pageChange: PROPOSAL, pageChangeNotice: 'You are out of AI credits.' })).toBe(
      '(Page change on Home not started: You are out of AI credits.)',
    )
  })
})
