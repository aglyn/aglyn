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
 * AGL-2171 — the run history `/product/workflows` advertises:
 * `Time | Trigger | Result | What happened`, with rows reading
 * `Sent email · saved to Leads · webhook 200` and an amber `Skipped`.
 *
 * Two of those columns had nothing to read. Only failures were recorded,
 * so every successful run logged the same eight words; and an unmet
 * condition was a bare `continue` that wrote nothing at all.
 *
 * The back-compat half matters as much as the new shape: the activity
 * collection is years of rows written by ~40 call sites, and a run table
 * that silently dropped every historic run — or promoted a media save into
 * it — would be a different bug wearing the fix's clothes.
 */

import {
  actionRunResult,
  actionRunSummary,
  actionTriggerLabel,
} from './activity-presenter'
import { describeStepOutcome, HOST_ACTION_STEP_OUTCOMES } from './actions'

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

describe('actionTriggerLabel', () => {
  it('humanises the built-in events', () => {
    // The console rendered raw camelCase in the select and in every row.
    expect(actionTriggerLabel('formSubmission')).toBe('Form submitted')
    expect(actionTriggerLabel('booking')).toBe('New booking')
    expect(actionTriggerLabel('memberSignUp')).toBe('Member signed up')
  })

  it('leaves a custom event name alone', () => {
    // The author chose it; it is already the word they think in.
    expect(actionTriggerLabel('checkout-abandoned')).toBe('checkout-abandoned')
  })

  it('degrades rather than rendering blank', () => {
    expect(actionTriggerLabel(undefined)).toBe('Event')
    expect(actionTriggerLabel('  ')).toBe('Event')
  })
})

describe('actionRunResult', () => {
  it('reads the stored verdict', () => {
    expect(actionRunResult({ result: 'succeeded' })).toBe('succeeded')
    expect(actionRunResult({ result: 'failed' })).toBe('failed')
    expect(actionRunResult({ result: 'skipped' })).toBe('skipped')
  })

  it('infers a legacy run from its prose', () => {
    // Years of rows predate the structured fields.
    expect(actionRunResult({ action: 'Action ran on formSubmission' })).toBe(
      'succeeded',
    )
    expect(
      actionRunResult({
        action: 'Action ran on formSubmission with errors: boom',
      }),
    ).toBe('failed')
  })

  it('refuses to call a NON-run a run', () => {
    // The activity collection also holds publishes, media saves and member
    // changes. Calling one of those `succeeded` would put it in the run
    // history under a verdict that means nothing for it.
    expect(actionRunResult({ action: 'Published the screen' })).toBeUndefined()
    expect(actionRunResult({ action: 'Uploaded a file' })).toBeUndefined()
    expect(actionRunResult({})).toBeUndefined()
  })

  it('ignores a junk verdict rather than trusting it', () => {
    expect(actionRunResult({ result: 'maybe' })).toBeUndefined()
  })
})

describe('actionRunSummary', () => {
  it('prefers the stored summary', () => {
    expect(
      actionRunSummary({
        summary: 'sent email · saved to Leads · webhook 200',
        action: 'Action ran on formSubmission',
      }),
    ).toBe('sent email · saved to Leads · webhook 200')
  })

  it('recovers the errors from a legacy failure', () => {
    expect(
      actionRunSummary({
        action: 'Action ran on formSubmission with errors: webhook failed',
      }),
    ).toBe('webhook failed')
  })

  it('does not repeat the trigger, which is its own column now', () => {
    // `Action ran on formSubmission` beside a Trigger column reading
    // `Form submitted` says the same thing twice and fills the one column
    // that was supposed to carry new information.
    expect(actionRunSummary({ action: 'Action ran on formSubmission' })).toBe(
      'Ran',
    )
  })

  it('is never blank for an entry that has any text at all', () => {
    expect(actionRunSummary({ action: 'Something else' })).toBe(
      'Something else',
    )
    expect(actionRunSummary({})).toBe('')
  })
})
