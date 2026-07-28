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
  addPlan,
  emptyTotals,
  needsScopeStamp,
  planMemberScopeTokens,
  planScopeStamp,
} from './backfill-scope'

describe('needsScopeStamp', () => {
  it('stamps a doc with no visibleTo', () => {
    expect(needsScopeStamp({})).toBe(true)
    expect(needsScopeStamp({ visibleTo: undefined })).toBe(true)
  })

  it('leaves an empty array alone', () => {
    // [] means "visible to nobody". Rewriting it to ['org'] here would
    // turn a hidden resource org-wide — the one direction this project
    // must never move a resource unasked.
    expect(needsScopeStamp({ visibleTo: [] })).toBe(false)
  })

  it('leaves an existing scope alone', () => {
    expect(needsScopeStamp({ visibleTo: ['org'] })).toBe(false)
    expect(needsScopeStamp({ visibleTo: ['host:h1'] })).toBe(false)
  })
})

describe('planScopeStamp', () => {
  it('stamps only what is missing', () => {
    const plan = planScopeStamp([
      { id: 'a', data: {} },
      { id: 'b', data: { visibleTo: ['host:h1'] } },
      { id: 'c', data: {} },
    ])
    expect(plan.writes).toEqual([
      { id: 'a', data: { visibleTo: ['org'] } },
      { id: 'c', data: { visibleTo: ['org'] } },
    ])
    expect(plan.skipped).toBe(1)
  })

  it('is idempotent — a second pass plans nothing', () => {
    const docs = [{ id: 'a', data: {} as { visibleTo?: unknown } }]
    const first = planScopeStamp(docs)
    expect(first.writes).toHaveLength(1)
    const applied = docs.map((doc, i) => ({
      id: doc.id,
      data: first.writes[i].data as { visibleTo: string[] },
    }))
    const second = planScopeStamp(applied)
    expect(second.writes).toHaveLength(0)
    expect(second.skipped).toBe(1)
  })
})

describe('planMemberScopeTokens', () => {
  it('writes the projection where it is missing', () => {
    const plan = planMemberScopeTokens([
      { $id: 'owner', role: 'owner' },
      {
        $id: 'collab',
        role: 'viewer',
        allHosts: false,
        hostAccess: { h1: 'editor' },
      },
    ])
    expect(plan.writes).toEqual([
      { id: 'owner', data: { scopeTokens: ['org'] } },
      { id: 'collab', data: { scopeTokens: ['org', 'host:h1'] } },
    ])
  })

  it('skips a member whose tokens already match, ignoring order', () => {
    const plan = planMemberScopeTokens([
      {
        $id: 'collab',
        role: 'viewer',
        allHosts: false,
        hostAccess: { h1: 'editor', h2: 'viewer' },
        scopeTokens: ['host:h2', 'org', 'host:h1'],
      },
    ])
    expect(plan.writes).toHaveLength(0)
    expect(plan.skipped).toBe(1)
  })

  it('CORRECTS a stale array rather than skipping it', () => {
    // Unlike the resource stamp this is a recompute: a partial earlier
    // failure that left a revoked host in the array must be fixed, or the
    // collaborator keeps reading a site they were removed from.
    const plan = planMemberScopeTokens([
      {
        $id: 'collab',
        role: 'viewer',
        allHosts: false,
        hostAccess: { h1: 'editor' },
        scopeTokens: ['org', 'host:h1', 'host:revoked'],
      },
    ])
    expect(plan.writes).toEqual([
      { id: 'collab', data: { scopeTokens: ['org', 'host:h1'] } },
    ])
  })

  it('keeps a legacy pre-allHosts member org-wide', () => {
    const plan = planMemberScopeTokens([{ $id: 'legacy', role: 'editor' }])
    expect(plan.writes).toEqual([
      { id: 'legacy', data: { scopeTokens: ['org'] } },
    ])
  })
})

describe('totals', () => {
  it('folds plans per collection', () => {
    const totals = emptyTotals()
    addPlan(totals, 'datasets', {
      writes: [{ id: 'a', data: { visibleTo: ['org'] } }],
      skipped: 2,
    })
    addPlan(totals, 'datasets', { writes: [], skipped: 3 })
    expect(totals.datasets).toEqual({ written: 1, skipped: 5 })
    expect(totals.media).toEqual({ written: 0, skipped: 0 })
  })
})
