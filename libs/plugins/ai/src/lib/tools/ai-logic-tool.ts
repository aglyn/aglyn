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
  AI_LOGIC_COMPARATORS,
  AI_LOGIC_EXPRESSION_MAX_CHARS,
  AI_LOGIC_MAX_LOCALS,
  AI_LOGIC_MAX_OPERATIONS,
  AI_LOGIC_MAX_PARAMETERS,
  AI_LOGIC_MAX_SETS,
  AI_LOGIC_VALUE_TYPES,
  AI_LOGIC_VARIABLE_TYPES,
} from '../model/ai-logic-job'
import type { AiTool } from '../providers/contract'

/**
 * The strict tools a `logic` job answers through (AGL-3603). Each carries the
 * shape the logic editor stores and nothing else: no id, no flag that saves
 * or publishes. `checkAiLogicFunction` and `checkAiLogicVariable` decide what
 * is kept — the grammar, the names and a first run — never this schema.
 */

export const AI_LOGIC_FUNCTION_TOOL_NAME = 'submit_function'
export const AI_LOGIC_VARIABLE_TOOL_NAME = 'submit_variable'

const assignments = {
  type: 'array',
  description: `At most ${AI_LOGIC_MAX_SETS}; empty when nothing changes on that branch.`,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['set', 'expression'],
    properties: {
      set: { type: 'string', description: 'The parameter or local this assigns.' },
      expression: {
        type: 'string',
        description: `The value, as an expression; at most ${AI_LOGIC_EXPRESSION_MAX_CHARS} characters.`,
      },
    },
  },
}

export function aiLogicFunctionTool(): AiTool {
  return {
    name: AI_LOGIC_FUNCTION_TOOL_NAME,
    description: 'Submit the function, as the Functions editor stores it. Every field is required.',
    strict: true,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'parameters', 'locals', 'operations', 'returnValue'],
      properties: {
        name: { type: 'string', description: 'The function’s name: a letter or _, then letters, digits or _.' },
        parameters: {
          type: 'array',
          description: `What the function is given; at most ${AI_LOGIC_MAX_PARAMETERS}.`,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'type', 'required', 'label', 'defaultValue'],
            properties: {
              name: { type: 'string' },
              type: { type: 'string', enum: [...AI_LOGIC_VALUE_TYPES] },
              required: { type: 'boolean' },
              label: { type: 'string', description: 'What a visitor reads above the input; empty for none.' },
              defaultValue: { type: 'string', description: 'What the input starts with; empty for none.' },
            },
          },
        },
        locals: {
          type: 'array',
          description: `Working values the operations set; at most ${AI_LOGIC_MAX_LOCALS}.`,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'type'],
            properties: {
              name: { type: 'string' },
              type: { type: 'string', enum: [...AI_LOGIC_VALUE_TYPES] },
            },
          },
        },
        operations: {
          type: 'array',
          description: `Run in order; at most ${AI_LOGIC_MAX_OPERATIONS}. Each is if (left comparator right) then … otherwise ….`,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['if', 'then', 'otherwise'],
            properties: {
              if: {
                type: 'object',
                additionalProperties: false,
                required: ['left', 'comparator', 'right'],
                properties: {
                  left: { type: 'string' },
                  comparator: { type: 'string', enum: [...AI_LOGIC_COMPARATORS] },
                  right: { type: 'string' },
                },
              },
              then: assignments,
              otherwise: assignments,
            },
          },
        },
        returnValue: { type: 'string', description: 'The parameter or local whose final value the function returns.' },
      },
    },
  }
}

export function aiLogicVariableTool(): AiTool {
  return {
    name: AI_LOGIC_VARIABLE_TOOL_NAME,
    description: 'Submit the variable, as the Variables editor stores it. Every field is required.',
    strict: true,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'type', 'value'],
      properties: {
        name: { type: 'string', description: 'A letter or _, then letters, digits or _.' },
        type: { type: 'string', enum: [...AI_LOGIC_VARIABLE_TYPES] },
        value: {
          type: 'string',
          description:
            'The value as stored: a number as digits; true or false; a date as YYYY-MM-DD; a time as HH:MM; a dictionary as a JSON object; a collection as a JSON list.',
        },
      },
    },
  }
}
