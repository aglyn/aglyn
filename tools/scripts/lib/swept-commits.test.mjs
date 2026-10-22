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

// Self-test for the swept-file detector (AGL-2344).
//
// Every fixture is a REAL incident from this repo's history, with the real
// SHAs, because the value of this check is entirely in its precision: over
// 1200 commits it flags five, and all five are true positives. A fixture set
// of invented cases could not demonstrate that, and the failure mode of a
// commit-shaped heuristic is exactly a plausible-looking rule that fires on
// ordinary work.
//
// The negative cases matter as much as the positive ones. Deleting an old
// file, deleting a file your own issue added, and deleting a file your
// message names are all NORMAL, and a check that flags them gets ignored.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_WINDOW,
  findSweptFiles,
  formatReport,
  messageAccountsFor,
  overallExitCode,
} from './swept-commits.mjs'

/** Terse commit builder; oldest-to-newest order is the caller's job. */
function commit(sha, subject, { added = [], deleted = [], message } = {}) {
  return { sha, subject, message: message ?? subject, added, deleted }
}

// ── Incident 1: the AGL-2422 storage-backup guard, swept three times ───────
// 83c8fcea8 landed the guard; the next three commits each carried it
// backwards out of a stale working tree. 4599734b4 put it back.
const STORAGE_GUARD = 'cloud/storage-mirror-lifecycle.json'
const INCIDENT_ONE = [
  commit('83c8fcea8', 'feat(ops): the storage backup guard (AGL-2422)', {
    added: [STORAGE_GUARD, 'tools/scripts/lib/backup-copies.mjs'],
  }),
  commit(
    '54c9b066b',
    'feat(tenant,console): an author can describe a collection entry cover and an event cover (AGL-2418)',
    {
      deleted: [STORAGE_GUARD],
      added: ['libs/aglyn/src/lib/app-utils/media-metadata.ts'],
    },
  ),
]

// ── Incident 2: AGL-1890 reverting AGL-1993, confirmed by 9ee2252bd ────────
const INCIDENT_TWO = [
  commit(
    '67f35f3a3',
    'test(console): pin every staff action to the pool the person signs in to (AGL-1993)',
    {
      added: [
        'apps/console/utils/pooled-custom-token.ts',
        'apps/console/specs/sso-custom-token-stays-in-pool.spec.tsx',
      ],
    },
  ),
  commit(
    '38e61ed35',
    'fix(console): a cache module git called binary becomes readable (AGL-1890)',
    {
      deleted: [
        'apps/console/utils/pooled-custom-token.ts',
        'apps/console/specs/sso-custom-token-stays-in-pool.spec.tsx',
      ],
    },
  ),
]

// ── Incident 3: AGL-2444 sweeping AGL-2377's docs project ──────────────────
// The one this check FOUND rather than confirmed. Its body has a "REMOVED:"
// section about a permission key and says nothing about these five files.
const INCIDENT_THREE = [
  commit(
    '664e05d4d',
    'feat(docs): the docs app gets a test target (AGL-2377)',
    {
      added: [
        'apps/docs/jest.config.ts',
        'apps/docs/specs/error-beacon.spec.ts',
        'cloud/functions/project.json',
      ],
    },
  ),
  commit('a1b2c3d4e', 'chore: an unrelated commit in between (AGL-2400)', {
    added: ['x.ts'],
  }),
  commit(
    '4e0bdc729',
    'fix(console): every advertised org permission is enforced server-side (AGL-2444)',
    {
      deleted: [
        'apps/docs/jest.config.ts',
        'apps/docs/specs/error-beacon.spec.ts',
        'cloud/functions/project.json',
      ],
      message:
        'fix(console): every advertised org permission is enforced server-side (AGL-2444)\n\nREMOVED:\n\n- `marketing.manage`. Announcement bars, popups and campaigns live at\n  the site level.',
    },
  ),
]

describe('messageAccountsFor — the exemption, deliberately narrow', () => {
  it('excuses a deletion the message names by full path', () => {
    assert.equal(
      messageAccountsFor(
        'drops tools/scripts/old.mjs, unused',
        'tools/scripts/old.mjs',
      ),
      true,
    )
  })

  it('excuses a deletion the message names by basename', () => {
    assert.equal(
      messageAccountsFor('the old.mjs helper is gone', 'tools/scripts/old.mjs'),
      true,
    )
  })

  it('does NOT excuse a message that merely says it removed SOMETHING', () => {
    // Incident 3 in one assertion. A "REMOVED:" section about a permission
    // key must not cover five unrelated files.
    const message =
      'fix(console): permissions enforced (AGL-2444)\n\nREMOVED:\n\n- `marketing.manage`.'
    assert.equal(messageAccountsFor(message, 'apps/docs/jest.config.ts'), false)
  })

  it('refuses an empty path rather than matching everything', () => {
    assert.equal(messageAccountsFor('anything', ''), false)
    assert.equal(messageAccountsFor('anything', null), false)
  })
})

describe('findSweptFiles — the three real incidents', () => {
  it('CATCHES incident 1: AGL-2418 carrying AGL-2422 backwards', () => {
    const found = findSweptFiles(INCIDENT_ONE)
    assert.equal(found.length, 1)
    assert.equal(found[0].sha, '54c9b066b')
    assert.equal(found[0].issue, 'AGL-2418')
    assert.deepEqual(found[0].swept, [
      {
        path: 'cloud/storage-mirror-lifecycle.json',
        addedBy: '83c8fcea8',
        addedByIssue: 'AGL-2422',
        distance: 1,
      },
    ])
    assert.equal(overallExitCode(found), 1)
  })

  it('CATCHES incident 2: AGL-1890 reverting AGL-1993, both files', () => {
    const found = findSweptFiles(INCIDENT_TWO)
    assert.equal(found.length, 1)
    assert.equal(found[0].sha, '38e61ed35')
    assert.equal(found[0].swept.length, 2)
    assert.deepEqual(
      [...new Set(found[0].swept.map((s) => s.addedByIssue))],
      ['AGL-1993'],
    )
  })

  it('CATCHES incident 3 across an intervening commit', () => {
    const found = findSweptFiles(INCIDENT_THREE)
    assert.equal(found.length, 1)
    assert.equal(found[0].sha, '4e0bdc729')
    assert.equal(found[0].swept.length, 3)
    assert.deepEqual([...new Set(found[0].swept.map((s) => s.distance))], [2])
  })
})

describe('findSweptFiles — the normal things it must stay quiet about', () => {
  it('says nothing when a commit deletes a file its OWN issue added', () => {
    const history = [
      commit('aaa', 'feat(x): add a helper (AGL-100)', {
        added: ['libs/x/helper.ts'],
      }),
      commit('bbb', 'fix(x): fold the helper into the caller (AGL-100)', {
        deleted: ['libs/x/helper.ts'],
      }),
    ]
    assert.deepEqual(findSweptFiles(history), [])
  })

  it('says nothing when the message names the file it deletes', () => {
    const history = [
      commit('aaa', 'feat(x): add a helper (AGL-100)', {
        added: ['libs/x/helper.ts'],
      }),
      commit('bbb', 'chore(x): delete the dead libs/x/helper.ts (AGL-200)', {
        deleted: ['libs/x/helper.ts'],
      }),
    ]
    assert.deepEqual(findSweptFiles(history), [])
  })

  it('says nothing about deleting a file added BEYOND the window', () => {
    const history = [
      commit('aaa', 'feat(x): add (AGL-100)', { added: ['libs/x/old.ts'] }),
    ]
    for (let i = 0; i < DEFAULT_WINDOW + 2; i++)
      history.push(commit(`f${i}`, `chore: filler ${i} (AGL-9${i})`))
    history.push(
      commit('zzz', 'chore(x): tidy up (AGL-200)', {
        deleted: ['libs/x/old.ts'],
      }),
    )
    assert.deepEqual(findSweptFiles(history), [])
  })

  it('says nothing when the deleting commit carries no issue tag', () => {
    // Nothing to misattribute TO. Reported by neither rule.
    const history = [
      commit('aaa', 'feat(x): add a helper (AGL-100)', {
        added: ['libs/x/helper.ts'],
      }),
      commit('bbb', 'chore: routine sweep', { deleted: ['libs/x/helper.ts'] }),
    ]
    assert.deepEqual(findSweptFiles(history), [])
  })

  it('attributes to the NEAREST adder, not an older one', () => {
    const history = [
      commit('aaa', 'feat: first add (AGL-100)', { added: ['f.ts'] }),
      commit('bbb', 'chore: remove f.ts deliberately (AGL-100)', {
        deleted: ['f.ts'],
      }),
      commit('ccc', 'feat: re-add it (AGL-300)', { added: ['f.ts'] }),
      commit('ddd', 'fix: something else entirely (AGL-400)', {
        deleted: ['f.ts'],
      }),
    ]
    const found = findSweptFiles(history)
    assert.equal(found.length, 1)
    // ONE row for one deleted file. Reporting the older add as well would
    // blame AGL-100 for work it deliberately removed itself, two commits
    // before AGL-300 re-added it.
    assert.equal(found[0].swept.length, 1)
    assert.equal(found[0].swept[0].addedByIssue, 'AGL-300')
    assert.equal(found[0].swept[0].addedBy, 'ccc')
  })

  it('never reports the same deleted path twice', () => {
    const found = findSweptFiles(INCIDENT_THREE)
    const paths = found[0].swept.map((s) => s.path)
    assert.deepEqual(paths, [...new Set(paths)])
  })

  it('is quiet on an empty history rather than throwing', () => {
    assert.deepEqual(findSweptFiles([]), [])
    assert.deepEqual(findSweptFiles(null), [])
    assert.equal(overallExitCode([]), 0)
  })
})

describe('formatReport', () => {
  it('names both issues and refuses to recommend a rewrite', () => {
    const report = formatReport(findSweptFiles(INCIDENT_ONE), { scanned: 2 })
    assert.match(report, /54c9b066b {2}\[AGL-2418\]/)
    assert.match(
      report,
      /added 1 commit\(s\) earlier by 83c8fcea8 \[AGL-2422\]/,
    )
    assert.match(report, /DO NOT rewrite history/)
    assert.match(report, /4599734b4/)
  })

  it('says plainly that a row is a candidate', () => {
    assert.match(
      formatReport(findSweptFiles(INCIDENT_TWO), { scanned: 2 }),
      /CANDIDATE/,
    )
  })

  it('reports a clean scan without implying it found something', () => {
    assert.equal(
      formatReport([], { scanned: 500 }),
      'No swept files in 500 commit(s).',
    )
  })
})
