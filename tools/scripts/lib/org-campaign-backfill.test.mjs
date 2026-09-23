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

import assert from 'node:assert/strict'
import test from 'node:test'
import { addOutcomes, archiveIdFor, isValidScope, planOrgCampaigns } from './org-campaign-backfill.mjs'

const NOW = 1_800_000_000_000

test('a container moves under its own id, scoped to the site it came from', () => {
  const plan = planOrgCampaigns({
    containers: [{ hostId: 'site-a', id: 'c1', data: { name: 'Spring' } }],
    nowMs: NOW,
  })
  assert.equal(plan.containers.length, 1)
  assert.equal(plan.containers[0].id, 'c1')
  assert.deepEqual(plan.containers[0].data.visibleTo, ['host:site-a'])
  assert.equal(plan.containers[0].data.migratedFromHostId, 'site-a')
  assert.deepEqual(plan.deletes, [{ kind: 'emailCampaigns', hostId: 'site-a', id: 'c1' }])
  assert.equal(plan.archives[0].kind, 'emailCampaigns')
})

test('orgWide places every moved container on every site', () => {
  const plan = planOrgCampaigns({
    containers: [
      { hostId: 'site-a', id: 'c1', data: { name: 'Spring', visibleTo: ['host:site-a'] } },
    ],
    orgWide: true,
    nowMs: NOW,
  })
  assert.deepEqual(plan.containers[0].data.visibleTo, ['org'])
})

test('a container that already carries a valid scope keeps it', () => {
  const plan = planOrgCampaigns({
    containers: [
      { hostId: 'site-a', id: 'c1', data: { name: 'Both', visibleTo: ['host:site-a', 'host:site-b'] } },
    ],
    nowMs: NOW,
  })
  assert.deepEqual(plan.containers[0].data.visibleTo, ['host:site-a', 'host:site-b'])
})

test('the org copy of a container wins every field it holds', () => {
  const plan = planOrgCampaigns({
    containers: [{ hostId: 'site-a', id: 'c1', data: { name: 'Old', listIds: ['l1'] } }],
    orgContainers: new Map([['c1', { name: 'Renamed', visibleTo: ['org'] }]]),
    nowMs: NOW,
  })
  const [row] = plan.containers
  assert.equal(row.merged, true)
  assert.equal(row.data.name, 'Renamed')
  assert.deepEqual(row.data.visibleTo, ['org'])
  // A field only the site held is filled rather than lost.
  assert.deepEqual(row.data.listIds, ['l1'])
})

test('a send gains the site it is sent as, and its reports move with it', () => {
  const plan = planOrgCampaigns({
    sends: [
      {
        hostId: 'site-a',
        id: 's1',
        data: { subject: 'Hi', status: 'sent', stats: { sent: 3 } },
        reports: [{ id: 'links', data: { links: {} } }],
      },
    ],
    nowMs: NOW,
  })
  const [send] = plan.sends
  assert.equal(send.data.hostId, 'site-a')
  assert.deepEqual(send.data.visibleTo, ['host:site-a'])
  assert.equal(send.reports.length, 1)
  assert.deepEqual(
    plan.deletes.map((d) => d.kind),
    ['campaignReports', 'campaigns'],
    'the report is removed before its parent',
  )
})

test('a send mid-flight under the old code is deferred, not split', () => {
  const plan = planOrgCampaigns({
    sends: [{ hostId: 'site-a', id: 's1', data: { status: 'sending' }, reports: [] }],
    nowMs: NOW,
  })
  assert.equal(plan.sends.length, 0)
  assert.equal(plan.deletes.length, 0)
  assert.deepEqual(plan.deferred, [{ kind: 'send', id: 's1', hostId: 'site-a', reason: 'sending' }])
})

test('an id held by two sites is refused and left where it is', () => {
  const plan = planOrgCampaigns({
    containers: [
      { hostId: 'site-a', id: 'dup', data: { name: 'A' } },
      { hostId: 'site-b', id: 'dup', data: { name: 'B' } },
    ],
    sends: [
      { hostId: 'site-a', id: 'dup-send', data: {}, reports: [] },
      { hostId: 'site-b', id: 'dup-send', data: {}, reports: [] },
    ],
    nowMs: NOW,
  })
  assert.equal(plan.containers.length, 0)
  assert.equal(plan.sends.length, 0)
  assert.equal(plan.deletes.length, 0)
  assert.deepEqual(
    plan.refused.map((r) => [r.kind, r.id, r.hostIds]),
    [
      ['container', 'dup', ['site-a', 'site-b']],
      ['send', 'dup-send', ['site-a', 'site-b']],
    ],
  )
})

test('a seed fixture two demo brands share is re-keyed per site, not refused', () => {
  const plan = planOrgCampaigns({
    sends: [
      { hostId: 'demo-dental', id: 'seed-campaign-1', data: { status: 'sent' }, reports: [] },
      { hostId: 'demo-legal', id: 'seed-campaign-1', data: { status: 'sent' }, reports: [] },
    ],
    nowMs: NOW,
  })
  assert.equal(plan.refused.length, 0)
  assert.deepEqual(
    plan.sends.map((s) => [s.id, s.data.hostId, s.data.seedHostId]),
    [
      ['seed-campaign-1-demo-dental', 'demo-dental', 'demo-dental'],
      ['seed-campaign-1-demo-legal', 'demo-legal', 'demo-legal'],
    ],
  )
  // The site copies are deleted by the id they actually have.
  assert.deepEqual(
    plan.deletes.map((d) => [d.hostId, d.id]),
    [
      ['demo-dental', 'seed-campaign-1'],
      ['demo-legal', 'seed-campaign-1'],
    ],
  )
})

test('a seed fixture only one site holds keeps its id', () => {
  const plan = planOrgCampaigns({
    sends: [{ hostId: 'demo', id: 'seed-campaign', data: {}, reports: [] }],
    nowMs: NOW,
  })
  assert.equal(plan.sends[0].id, 'seed-campaign')
  assert.equal(plan.sends[0].data.seedHostId, undefined)
})

test('sequence rollups ADD to what the org copy has counted since', () => {
  const plan = planOrgCampaigns({
    sequenceReports: [
      { hostId: 'site-a', id: 'c1', data: { byOutcome: { enrolled: 4, sent: 10 }, updatedAtMs: 5 } },
    ],
    orgSequenceReports: new Map([['c1', { byOutcome: { enrolled: 1, replied: 2 }, updatedAtMs: 9 }]]),
    nowMs: NOW,
  })
  assert.deepEqual(plan.sequenceReports[0].data.byOutcome, { enrolled: 5, sent: 10, replied: 2 })
  assert.equal(plan.sequenceReports[0].data.updatedAtMs, 9)
})

test('a second run over a moved org plans nothing', () => {
  const plan = planOrgCampaigns({ nowMs: NOW })
  for (const key of ['containers', 'sends', 'sequenceReports', 'archives', 'deletes']) {
    assert.equal(plan[key].length, 0, key)
  }
})

test('helpers', () => {
  assert.equal(isValidScope(['org']), true)
  assert.equal(isValidScope(['host:a', 'host:b']), true)
  assert.equal(isValidScope([]), false)
  assert.equal(isValidScope(undefined), false)
  assert.equal(isValidScope(['host:']), false)
  assert.equal(archiveIdFor('campaigns', 'h', 's'), 'campaigns~h~s')
  assert.deepEqual(addOutcomes({ a: 1 }, { a: 2, b: 'x' }), { a: 3 })
})
