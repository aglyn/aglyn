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
  PLUGIN_CONNECTIONS_BY_PLAN,
  PLUGIN_CONNECTIONS_PLAN_REFUSAL,
  PLUGIN_CONNECTIONS_PLANS,
  pluginConnectionsPlanNote,
} from './plugin-connections'

describe('pluginConnectionsPlanNote (AGL-4197)', () => {
  it('names the service and the plans, never a price', () => {
    const note = pluginConnectionsPlanNote(['Google Business Profile'])
    expect(note).toBe(
      'Connecting Google Business Profile comes with the Starter, Pro and Custom plans',
    )
    expect(note).not.toMatch(/\$|\d/)
  })

  it('joins several services and drops blanks and repeats', () => {
    expect(pluginConnectionsPlanNote(['A', ' ', 'B', 'A', 'C'])).toBe(
      'Connecting A, B and C comes with the Starter, Pro and Custom plans',
    )
  })

  it('says nothing when nothing is declared', () => {
    expect(pluginConnectionsPlanNote([])).toBeNull()
    expect(pluginConnectionsPlanNote([''])).toBeNull()
  })

  it('reads the same plans as the upgrade notice, and those plans have the feature', () => {
    expect(PLUGIN_CONNECTIONS_PLAN_REFUSAL).toContain(PLUGIN_CONNECTIONS_PLANS)
    expect(PLUGIN_CONNECTIONS_BY_PLAN.free).toBe(false)
    expect(PLUGIN_CONNECTIONS_BY_PLAN.starter).toBe(true)
    expect(PLUGIN_CONNECTIONS_BY_PLAN.pro).toBe(true)
    expect(PLUGIN_CONNECTIONS_BY_PLAN.enterprise).toBe(true)
  })
})
