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
 * The audit logs' filters are served by indexes that exist (AGL-3321).
 *
 * Every combination of clauses the staff audit log can send is walked here,
 * and the composite each one needs is looked up in the index file the
 * project deploys. A combination the query would build with no index behind
 * it throws at runtime for every reader, so it fails here instead. (The
 * organization's activity logs are pinned by
 * `specs/activity-list-query-indexes.spec.ts`.)
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ListFilterClause } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import {
  ADMIN_AUDIT_FILTER_FIELDS,
  ADMIN_AUDIT_SINGLE_FIELDS,
  adminAuditClauseStandsAlongside,
  adminAuditIndexFor,
  adminAuditPlan,
} from './audit-log-filters'

interface IndexEntry {
  collectionGroup: string
  queryScope: string
  fields: Array<{ fieldPath: string; order?: string }>
}

const INDEXES = (
  JSON.parse(
    readFileSync(join(__dirname, '..', '..', '..', 'cloud', 'firebase-firestore.indexes.json'), 'utf8'),
  ) as { indexes: IndexEntry[] }
).indexes

const declared = (collectionGroup: string, queryScope: string, fields: string[]) =>
  INDEXES.some(
    (index) =>
      index.collectionGroup === collectionGroup &&
      index.queryScope === queryScope &&
      index.fields.map((field) => `${field.fieldPath}:${field.order}`).join(',') ===
        fields.join(','),
  )

describe('the staff audit log', () => {
  it('serves each equality, one at a time, on an index the file declares', () => {
    for (const field of ADMIN_AUDIT_SINGLE_FIELDS) {
      for (const withDate of [false, true]) {
        const clauses: ListFilterClause[] = [
          { field, op: 'equals', value: 'x' },
          ...(withDate ? [{ field: 'at', op: 'after', value: '2026-09-01' }] : []),
        ]
        const shape = adminAuditIndexFor(adminAuditPlan(clauses).served)
        expect(shape).not.toBeNull()
        expect(declared('adminAudit', 'COLLECTION', shape?.fields ?? [])).toBe(true)
      }
    }
  })

  it('adds one composite, and only one: action with the date sort', () => {
    expect(adminAuditIndexFor([{ field: 'action', op: 'equals', value: 'x' }])?.fields).toEqual([
      'action:ASCENDING',
      'at:DESCENDING',
    ])
    expect(declared('adminAudit', 'COLLECTION', ['action:ASCENDING', 'at:DESCENDING'])).toBe(true)
  })

  it('never sends two equalities to the query — the second is matched as the log is read', () => {
    const plan = adminAuditPlan([
      { field: 'action', op: 'equals', value: 'org.override' },
      { field: 'target', op: 'equals', value: 'orgs/acme' },
      { field: 'at', op: 'before', value: '2026-09-01' },
    ])
    expect(plan.served.map((clause) => clause.field)).toEqual(['action', 'at'])
    expect(plan.matched.map((clause) => clause.field)).toEqual(['target'])
    expect(adminAuditIndexFor(plan.served)?.fields[0]).toBe('action:ASCENDING')
  })

  it('matches scope and action group rather than querying them', () => {
    const plan = adminAuditPlan([
      { field: 'scope', op: 'equals', value: 'host' },
      { field: 'actionGroup', op: 'equals', value: 'ai' },
    ])
    expect(plan.served).toEqual([])
    expect(plan.matched.map((clause) => clause.field)).toEqual(['scope', 'actionGroup'])
    expect(adminAuditIndexFor(plan.served)).toBeNull()
    for (const column of ['scope', 'actionGroup']) {
      expect(ADMIN_AUDIT_FILTER_FIELDS.find((field) => field.column === column)?.windowOnly).toBe(
        true,
      )
    }
  })

  it('keeps the date and the matched fields beside the one served equality', () => {
    const alongside = (field: string) =>
      adminAuditClauseStandsAlongside({ field, op: 'equals', value: 'x' })
    expect(['at', 'scope', 'actionGroup'].every(alongside)).toBe(true)
    expect(['action', 'actorUid', 'target'].some(alongside)).toBe(false)
  })
})
