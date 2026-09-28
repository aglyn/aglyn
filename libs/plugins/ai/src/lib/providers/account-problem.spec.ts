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

import { anthropicAccountProblem } from './anthropic'
import { openAiCompatibleAccountProblem } from './openai-compatible'
import { AiUpstreamError } from './contract'

/**
 * Which provider failures are the PLATFORM's account rather than the request
 * (AGL-3377): the runtime alerts the operator on these, and only these, so a
 * customer's bad prompt never pages anybody.
 */
describe('provider account problems (AGL-3377)', () => {
  it('Anthropic: a refused key, or a balance too low to answer', () => {
    expect(anthropicAccountProblem(401, { type: 'authentication_error' })).toBe('credentials')
    expect(anthropicAccountProblem(403, { type: 'permission_error' })).toBe('credentials')
    expect(
      anthropicAccountProblem(400, {
        type: 'invalid_request_error',
        message: 'Your credit balance is too low to access the Anthropic API.',
      }),
    ).toBe('credit')
    expect(anthropicAccountProblem(400, { type: 'invalid_request_error', message: 'bad schema' })).toBeNull()
    expect(anthropicAccountProblem(429, { type: 'rate_limit_error' })).toBeNull()
    expect(anthropicAccountProblem(529, { type: 'overloaded_error' })).toBeNull()
  })

  it('OpenAI-compatible: a refused key, or an exhausted quota even on a 429', () => {
    expect(openAiCompatibleAccountProblem(401, null)).toBe('credentials')
    expect(openAiCompatibleAccountProblem(402, null)).toBe('credit')
    expect(openAiCompatibleAccountProblem(429, { code: 'insufficient_quota' })).toBe('credit')
    expect(openAiCompatibleAccountProblem(429, { code: 'rate_limit_exceeded' })).toBeNull()
    expect(openAiCompatibleAccountProblem(400, null)).toBeNull()
  })

  it('carries the classification on the error, absent by default', () => {
    expect(new AiUpstreamError(500, false, null).accountProblem).toBeNull()
    expect(new AiUpstreamError(401, false, 'req_1', 'credentials').accountProblem).toBe('credentials')
  })
})
