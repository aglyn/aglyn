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

import { hostEventLabel } from '@aglyn/aglyn/app-utils/host-events'

/**
 * The `text` an outbound webhook's body carries beside `event`, `payload`
 * and `sentAt` (AGL-3684).
 *
 * A Slack incoming webhook answers `400 no_text` to a body without `text`,
 * so the step the docs offered for "post to Slack when a form is submitted"
 * failed every run. Slack, Google Chat and Teams incoming webhooks all post
 * a top-level `text` as it stands; any other receiver ignores one key more.
 *
 * It reads as a message, not a dump: a heading naming the event (and the
 * form, for a submission), one line per submitted value, then the page.
 * Ids the event carries for automations — `formId`, `hostId`, the journey
 * a submission ends — are left out; they are in `payload` for a machine.
 */

/** Keys a person reading the message has no use for. */
const UNREAD_KEYS = new Set(['formName', 'formId', 'path', 'hostId', 'journey', 'campaignIds'])

/** Slack's own limit is 40,000 characters; a message is far shorter. */
const MAX_LINES = 30
const MAX_VALUE_LENGTH = 500

/** Slack and Google Chat read `&`, `<` and `>` as markup; a visitor's text must not be. */
function escapeMarkup(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function readable(value: unknown): string | null {
  if (Array.isArray(value)) {
    const items = value.filter((item) => ['string', 'number', 'boolean'].includes(typeof item))
    return items.length ? items.join(', ') : null
  }
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function clip(value: string): string {
  return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…` : value
}

export function webhookSummaryText(event: string, payload: Record<string, unknown>): string {
  const formName = readable(payload['formName'])
  const heading =
    event === 'formSubmission'
      ? `*New form submission${formName ? ` — ${escapeMarkup(clip(formName))}` : ''}*`
      : `*${escapeMarkup(hostEventLabel(event))}*`

  const lines = Object.entries(payload)
    .filter(([key]) => !UNREAD_KEYS.has(key) && !key.startsWith('_'))
    .map(([key, value]) => [key, readable(value)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== null)
    .map(([key, value]) => `• *${escapeMarkup(key)}:* ${escapeMarkup(clip(value))}`)
  const shown = lines.slice(0, MAX_LINES)
  if (lines.length > shown.length) shown.push(`…and ${lines.length - shown.length} more`)

  const path = readable(payload['path'])
  return [heading, ...shown, ...(path ? [`Page: ${escapeMarkup(clip(path))}`] : [])].join('\n')
}
