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
  AI_EXPERIMENT_BODY_MAX_CHARS,
  AI_EXPERIMENT_HEADLINE_MAX_CHARS,
  AI_EXPERIMENT_LINE_MAX_CHARS,
  AI_EXPERIMENT_MAX_POINTS,
  AI_EXPERIMENT_MAX_VARIANTS,
  AI_EXPERIMENT_MIN_VARIANTS,
  AI_EXPERIMENT_NAME_MAX_CHARS,
  AI_EXPERIMENT_NEXT_MAX_CHARS,
  AI_EXPERIMENT_POINT_MAX_CHARS,
  AI_EXPERIMENT_RATIONALE_MAX_CHARS,
  aiExperimentVariantFields,
  type AiExperimentExplanationAnswer,
  type AiExperimentTarget,
  type AiExperimentVariantsProposal,
} from '../model/ai-experiment'
import type { AiTool } from '../providers/contract'

/**
 * The two strict tools an `experiment` job answers through (AGL-2914).
 *
 * `propose_variants` writes copy for the thing under test and nothing else:
 * no weights, no traffic split, no schedule, no winner — those are the A/B
 * testing card's, and a model that could name them could start a test.
 * `explain_result` writes the words for a verdict code already reached, and
 * carries a `winner` field only so an answer that names one can be caught:
 * `checkAiExperimentExplanation` decides what is kept, never this schema.
 */

export const AI_EXPERIMENT_VARIANTS_TOOL_NAME = 'propose_variants'
export const AI_EXPERIMENT_EXPLAIN_TOOL_NAME = 'explain_result'

/** The copy fields a target's variants fill, as the tool describes them. */
const FIELD_HELP: Record<
  'headline' | 'body' | 'subject' | 'preheader',
  string
> = {
  headline: `The variant's main line of copy; at most ${AI_EXPERIMENT_LINE_MAX_CHARS} characters. Empty string when this variant does not change it.`,
  body: `The variant's supporting copy; at most ${AI_EXPERIMENT_BODY_MAX_CHARS} characters. Empty string when this variant does not change it.`,
  subject: `The variant's subject line; at most ${AI_EXPERIMENT_LINE_MAX_CHARS} characters. Empty string when this variant does not change it.`,
  preheader: `The variant's preheader, the line shown beside the subject; at most ${AI_EXPERIMENT_LINE_MAX_CHARS} characters. Empty string when this variant does not change it.`,
}

export function aiExperimentVariantsTool(target: AiExperimentTarget): AiTool {
  const fields = aiExperimentVariantFields(target).filter(
    (field): field is 'headline' | 'body' | 'subject' | 'preheader' =>
      field !== 'name' && field !== 'rationale',
  )
  const properties: Record<string, unknown> = {
    name: {
      type: 'string',
      description: `What to call this variant, in a few words; at most ${AI_EXPERIMENT_NAME_MAX_CHARS} characters.`,
    },
  }
  for (const field of fields) {
    properties[field] = { type: 'string', description: FIELD_HELP[field] }
  }
  properties['rationale'] = {
    type: 'string',
    description: `One sentence: what this variant changes and what that is testing; at most ${AI_EXPERIMENT_RATIONALE_MAX_CHARS} characters.`,
  }
  return {
    name: AI_EXPERIMENT_VARIANTS_TOOL_NAME,
    description:
      `Propose between ${AI_EXPERIMENT_MIN_VARIANTS} and ${AI_EXPERIMENT_MAX_VARIANTS} variants for the ` +
      'A/B test, the first of them the copy already there. Every field is required.',
    strict: true,
    inputSchema: {
      type: 'object',
      properties: {
        goal: {
          type: 'string',
          description: `What these variants are trying to move, in one short phrase; at most ${AI_EXPERIMENT_RATIONALE_MAX_CHARS} characters.`,
        },
        variants: {
          type: 'array',
          description: `The first is the copy under test as it stands; at most ${AI_EXPERIMENT_MAX_VARIANTS} in all. Each varies one idea, and no two say the same thing.`,
          items: {
            type: 'object',
            properties,
            required: ['name', ...fields, 'rationale'],
            additionalProperties: false,
          },
        },
      },
      required: ['goal', 'variants'],
      additionalProperties: false,
    },
  }
}

export function aiExperimentExplainTool(): AiTool {
  return {
    name: AI_EXPERIMENT_EXPLAIN_TOOL_NAME,
    description:
      'Explain what this result means, in the words of the verdict the request states. ' +
      'Every field is required.',
    strict: true,
    inputSchema: {
      type: 'object',
      properties: {
        headline: {
          type: 'string',
          description: `One plain sentence saying what happened; at most ${AI_EXPERIMENT_HEADLINE_MAX_CHARS} characters.`,
        },
        points: {
          type: 'array',
          description: `What the figures show, most useful first; at most ${AI_EXPERIMENT_MAX_POINTS}. Empty when the headline says it all.`,
          items: {
            type: 'string',
            description: `One plain sentence; at most ${AI_EXPERIMENT_POINT_MAX_CHARS} characters.`,
          },
        },
        winner: {
          type: 'string',
          description:
            'The variant the request states won, exactly as the figures name it. Empty string where the request states there is no winner yet.',
        },
        next: {
          type: 'string',
          description: `What to do next; at most ${AI_EXPERIMENT_NEXT_MAX_CHARS} characters. Empty string where the request states there is no winner yet.`,
        },
      },
      required: ['headline', 'points', 'winner', 'next'],
      additionalProperties: false,
    },
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

/**
 * A `propose_variants` call as the check reads it, or `null` when the call is
 * not a proposal at all. Values keep the lengths the model wrote, so the
 * check — not this reader — decides what is too long.
 */
export function parseAiExperimentVariants(
  input: unknown,
): AiExperimentVariantsProposal | null {
  if (!isRecord(input) || !Array.isArray(input['variants'])) return null
  return {
    goal: str(input['goal']),
    variants: input['variants'].filter(isRecord).map((raw) => ({
      name: str(raw['name']),
      headline: str(raw['headline']),
      body: str(raw['body']),
      subject: str(raw['subject']),
      preheader: str(raw['preheader']),
      rationale: str(raw['rationale']),
    })),
  }
}

/** An `explain_result` call as the check reads it, or `null` when it is not one. */
export function parseAiExperimentExplanation(
  input: unknown,
): AiExperimentExplanationAnswer | null {
  if (!isRecord(input) || typeof input['headline'] !== 'string') return null
  return {
    headline: input['headline'],
    points: (Array.isArray(input['points']) ? input['points'] : []).map(str),
    winner: str(input['winner']),
    next: str(input['next']),
  }
}
