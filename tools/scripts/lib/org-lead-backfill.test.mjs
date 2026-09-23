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

// The org-lead fold (AGL-3276). The decisions that move live data, driven
// directly — a backfill's plan is the only part of it that can be tested
// before it has already run.

import assert from 'node:assert/strict'
import test from 'node:test'
import { foldLeads, pickEnrollment, planOrgLeads } from './org-lead-backfill.mjs'

const row = (hostId, data) => ({ hostId, id: 'key-1', data })

test('the earliest created row wins the record, and the later one folds in', () => {
  const fold = foldLeads('key-1', [
    row('site-b', { email: 'dana@x.com', createdAt: 2_000, name: 'D. Marsh', notes: 'From B' }),
    row('site-a', { email: 'dana@x.com', createdAt: 1_000, name: 'Dana Marsh' }),
  ])
  assert.equal(fold.data.name, 'Dana Marsh', 'the earlier row named her')
  // A field the survivor lacks is taken from the later row rather than lost.
  assert.equal(fold.data.notes, 'From B')
  assert.deepEqual(fold.data.migratedFromHostIds, ['site-a', 'site-b'])
})

test('a row that can prove its age beats one that cannot', () => {
  // An absent `createdAt` sorts last: a row with no date cannot out-rank one
  // that carries a real one, or the fold would turn on which row Firestore
  // happened to return first.
  const fold = foldLeads('key-1', [
    row('site-b', { email: 'd@x.com', name: 'Undated' }),
    row('site-a', { email: 'd@x.com', createdAt: 9_000, name: 'Dated' }),
  ])
  assert.equal(fold.data.name, 'Dated')
})

test('visibleTo is the union, and a row naming no scope is scoped to its own site', () => {
  const fold = foldLeads('key-1', [
    row('site-a', { createdAt: 1, visibleTo: ['host:site-a'] }),
    row('site-b', { createdAt: 2 }),
  ])
  assert.deepEqual(fold.data.visibleTo, ['host:site-a', 'host:site-b'])
})

test('the scope is never widened to the whole org', () => {
  // The direction that matters: a fold may not hand a lead to sites that
  // never held them. `['org']` by default would do exactly that.
  const fold = foldLeads('key-1', [
    row('site-a', { createdAt: 1, visibleTo: ['host:site-a'] }),
    row('site-b', { createdAt: 2, visibleTo: ['host:site-b'] }),
  ])
  assert.ok(!fold.data.visibleTo.includes('org'))
})

test('every site that captured the person is recorded, and the counters add', () => {
  const fold = foldLeads('key-1', [
    row('site-a', { createdAt: 1, submissionCount: 2, sources: ['form'], firstSeenAtMs: 10, lastSeenAtMs: 40 }),
    row('site-b', { createdAt: 2, submissionCount: 3, sources: ['booking'], firstSeenAtMs: 5, lastSeenAtMs: 90 }),
  ])
  assert.deepEqual(fold.data.capturedByHostIds, ['site-a', 'site-b'])
  assert.deepEqual(fold.data.sources, ['booking', 'form'])
  assert.equal(fold.data.submissionCount, 5)
  // The window brackets the person across both sites.
  assert.equal(fold.data.firstSeenAtMs, 5)
  assert.equal(fold.data.lastSeenAtMs, 90)
})

test('a conversion on ANY site survives the fold', () => {
  /*
   * The load-bearing one. The survivor here is open and was created first, so
   * a naive fold keeps "new" — and puts somebody who is already a contact
   * back in the Leads list, where the sequence runtime would enroll them
   * again. The person is converted; the record has to say so.
   */
  const fold = foldLeads('key-1', [
    row('site-a', { createdAt: 1, status: 'new' }),
    row('site-b', { createdAt: 2, status: 'qualified', convertedContactId: 'c-1', convertedAtMs: 77 }),
  ])
  assert.equal(fold.data.status, 'qualified')
  assert.equal(fold.data.convertedContactId, 'c-1')
  assert.equal(fold.data.convertedAtMs, 77)
})

test('an unqualified close survives, with the reason that closed it', () => {
  const fold = foldLeads('key-1', [
    row('site-a', { createdAt: 1, status: 'working' }),
    row('site-b', { createdAt: 2, status: 'unqualified', unqualifiedReason: 'No budget' }),
  ])
  assert.equal(fold.data.status, 'unqualified')
  assert.equal(fold.data.unqualifiedReason, 'No budget')
})

test('the EARLIEST marketing grant is the one that happened', () => {
  const fold = foldLeads('key-1', [
    row('site-a', { createdAt: 1, marketingConsent: { brand: { basis: 'granted', atMs: 500 } } }),
    row('site-b', { createdAt: 2, marketingConsent: { brand: { basis: 'granted', atMs: 100 } } }),
  ])
  assert.equal(fold.data.marketingConsent.brand.atMs, 100)
})

test('a grant a sibling site holds is carried, never dropped', () => {
  const fold = foldLeads('key-1', [
    row('site-a', { createdAt: 1 }),
    row('site-b', { createdAt: 2, marketingConsent: { two: { basis: 'granted', atMs: 9 } } }),
  ])
  assert.equal(fold.data.marketingConsent.two.basis, 'granted')
})

test('each folded row leaves a timeline entry naming where it came from', () => {
  const fold = foldLeads('key-1', [
    row('site-a', { createdAt: 1 }),
    row('site-b', { createdAt: 2, sources: ['booking'], firstSeenAtMs: 42 }),
  ])
  assert.equal(fold.activities.length, 1, 'the survivor records nothing about itself')
  assert.equal(fold.activities[0].hostId, 'site-b')
  assert.match(fold.activities[0].body, /booking/)
})

test('one site is still moved, and folds nothing', () => {
  const plan = planOrgLeads({ leadsByKey: new Map([['key-1', [row('site-a', { createdAt: 1 })]]]) })
  assert.equal(plan.writes.length, 1)
  assert.equal(plan.folded.length, 0, 'nothing was merged, so nothing is reported as merged')
  assert.equal(plan.deletes.length, 1, 'the host row still has to leave')
})

test('a key the org ALREADY holds is not overwritten, but its site rows still go', () => {
  /*
   * The live code carries a row over on the next write that touches it, so
   * by the time this runs the org row may be newer than the site rows it was
   * built from. Folding them over it would undo a capture that happened
   * after the promotion.
   */
  const plan = planOrgLeads({
    leadsByKey: new Map([['key-1', [row('site-a', { createdAt: 1 })]]]),
    orgLeadIds: new Set(['key-1']),
  })
  assert.equal(plan.writes.length, 0)
  assert.equal(plan.deletes.length, 1)
  assert.equal(plan.archives.length, 1)
})

test('a second run plans nothing once the host rows are gone', () => {
  const plan = planOrgLeads({ leadsByKey: new Map() })
  assert.deepEqual(plan, { writes: [], archives: [], deletes: [], folded: [] })
})

test('the enrollment furthest along is kept and the rest refused', () => {
  const { keep, refuse } = pickEnrollment([
    { id: 'e-1', data: { step: 1, nextDueAtMs: 100 } },
    { id: 'e-2', data: { step: 3, nextDueAtMs: 900 } },
    { id: 'e-3', data: { step: 2, nextDueAtMs: 50 } },
  ])
  assert.equal(keep.id, 'e-2')
  assert.deepEqual(refuse.map((row) => row.id).sort(), ['e-1', 'e-3'])
})

test('two enrollments on one step resolve by due time, not by map order', () => {
  const { keep } = pickEnrollment([
    { id: 'e-late', data: { step: 2, nextDueAtMs: 900 } },
    { id: 'e-soon', data: { step: 2, nextDueAtMs: 100 } },
  ])
  assert.equal(keep.id, 'e-soon')
})

test('the plan is stable: the same corpus plans the same way twice', () => {
  const corpus = () =>
    new Map([
      ['key-2', [row('site-b', { createdAt: 5 }), row('site-a', { createdAt: 4 })]],
      ['key-1', [row('site-a', { createdAt: 1 })]],
    ])
  const first = planOrgLeads({ leadsByKey: corpus() })
  const second = planOrgLeads({ leadsByKey: corpus() })
  assert.deepEqual(
    first.writes.map((w) => [w.id, w.data.migratedFromHostIds]),
    second.writes.map((w) => [w.id, w.data.migratedFromHostIds]),
  )
})
