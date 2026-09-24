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

// The submission-scope backfill's decisions (AGL-3303).
//
//   node --test tools/scripts/lib/submission-scope-backfill.test.mjs

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  planSiteScope,
  planSubmissionScope,
  routeStampsScope,
  rulesFreezeScope,
  SCOPE_FIELDS,
  siteOrgId,
} from './submission-scope-backfill.mjs'

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
)
const read = (path) => readFileSync(join(REPO_ROOT, path), 'utf8')

describe('which org a site stamps', () => {
  it('is the org both documents name', () => {
    assert.deepEqual(siteOrgId({ hostOrgId: 'org-a', indexOrgId: 'org-a' }), {
      orgId: 'org-a',
    })
  })

  it('is whichever one names an org when the other is silent, host document first', () => {
    // The submit route's own order, so a backfilled row and a new one agree.
    assert.deepEqual(siteOrgId({ hostOrgId: 'org-a', indexOrgId: null }), {
      orgId: 'org-a',
    })
    assert.deepEqual(siteOrgId({ hostOrgId: undefined, indexOrgId: 'org-a' }), {
      orgId: 'org-a',
    })
  })

  it('is refused, never guessed, when the two name different orgs', () => {
    // A wrong stamp files a site's submissions into a stranger's Inbox.
    assert.deepEqual(siteOrgId({ hostOrgId: 'org-a', indexOrgId: 'org-b' }), {
      refused: 'orgs-disagree',
      hostOrgId: 'org-a',
      indexOrgId: 'org-b',
    })
  })

  it('is skipped for a site that belongs to no org — empty and malformed ids included', () => {
    for (const [hostOrgId, indexOrgId] of [
      [null, null],
      ['', ''],
      [42, { id: 'org-a' }],
    ]) {
      assert.deepEqual(siteOrgId({ hostOrgId, indexOrgId }), {
        skipped: 'no-org',
      })
    }
  })
})

describe('what one submission needs', () => {
  it('owns exactly the two scope fields and writes nothing else', () => {
    assert.deepEqual(SCOPE_FIELDS, ['orgId', 'hostId'])
    const plan = planSubmissionScope({
      submission: {
        formName: 'Contact',
        fields: { email: 'a@b.test' },
        read: false,
      },
      hostId: 'host-1',
      orgId: 'org-a',
    })
    assert.deepEqual(plan, {
      patch: { orgId: 'org-a', hostId: 'host-1' },
      corrected: false,
    })
    assert.deepEqual(Object.keys(plan.patch).sort(), [...SCOPE_FIELDS].sort())
  })

  it('leaves a row already carrying the right pair alone', () => {
    assert.equal(
      planSubmissionScope({
        submission: { orgId: 'org-a', hostId: 'host-1', read: true },
        hostId: 'host-1',
        orgId: 'org-a',
      }),
      null,
    )
  })

  it('completes a half-stamped row without calling it a correction', () => {
    assert.deepEqual(
      planSubmissionScope({
        submission: { orgId: 'org-a' },
        hostId: 'host-1',
        orgId: 'org-a',
      }),
      { patch: { orgId: 'org-a', hostId: 'host-1' }, corrected: false },
    )
    assert.deepEqual(
      planSubmissionScope({
        submission: { orgId: '', hostId: '' },
        hostId: 'host-1',
        orgId: 'org-a',
      }),
      { patch: { orgId: 'org-a', hostId: 'host-1' }, corrected: false },
    )
  })

  it('corrects a pair that disagrees with where the row lives, and says so', () => {
    // The pair is a fact about the document's path. A value that differs is
    // wrong by construction, whoever wrote it.
    assert.deepEqual(
      planSubmissionScope({
        submission: { orgId: 'org-stranger', hostId: 'host-1' },
        hostId: 'host-1',
        orgId: 'org-a',
      }),
      { patch: { orgId: 'org-a', hostId: 'host-1' }, corrected: true },
    )
    assert.equal(
      planSubmissionScope({
        submission: { orgId: 'org-a', hostId: 'host-elsewhere' },
        hostId: 'host-1',
        orgId: 'org-a',
      }).corrected,
      true,
    )
  })
})

describe('one site’s plan', () => {
  const rows = [
    { id: 's1', data: { formName: 'Contact' } },
    { id: 's2', data: { orgId: 'org-a', hostId: 'host-1' } },
    { id: 's3', data: { orgId: 'org-b', hostId: 'host-1' } },
    { id: 's4', data: {} },
  ]

  it('writes the rows that need it and counts the rest', () => {
    const plan = planSiteScope({
      hostId: 'host-1',
      orgId: 'org-a',
      submissions: rows,
    })
    assert.deepEqual(
      plan.writes.map((write) => write.id),
      ['s1', 's3', 's4'],
    )
    assert.equal(plan.read, 4)
    assert.equal(plan.alreadyStamped, 1)
    assert.equal(plan.corrected, 1)
    for (const write of plan.writes) {
      assert.deepEqual(write.patch, { orgId: 'org-a', hostId: 'host-1' })
    }
  })

  it('plans nothing on a second run', () => {
    const first = planSiteScope({
      hostId: 'host-1',
      orgId: 'org-a',
      submissions: rows,
    })
    const byId = new Map(first.writes.map((write) => [write.id, write.patch]))
    const applied = rows.map((row) => ({
      id: row.id,
      data: { ...row.data, ...(byId.get(row.id) ?? {}) },
    }))
    const second = planSiteScope({
      hostId: 'host-1',
      orgId: 'org-a',
      submissions: applied,
    })
    assert.equal(second.writes.length, 0)
    assert.equal(second.alreadyStamped, rows.length)
  })

  it('plans nothing for a site with no submissions', () => {
    assert.deepEqual(
      planSiteScope({ hostId: 'host-1', orgId: 'org-a', submissions: [] }),
      {
        writes: [],
        read: 0,
        alreadyStamped: 0,
        corrected: 0,
      },
    )
  })
})

describe('the tree the run is started from', () => {
  it('stamps the pair on every add in this checkout’s submit route', () => {
    assert.equal(
      routeStampsScope(read('apps/tenant/app/api/forms/submit/route.ts')),
      true,
    )
  })

  it('freezes the pair against the client in this checkout’s rules', () => {
    assert.equal(rulesFreezeScope(read('cloud/firebase-firestore.rules')), true)
  })

  it('refuses a route that does not stamp, or only mentions the stamp in a comment', () => {
    const unstamped = [
      "const ref = await hostRef.collection('formSubmissions').add({",
      '  formName: resolvedFormName,',
      '  read: false,',
      '})',
    ].join('\n')
    assert.equal(routeStampsScope(unstamped), false)
    const commented = [
      "const ref = await hostRef.collection('formSubmissions').add({",
      '  // orgId: submissionOrgId,',
      '  /* hostId, */',
      '  formName: resolvedFormName,',
      '})',
    ].join('\n')
    assert.equal(routeStampsScope(commented), false)
    const stamped = [
      "const ref = await hostRef.collection('formSubmissions').add({",
      '  ...(submissionOrgId ? { orgId: submissionOrgId } : {}),',
      '  hostId,',
      '  formName: resolvedFormName,',
      '})',
    ].join('\n')
    assert.equal(routeStampsScope(stamped), true)
  })

  it('refuses rules that leave the pair client-writable', () => {
    const rules = read('cloud/firebase-firestore.rules')
    // The catch-all's update list no longer names the collection: the
    // dedicated block narrows nothing under a looser sibling.
    const unlisted = rules.replace(
      /'forms',\n(\s*)'formSubmissions',\n/,
      "'forms',\n",
    )
    assert.notEqual(unlisted, rules, 'the fixture did not remove the name')
    assert.equal(rulesFreezeScope(unlisted), false)
    // The dedicated block re-grants more than `read`.
    const widened = rules.replace(
      ".hasOnly(['read'])",
      ".hasOnly(['read', 'orgId'])",
    )
    assert.notEqual(widened, rules, 'the fixture did not widen the block')
    assert.equal(rulesFreezeScope(widened), false)
  })
})
