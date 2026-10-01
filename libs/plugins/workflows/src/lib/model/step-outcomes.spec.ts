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

import { describeStepOutcome, HOST_ACTION_STEP_OUTCOMES } from './step-outcomes'

/** A run's summary line, one past-tense phrase per step it took (AGL-2171). */
describe('describeStepOutcome', () => {
  it('builds the line the mockup prints', () => {
    const line = [
      describeStepOutcome('sendEmail'),
      describeStepOutcome('datasetAppend', 'Leads'),
      describeStepOutcome('webhookPost', '200'),
    ].join(' · ')
    expect(line).toBe('sent email · saved to Leads · webhook 200')
  })

  it('carries the webhook STATUS, not just that it was sent', () => {
    // The status is the entire reason anyone opens a run history after a
    // webhook, and it was discarded on the line it arrived.
    expect(describeStepOutcome('webhookPost', '204')).toBe('webhook 204')
    expect(describeStepOutcome('webhookPost')).toBe('webhook')
  })

  it('names the dataset instead of saying "dataset"', () => {
    expect(describeStepOutcome('datasetAppend', 'Leads')).toBe(
      'saved to Leads',
    )
    expect(describeStepOutcome('updateDataset', 'Leads')).toBe(
      'updated Leads',
    )
    // Without a name it still reads as a sentence.
    expect(describeStepOutcome('datasetAppend')).toBe('saved to dataset')
  })

  it('never renders a bare enum for a step it does not know', () => {
    // A new step type must degrade to its own name, not to `undefined`.
    expect(describeStepOutcome('showElement' as never)).toBe('showElement')
  })

  it('is past tense, unlike the picker labels', () => {
    // `HOST_ACTION_STEP_LABELS` says what a step WILL do, for a `Do`
    // select. Deriving one map from the other would put "Send a webhook
    // (Business)" — plan suffix and all — into a log line.
    expect(HOST_ACTION_STEP_OUTCOMES.sendEmail).toBe('sent email')
    expect(HOST_ACTION_STEP_OUTCOMES.webhookPost).not.toMatch(/Business/)
  })
})
