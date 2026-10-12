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

jest.mock('@aglyn/aglyn/server', () => ({ writeCronBeat: jest.fn() }))
jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {},
  materializeDynamicList: jest.fn(),
}))

import { REEVALUATE_AFTER_MS, dynamicListIsDue } from './lists-materialize'

const NOW = 1_800_000_000_000

function listDoc(fields: Record<string, unknown>, updatedMs?: number) {
  return {
    get: (field: string) => fields[field],
    updateTime: updatedMs === undefined ? null : { toMillis: () => updatedMs },
  }
}

const at = (ms: number) => ({ toMillis: () => ms })

describe('dynamicListIsDue', () => {
  it('evaluates a list that has never been evaluated', () => {
    expect(dynamicListIsDue(listDoc({}), NOW)).toBe(true)
  })

  it('leaves a list its own sweep evaluated recently alone', () => {
    const evaluated = NOW - 15 * 60_000
    expect(dynamicListIsDue(listDoc({ lastEvaluatedAt: at(evaluated) }, evaluated + 40), NOW)).toBe(false)
  })

  it('evaluates once the interval has passed', () => {
    const evaluated = NOW - REEVALUATE_AFTER_MS
    expect(dynamicListIsDue(listDoc({ lastEvaluatedAt: at(evaluated) }, evaluated), NOW)).toBe(true)
  })

  it('evaluates a list edited since its last evaluation', () => {
    const evaluated = NOW - 15 * 60_000
    expect(
      dynamicListIsDue(listDoc({ lastEvaluatedAt: at(evaluated) }, evaluated + 5 * 60_000), NOW),
    ).toBe(true)
  })

  it('finishes a scan that stopped part-way', () => {
    const evaluated = NOW - 60_000
    expect(
      dynamicListIsDue(
        listDoc({ lastEvaluatedAt: at(evaluated), evaluationCursor: { source: 'contacts', afterId: 'x' } }, evaluated),
        NOW,
      ),
    ).toBe(true)
  })
})
