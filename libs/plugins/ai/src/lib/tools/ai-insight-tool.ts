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
  AI_INSIGHT_GAP_MAX_CHARS,
  AI_INSIGHT_MAX_CHARS,
  AI_INSIGHT_MAX_CITED_ROWS,
  AI_INSIGHT_MAX_CITES,
  AI_INSIGHT_MAX_INSIGHTS,
  AI_INSIGHT_MAX_READS,
  type AiInsightAnswer,
} from '../model/ai-insight'
import type { AiTool } from '../providers/contract'

/**
 * The two strict tools an insight job answers through (AGL-2915).
 *
 * `read_figures` names readers — an id, a window and the reader's own
 * parameters — and nothing else: the model never writes a query, a field
 * path or a filter of its own, only a choice among the readers the request
 * lists. `submit_insights` is the answer, each insight citing the table rows
 * its figures come from. Lengths and counts are stated in the descriptions,
 * as the platform's other strict tools state them; the step holds every one.
 */

export const AI_INSIGHT_READ_TOOL_NAME = 'read_figures'
export const AI_INSIGHT_ANSWER_TOOL_NAME = 'submit_insights'

export function aiInsightReadTool(): AiTool {
  return {
    name: AI_INSIGHT_READ_TOOL_NAME,
    description:
      `Choose the readers whose tables answer the question: at most ${AI_INSIGHT_MAX_READS}, ` +
      'each from the list the request gives. Every field is required.',
    strict: true,
    inputSchema: {
      type: 'object',
      properties: {
        reads: {
          type: 'array',
          description: `The readers to read, most useful first; at most ${AI_INSIGHT_MAX_READS}.`,
          items: {
            type: 'object',
            properties: {
              reader: { type: 'string', description: 'A reader id from the list, exactly as written.' },
              days: {
                type: 'integer',
                description: 'One of the windows that reader lists, in days; 0 for a reader that lists none.',
              },
              params: {
                type: 'array',
                description: 'The parameters that reader lists, by name; empty when it lists none.',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    value: { type: 'string' },
                  },
                  required: ['name', 'value'],
                  additionalProperties: false,
                },
              },
            },
            required: ['reader', 'days', 'params'],
            additionalProperties: false,
          },
        },
      },
      required: ['reads'],
      additionalProperties: false,
    },
  }
}

export function aiInsightAnswerTool(): AiTool {
  return {
    name: AI_INSIGHT_ANSWER_TOOL_NAME,
    description:
      `Answer with at most ${AI_INSIGHT_MAX_INSIGHTS} insights, each citing the table rows its figures come from. ` +
      'Every field is required.',
    strict: true,
    inputSchema: {
      type: 'object',
      properties: {
        insights: {
          type: 'array',
          description: `Most useful first; at most ${AI_INSIGHT_MAX_INSIGHTS}.`,
          items: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description: `One or two plain sentences; at most ${AI_INSIGHT_MAX_CHARS} characters.`,
              },
              cites: {
                type: 'array',
                description: `The tables and rows its figures come from; at most ${AI_INSIGHT_MAX_CITES} tables.`,
                items: {
                  type: 'object',
                  properties: {
                    table: { type: 'string', description: 'The table handle: t1, t2, …' },
                    rows: {
                      type: 'array',
                      description: `Row numbers as the table numbers them, from 0; at most ${AI_INSIGHT_MAX_CITED_ROWS}.`,
                      items: { type: 'integer' },
                    },
                  },
                  required: ['table', 'rows'],
                  additionalProperties: false,
                },
              },
            },
            required: ['text', 'cites'],
            additionalProperties: false,
          },
        },
        gap: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
          description: `What the tables cannot answer, in one sentence without numbers; at most ${AI_INSIGHT_GAP_MAX_CHARS} characters. null when nothing.`,
        },
      },
      required: ['insights', 'gap'],
      additionalProperties: false,
    },
  }
}

/** One reader the model asked for, as it asked. */
export interface AiInsightReadRequest {
  reader: string
  days: number
  params: Record<string, string>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The reads a `read_figures` call names, shape-checked and bounded; the step decides which are real. */
export function parseAiInsightReads(input: unknown): AiInsightReadRequest[] {
  const reads = isRecord(input) && Array.isArray(input['reads']) ? input['reads'] : []
  const parsed: AiInsightReadRequest[] = []
  for (const raw of reads) {
    if (parsed.length === AI_INSIGHT_MAX_READS) break
    if (!isRecord(raw) || typeof raw['reader'] !== 'string') continue
    const params: Record<string, string> = {}
    for (const pair of Array.isArray(raw['params']) ? raw['params'] : []) {
      if (isRecord(pair) && typeof pair['name'] === 'string' && typeof pair['value'] === 'string') {
        params[pair['name']] = pair['value']
      }
    }
    const days = Number(raw['days'])
    parsed.push({
      reader: raw['reader'].trim(),
      days: Number.isInteger(days) && days >= 0 ? days : 0,
      params,
    })
  }
  return parsed
}

/**
 * A `submit_insights` call as the trace reads it, or `null` when the call is
 * not an answer at all. Values keep the types the model wrote, so the trace
 * — not this reader — decides what an unreadable citation costs.
 */
export function parseAiInsightAnswer(input: unknown): AiInsightAnswer | null {
  if (!isRecord(input) || !Array.isArray(input['insights'])) return null
  const insights = input['insights']
    .filter(isRecord)
    .map((raw) => ({
      text: typeof raw['text'] === 'string' ? raw['text'] : '',
      cites: (Array.isArray(raw['cites']) ? raw['cites'] : []).filter(isRecord).map((cite) => ({
        table: typeof cite['table'] === 'string' ? cite['table'] : '',
        rows: (Array.isArray(cite['rows']) ? cite['rows'] : []) as number[],
      })),
    }))
  const gap = typeof input['gap'] === 'string' ? input['gap'] : null
  return { insights, gap }
}
