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

import type { AiAutomation } from './ai-automation-format'
import { aiAutomationRevisionChanges } from './ai-automation-draft'
import {
  AI_WORKFLOW_REVISE_WORKFLOW_COPY,
  aiActionReviseBlocker,
  parseAiWorkflowJobInputs,
} from './ai-workflow-job'

/**
 * A revision (AGL-3603): what it may start from, and what it reports as
 * changed — worked out from the two stored shapes, never from the model.
 */

const SAVED: AiAutomation = {
  name: 'Welcome',
  trigger: { event: 'formSubmission', conditions: [{ field: 'formName', op: 'equals', value: 'News' }], combinator: 'and' },
  steps: [
    { type: 'enrollList', listId: 'list-1', listName: 'News' },
    { type: 'notifyAdmins', title: 'New sign-up' },
  ],
  enabled: true,
}
const label = (type: string) => `[${type}]`

describe('a revision’s inputs', () => {
  it('reads a revise of an action, and refuses one of a workflow or of nothing', () => {
    expect(parseAiWorkflowJobInputs({ mode: 'revise', targetType: 'action', targetId: 'act-1' })).toEqual({
      mode: 'revise',
      targetType: 'action',
      targetId: 'act-1',
    })
    expect(parseAiWorkflowJobInputs({ mode: 'revise', targetType: 'workflow', targetId: 'wf-1' })).toBe(
      AI_WORKFLOW_REVISE_WORKFLOW_COPY,
    )
    expect(parseAiWorkflowJobInputs({ mode: 'revise' })).toBe('Pick the automation to explain')
  })
})

describe('what AI may revise', () => {
  it('accepts an action of server steps on a host event, and names what blocks any other', () => {
    expect(aiActionReviseBlocker(SAVED)).toBeNull()
    expect(aiActionReviseBlocker({ ...SAVED, trigger: { event: 'click' } })).toBe('page-event')
    expect(aiActionReviseBlocker({ ...SAVED, steps: [...SAVED.steps, { type: 'showHtml', html: '<p/>' } as never] })).toBe(
      'page-step',
    )
    expect(aiActionReviseBlocker({ ...SAVED, trigger: { ...SAVED.trigger, filter: 'a > 1' } })).toBe('filter')
    expect(aiActionReviseBlocker({ ...SAVED, trigger: { ...SAVED.trigger, filter: '  ' } })).toBeNull()
  })
})

describe('what a revision changed', () => {
  it('names added, removed and changed steps, and a changed trigger or its conditions', () => {
    expect(aiAutomationRevisionChanges(SAVED, SAVED, label)).toEqual([])
    const added = { ...SAVED, steps: [...SAVED.steps, { type: 'addContactTag', tag: 'news' } as never] }
    expect(aiAutomationRevisionChanges(SAVED, added, label)).toEqual(['Added: [addContactTag].'])
    const removed = { ...SAVED, steps: [SAVED.steps[0]] }
    expect(aiAutomationRevisionChanges(SAVED, removed, label)).toEqual(['Removed: [notifyAdmins].'])
    const edited = { ...SAVED, steps: [SAVED.steps[0], { type: 'notifyAdmins', title: 'Someone signed up' } as never] }
    expect(aiAutomationRevisionChanges(SAVED, edited, label)).toEqual(['Changed: [notifyAdmins].'])
    const conditions = { ...SAVED, trigger: { ...SAVED.trigger, conditions: [] } }
    expect(aiAutomationRevisionChanges(SAVED, conditions, label)).toEqual(['Its conditions changed.'])
    const event = { ...SAVED, trigger: { event: 'contactCreated' } }
    expect(aiAutomationRevisionChanges(SAVED, event, label)).toEqual(['It starts on a different event.'])
  })
})
