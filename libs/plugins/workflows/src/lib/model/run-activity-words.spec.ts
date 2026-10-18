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

import { describeAutomationRunAction } from './run-activity-words'

describe('describeAutomationRunAction (AGL-3892)', () => {
  it('says each run line the engine writes with its event in words', () => {
    expect(describeAutomationRunAction('Action ran on formSubmission')).toBe('Automation ran: Form submitted')
    expect(describeAutomationRunAction('Action ran on lead with errors: Send email failed')).toMatch(/^Automation failed: /)
    expect(describeAutomationRunAction('Org automation ran on formSubmission')).toBe('Org automation ran: Form submitted')
    expect(describeAutomationRunAction('Workflow failed on formSubmission: boom')).toBe('Workflow failed: Form submitted')
    expect(describeAutomationRunAction('Workflow ran on formSubmission')).toBe('Workflow ran: Form submitted')
    expect(describeAutomationRunAction('Action is waiting, on formSubmission')).toBe('Automation is waiting: Form submitted')
    expect(describeAutomationRunAction('Action skipped on formSubmission')).toBe('Automation skipped: Form submitted')
  })

  it('leaves every other action alone', () => {
    expect(describeAutomationRunAction('Published page')).toBeUndefined()
    expect(describeAutomationRunAction('ai.job.output')).toBeUndefined()
    expect(describeAutomationRunAction('Flow stopped mid-wait: removed')).toBeUndefined()
  })
})
