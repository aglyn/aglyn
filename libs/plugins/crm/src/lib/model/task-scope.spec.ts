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

import { CRM_ORG_TASK_SCOPE, isOrgTask } from './task-scope'

/**
 * The scope an ORGANIZATION task carries (AGL-2637). A creator that spelled
 * it as `[]` would file a task no listener can match, and one that added a
 * site's token would make it a site's task the org had widened — so the set
 * is pinned to the org token alone, and pinned as shared and frozen.
 */
describe('CRM_ORG_TASK_SCOPE', () => {
  it('is the org token alone', () => {
    expect([...CRM_ORG_TASK_SCOPE]).toEqual(['org'])
  })

  it('cannot be widened by a caller', () => {
    expect(Object.isFrozen(CRM_ORG_TASK_SCOPE)).toBe(true)
  })
})

/**
 * The site is the one fact that tells an organization task from a site's
 * task the org has widened: both carry the org token.
 */
describe('isOrgTask', () => {
  it('is true for a task filed with no site', () => {
    expect(isOrgTask({ hostId: null })).toBe(true)
    expect(isOrgTask({})).toBe(true)
  })

  it('is false for a site task, however widely it is scoped', () => {
    expect(isOrgTask({ hostId: 'site-1' })).toBe(false)
  })
})
