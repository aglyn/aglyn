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
 * The payload a console test run's steps see (AGL-3309): the caller's sample
 * fields, bounded as a visitor's are, and marked as a test whatever was sent.
 */

import { ACTION_TEST_RUN_PATH, actionTestRunPayload } from './action-test-run'

describe('actionTestRunPayload', () => {
  it('is a sample page, marked as a test, when the caller sends nothing', () => {
    for (const raw of [undefined, null, 'path=/x', 42, ['path', '/x']]) {
      expect(actionTestRunPayload(raw)).toEqual({
        path: ACTION_TEST_RUN_PATH,
        test: 'true',
      })
    }
  })

  it('keeps the caller’s identifier-named fields as strings, and drops the rest', () => {
    expect(
      actionTestRunPayload({
        path: '/pricing',
        plan: 'pro',
        seats: 3,
        'has space': 'x',
        '1st': 'x',
        _private: 'x',
      }),
    ).toEqual({ path: '/pricing', plan: 'pro', seats: '3', test: 'true' })
  })

  it('cannot be unmarked', () => {
    expect(actionTestRunPayload({ test: 'false' })['test']).toBe('true')
    expect(actionTestRunPayload({ test: '' })['test']).toBe('true')
  })

  it('reads twenty fields at most and cuts each value to 500 characters', () => {
    const raw = Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [`field${index}`, 'x'.repeat(900)]),
    )
    const payload = actionTestRunPayload(raw)
    const read = Object.keys(payload).filter((key) => key.startsWith('field'))
    expect(read).toHaveLength(20)
    expect(read.every((key) => payload[key].length === 500)).toBe(true)
  })
})
