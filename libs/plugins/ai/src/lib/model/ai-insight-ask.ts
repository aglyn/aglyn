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
 * The words and bounds of "Ask AI about these numbers" and its "Ask about your numbers" dialog (AGL-3603, AGL-2915),
 * apart from the job's model so the native apps read the same words from the contracts (AGL-4011). No imports.
 */

/** The windows a question may be asked over, in days. */
export const AI_INSIGHT_WINDOWS: readonly number[] = [7, 14, 30, 90]

/** The window a question is asked over unless the person picks another. */
export const AI_INSIGHT_DEFAULT_DAYS = 14

/** The longest question a person may ask. */
export const AI_INSIGHT_QUESTION_MAX_CHARS = 1_000

/** The tile on a site's dashboard and Analytics page and on the workspace's Home. */
export const AI_INSIGHT_CARD_COPY = {
  title: 'Ask AI about these numbers',
  site: 'Ask a question about this site’s traffic, sales, bookings, automation runs and pipeline. Every answer shows the figures it is built from.',
  workspace: 'Ask a question about your workspace’s pipeline, the deals it closed and your datasets. Every answer shows the figures it is built from.',
  action: 'Ask a question',
} as const

/** Placeholder questions by surface, in the words a person would use. */
export const AI_INSIGHT_PLACEHOLDERS: Readonly<Record<string, string>> = {
  analytics: 'Which pages brought in the most visitors, and did anything change?',
  datasets: 'What is the average order total by state?',
  'crm-reports': 'Which campaign or form brought in the most people this month?',
  marketing: 'Which campaign brought in the most form submissions, and what did it earn?',
  automations: 'Which automations failed most this month?',
  bookings: 'Which services were booked most, and how many were canceled?',
  workspace: 'How much is in the pipeline, and what closed this month?',
}

/** The dialog's own words. */
export const AI_INSIGHT_DIALOG_COPY = {
  title: 'Ask about your numbers',
  questionLabel: 'What do you want to know?',
  windowLabel: 'Over the last',
  promise: 'The answer is read from your own figures, and every number in it links to where it comes from. Nothing is changed or sent.',
  working: 'Reading your figures. This usually takes a minute.',
  showFigures: 'Show the figures',
  hideFigures: 'Hide the figures',
  unanswered: 'The figures read here did not answer this question.',
  digest: 'Send me weekly insights for this workspace every Monday',
  askAnother: 'Ask another',
  close: 'Close',
  ask: 'Ask',
  openJobs: 'Open AI jobs',
  answerFailed: 'The answer could not be loaded. Try again.',
  questionFailed: 'The question could not be answered. Try again.',
  cannotRun: 'This workspace cannot run AI jobs right now.',
  stillWriting: 'The answer is still being written. Find it in AI jobs in a minute.',
  digestFailed: 'Your weekly insights setting could not be saved. Try again.',
  askFailed: 'The question could not be asked. Try again.',
} as const
