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
 * The deals, tasks and leads import vocabularies (AGL-2662, AGL-2701):
 * each one's template is its own export's header, and that header maps
 * itself — every field the import can set is proposed from it, and the
 * columns a file cannot set are left unmapped rather than mis-mapped.
 */

import { DEAL_IMPORT_VOCABULARY, DEALS_IMPORT_URL } from './deal-import-drawer'
import { LEAD_IMPORT_VOCABULARY, LEADS_IMPORT_URL } from './lead-import-drawer'
import { TASK_IMPORT_VOCABULARY, TASKS_IMPORT_URL } from './task-import-drawer'

const header = (csv: string) => csv.split('\n')[0].split(',')

describe('the deals vocabulary', () => {
  it('posts to its route and its template maps itself', () => {
    expect(DEAL_IMPORT_VOCABULARY.route).toBe(DEALS_IMPORT_URL)
    const mapping = DEAL_IMPORT_VOCABULARY.guessMapping(header(DEAL_IMPORT_VOCABULARY.templateCsv()))
    expect(Object.values(mapping).sort()).toEqual(
      ['title', 'pipeline', 'stage', 'amount', 'currency', 'ownerEmail', 'expectedClose', 'notes'].sort(),
    )
  })
})

describe('the tasks vocabulary', () => {
  it('posts to its route and its template maps itself', () => {
    expect(TASK_IMPORT_VOCABULARY.route).toBe(TASKS_IMPORT_URL)
    const mapping = TASK_IMPORT_VOCABULARY.guessMapping(header(TASK_IMPORT_VOCABULARY.templateCsv()))
    expect(Object.values(mapping).sort()).toEqual(
      ['title', 'kind', 'priority', 'status', 'due', 'assigneeEmail', 'notes'].sort(),
    )
  })
})

describe('the leads vocabulary', () => {
  it('posts to its route and its template maps itself', () => {
    expect(LEAD_IMPORT_VOCABULARY.route).toBe(LEADS_IMPORT_URL)
    const mapping = LEAD_IMPORT_VOCABULARY.guessMapping(header(LEAD_IMPORT_VOCABULARY.templateCsv()))
    expect(Object.values(mapping).sort()).toEqual(
      ['email', 'name', 'status', 'ownerEmail', 'unqualifiedReason', 'notes'].sort(),
    )
  })

  /**
   * The address decides the document, so the drawer's courtesy count must
   * refuse exactly what the route refuses rather than merely counting
   * blanks.
   */
  it('counts a required cell the route would refuse, not just an empty one', () => {
    expect(LEAD_IMPORT_VOCABULARY.unusable?.('')).toBe(true)
    expect(LEAD_IMPORT_VOCABULARY.unusable?.('not-an-address')).toBe(true)
    expect(LEAD_IMPORT_VOCABULARY.unusable?.(' Dana@Example.com ')).toBe(false)
  })
})
