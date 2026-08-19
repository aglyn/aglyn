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
 * Every quota a staff operator can WRITE must have somewhere that reads it
 * (AGL-2133) — the `enforced-somewhere` counterpart to AGL-1947's
 * `has-a-surface` sweep.
 *
 * `totalSiteSizeMb` is why this exists. It was declared on `OrgEntitlements`,
 * carried a value on all 8 plans, and had no gate, no meter and no alert
 * anywhere. What it DID have was a staff override field, because
 * `staff-org-actions`' `QUOTA_FIELDS` is derived from
 * `PLAN_ENTITLEMENTS.free` — the right design (AGL-1635: a new quota cannot
 * silently lose its control) with a cost nobody had priced: a RETIRED quota
 * cannot silently lose its control either.
 *
 * So a support engineer resolving a "this site is too big" ticket saw a field
 * named "Site size MB", raised it, got a successful write and an audit row,
 * and changed nothing. That is worse than the field being absent — a control
 * that reports success while doing nothing costs an investigation rather than
 * a click.
 *
 * ## Why a NON-COMMENT reader
 *
 * The naive check — "is the key mentioned outside the plan model?" — passes
 * for `totalSiteSizeMb` today, and passed on the day it was filed. Its three
 * surviving mentions are all prose: two explaining why its meter was deleted
 * and one explaining why its alert could never fire. A guard satisfied by the
 * comment recording that something is dead is a guard that certifies the
 * corpse. So a line whose code content is a comment does not count.
 *
 * This is a coverage sweep, not a proof of enforcement: it cannot tell a real
 * gate from a variable that is read and discarded. It catches the specific
 * failure it was built for — a writable field with nothing behind it at all.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLAN_ENTITLEMENTS } from '@aglyn/aglyn'

const REPO_ROOT = join(__dirname, '..', '..', '..')

/**
 * Where a READER may live. Excludes the plan model itself (a default is not a
 * reader), the staff dialog (the writable field is the thing under
 * suspicion), and every spec — a key exercised only by tests is a key nothing
 * in the product consults.
 */
const EXCLUDED = [
  'libs/aglyn/src/lib/app-utils/plan-entitlements.ts',
  'libs/aglyn/src/lib/foundation/definitions/org-billing.types.ts',
  'apps/console/components/staff-org-actions.component.tsx',
]

/**
 * Quotas with no reader BY DESIGN. A reason is mandatory — the point of the
 * sweep is that "we decided" is written down, not that the list is short.
 */
const EXEMPT: Record<string, string> = {}

/**
 * Strips comments from a source file so a mention inside prose cannot be
 * mistaken for a reader.
 *
 * Block comments first, then line comments. A `//` inside a string literal —
 * a URL — has its tail removed too, which is imprecise in exactly one
 * direction: it can only HIDE a match, never invent one, so the guard errs
 * strict. Line-by-line matching was tried first and is not enough: a JSX
 * `{​/* … *​/}` block's continuation lines carry no marker at all, and two of
 * the three `totalSiteSizeMb` comments are that shape.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ')
}

/**
 * Tracked source files where `key` appears OUTSIDE a comment.
 *
 * `git grep` narrows the candidates rather than deciding them, for AGL-1947's
 * reason: it honours `.gitignore`, so `.next/` build output — which carries
 * the whole plan model inlined and would satisfy this check for every key at
 * once — cannot count. The verdict is then taken from the file's own
 * comment-stripped text.
 */
function readerFiles(key: string): string[] {
  let output = ''
  try {
    output = execFileSync(
      'git',
      ['grep', '-l', '--', key, '--', 'apps', 'libs', 'tools'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
  } catch {
    // `git grep` exits 1 on no matches, which is a legitimate answer.
    return []
  }
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => /\.(tsx?|mts)$/.test(file))
    .filter((file) => !/\.spec\.tsx?$/.test(file))
    .filter((file) => !EXCLUDED.includes(file))
    .filter((file) =>
      withoutComments(readFileSync(join(REPO_ROOT, file), 'utf8')).includes(key),
    )
}

describe('every staff-writable quota has a non-comment reader (AGL-2133)', () => {
  // The same derivation `QUOTA_FIELDS` uses, so the two cannot disagree:
  // whatever the staff dialog offers is exactly what is swept here.
  const quotaKeys = Object.entries(PLAN_ENTITLEMENTS.free)
    .filter(([, value]) => typeof value === 'number')
    .map(([key]) => key)

  it('derives the quota set at all', () => {
    // A sweep that enumerates nothing passes vacuously, which is the failure
    // mode of every source guard.
    expect(quotaKeys.length).toBeGreaterThanOrEqual(20)
    expect(quotaKeys).toContain('hostLimit')
    expect(quotaKeys).toContain('bandwidthGb')
  })

  it('can tell a read key from an unread one', () => {
    // The instrument, checked before it is trusted. `hostLimit` is gated all
    // over the product; a key that does not exist is read nowhere. If both
    // answered the same, every assertion below would be meaningless.
    expect(readerFiles('hostLimit').length).toBeGreaterThan(0)
    expect(readerFiles('quotaKeyThatDoesNotExist')).toEqual([])
  })

  it('does not count a comment as a reader', () => {
    // The discrimination this guard turns on, proven directly rather than
    // asserted. `totalSiteSizeMb` is retired and its only surviving mentions
    // are the three comments recording why — so a raw grep finds it and this
    // filter must not.
    const raw = execFileSync(
      'git',
      ['grep', '-c', '--', 'totalSiteSizeMb', '--', 'apps', 'libs'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
    expect(raw.trim().length).toBeGreaterThan(0)
    expect(readerFiles('totalSiteSizeMb')).toEqual([])
  })

  it.each(
    Object.entries(PLAN_ENTITLEMENTS.free)
      .filter(([, value]) => typeof value === 'number')
      .map(([key]) => key),
  )('%s is read somewhere outside the plan model', (key) => {
    if (EXEMPT[key]) return
    const readers = readerFiles(key)
    expect(`${key}: ${readers.length ? 'read' : 'NO READER'}`).toBe(
      `${key}: read`,
    )
  })

  it('the retired key is gone from the plan model and the staff dialog', () => {
    for (const plan of Object.values(PLAN_ENTITLEMENTS)) {
      expect(plan).not.toHaveProperty('totalSiteSizeMb')
    }
    // `git grep` exits 1 with no output when nothing matches, so a throw IS
    // the pass here. Asserting on the caught state rather than on a string
    // keeps a future non-empty result from reading as success.
    let dialogMentions = 'still present'
    try {
      execFileSync(
        'git',
        [
          'grep',
          '--',
          'totalSiteSizeMb',
          '--',
          'apps/console/components/staff-org-actions.component.tsx',
        ],
        { cwd: REPO_ROOT, encoding: 'utf8' },
      )
    } catch {
      dialogMentions = 'gone'
    }
    expect(dialogMentions).toBe('gone')
  })
})
