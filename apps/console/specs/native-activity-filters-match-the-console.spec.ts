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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listFilterOperators } from '@aglyn/shared-ui-jsx/const/list-filter'
import { ORG_ACTIVITY_FILTER_FIELDS } from '../utils/activity-list-query'
import { readAuditLogFilters } from '../utils/server/audit-log-filter'

/*
 * The apps' Activity filters (core.team.activity in
 * libs/native/screens/team.screens.json) ask the org-wide route only for the
 * fields and operators its declaration serves, never more clauses than it
 * reads, and pick Who and Where from the route's own facets.
 */
const spec = JSON.parse(
  readFileSync(join(__dirname, '../../../libs/native/screens/team.screens.json'), 'utf8'),
) as { screens: Array<Record<string, any>> }
const activity = spec.screens.find((screen) => screen.id === 'core.team.activity')!
const clauses: Array<{ field: string; op: string }> = activity.load.activity.filters

describe('native activity filters', () => {
  it('asks only for fields and operators the org-wide log serves', () => {
    for (const clause of clauses) {
      const field = ORG_ACTIVITY_FILTER_FIELDS.find((entry) => entry.column === clause.field)
      expect(field).toBeDefined()
      expect(listFilterOperators(field!)).toContain(clause.op)
    }
  })

  it('never sends more clauses than the route reads', () => {
    const all = JSON.stringify(clauses.map(({ field, op }) => ({ field, op, value: 'x' })))
    expect(readAuditLogFilters({ filters: all }, ORG_ACTIVITY_FILTER_FIELDS)).toHaveLength(clauses.length)
  })

  it('picks Who and Where from the route’s facets', () => {
    expect(activity.load.facets.url).toContain('facets=1')
    const filter = activity.actions.find((action: any) => action.id === 'filter')
    const from = Object.fromEntries(filter.prompt.map((field: any) => [field.key, field.optionsFrom?.items]))
    expect(from['who']).toBe('data.facets.facets.actors')
    expect(from['where']).toBe('data.facets.facets.sites')
  })
})
