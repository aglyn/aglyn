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

import {
  AI_OVERLAY_TRIGGERS,
  type AiOverlayCopyAnswer,
  type AiOverlayCopyField,
  type AiOverlayKind,
  type AiOverlayTrigger,
} from '../model/ai-overlay-copy'
import type { AiTool } from '../providers/contract'

/**
 * The strict tool overlay copy is answered through (AGL-3603).
 *
 * It carries copy and, for a popup, WHEN it opens — one of the triggers the
 * request lists, or `none`. It has no field for a link, a schedule, the
 * pages it shows on or whether it is switched on: those are a person's
 * decisions in the overlay editor, and a model that could name them could put
 * an overlay in front of visitors nobody chose.
 */

export const AI_OVERLAY_TOOL_NAME = 'write_overlay_copy'

export function aiOverlayTool(
  kind: AiOverlayKind,
  limits: Readonly<Record<AiOverlayCopyField, number>>,
  triggers: readonly AiOverlayTrigger[],
): AiTool {
  const properties: Record<string, unknown> = {
    name: {
      type: 'string',
      description: `A short internal name for the ${kind === 'bar' ? 'bar' : 'popup'}, for the site owner's list; at most ${limits.name} characters.`,
    },
  }
  const required = ['name']
  if (kind === 'bar') {
    properties['text'] = {
      type: 'string',
      description: `The bar's one line of copy; at most ${limits.text} characters.`,
    }
    required.push('text')
  } else {
    properties['headline'] = {
      type: 'string',
      description: `The popup's headline; at most ${limits.headline} characters.`,
    }
    properties['body'] = {
      type: 'string',
      description: `The popup's supporting copy, one or two short paragraphs; at most ${limits.body} characters.`,
    }
    properties['ctaLabel'] = {
      type: 'string',
      description: `The button's label, a few words that start with a verb; at most ${limits.ctaLabel} characters. Empty string for no button.`,
    }
    properties['trigger'] = {
      type: 'string',
      enum: [...triggers.filter((trigger) => (AI_OVERLAY_TRIGGERS as readonly string[]).includes(trigger)), 'none'],
      description: 'When the popup opens, from the triggers the request lists; `none` to leave it as it is.',
    }
    properties['triggerValue'] = {
      type: 'number',
      description:
        'Seconds after the page loads for `delay`, the percent of the page scrolled for `scroll`, inside the range the request gives; 0 for `exit` or `none`.',
    }
    required.push('headline', 'body', 'ctaLabel', 'trigger', 'triggerValue')
  }
  properties['rationale'] = {
    type: 'string',
    description: 'One sentence on what the copy leans on; at most 200 characters.',
  }
  required.push('rationale')
  return {
    name: AI_OVERLAY_TOOL_NAME,
    description: `Write the copy for one ${kind === 'bar' ? 'announcement bar' : 'popup'}. Every field is required.`,
    strict: true,
    inputSchema: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

/**
 * A `write_overlay_copy` call as the check reads it, or `null` when it is not
 * one. Values keep the lengths the model wrote: the check decides what is too
 * long.
 */
export function parseAiOverlayCopy(input: unknown): AiOverlayCopyAnswer | null {
  if (!isRecord(input)) return null
  const value = input['triggerValue']
  return {
    name: str(input['name']),
    text: str(input['text']),
    headline: str(input['headline']),
    body: str(input['body']),
    ctaLabel: str(input['ctaLabel']),
    trigger: str(input['trigger']),
    triggerValue: typeof value === 'number' && Number.isFinite(value) ? value : null,
    rationale: str(input['rationale']),
  }
}
