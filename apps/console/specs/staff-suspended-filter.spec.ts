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
 * The staff Organizations, Sites and Users lists each filter Suspended
 * (AGL-3416), and each answer is honest: the Firestore lists by an equality
 * on a flag every document carries and that is exact when the query runs,
 * the Auth list by the flag that actually suspends an account.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { listFilterGridColumns } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { missingListQueryIndexes } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { matchListFilter } from '@aglyn/shared-ui-jsx/const/list-filter'
import {
  ORG_LIST_FILTER_FIELDS,
  ORG_LIST_FILTER_HEADERS,
  ORG_SUSPENDED_FILTER_OPTIONS,
} from '../utils/org-list-query'
import {
  STAFF_SITE_LIST_FILTER_FIELDS,
  STAFF_SITE_LIST_FILTER_HEADERS,
  STAFF_SITE_LIST_FILTER_OPTIONS,
} from '../utils/staff-site-list-query'
import {
  USER_LIST_FILTER_FIELDS,
  USER_LIST_FILTER_HEADERS,
  USER_LIST_FILTER_OPTIONS,
} from '../utils/list-filters'
import {
  SUSPENDED_FIELD,
  asksAboutSuspension,
  settleLapsedSuspensions,
  suspensionInForce,
} from '../utils/server/suspended-flag'

const REPO_ROOT = join(__dirname, '..', '..', '..')
const INDEX_FILE = JSON.parse(
  readFileSync(join(REPO_ROOT, 'cloud', 'firebase-firestore.indexes.json'), 'utf8'),
)

describe('every list offers Suspended as a picked answer the panel can reach', () => {
  it.each([
    ['Organizations', ORG_LIST_FILTER_FIELDS, { suspended: ORG_SUSPENDED_FILTER_OPTIONS }, ORG_LIST_FILTER_HEADERS, 'suspended'],
    ['Sites', STAFF_SITE_LIST_FILTER_FIELDS, STAFF_SITE_LIST_FILTER_OPTIONS, STAFF_SITE_LIST_FILTER_HEADERS, 'suspended'],
    ['Users', USER_LIST_FILTER_FIELDS, USER_LIST_FILTER_OPTIONS, USER_LIST_FILTER_HEADERS, 'disabled'],
  ] as const)('%s', (_list, fields, options, headers, column) => {
    const [suspended] = listFilterGridColumns([], fields, options, headers).filter(
      (entry) => entry.field === column,
    )
    expect(suspended).toMatchObject({
      headerName: 'Suspended',
      type: 'singleSelect',
      filterable: true,
    })
    expect(suspended.filterOperators?.map((operator) => operator.value)).toEqual(['is'])
    expect(
      ((suspended as { valueOptions?: Array<{ value: string }> }).valueOptions ?? []).map(
        (option) => option.value,
      ),
    ).toEqual(['true', 'false'])
  })

  it('offers Custom domain on the Sites list the same way', () => {
    const [custom] = listFilterGridColumns(
      [],
      STAFF_SITE_LIST_FILTER_FIELDS,
      STAFF_SITE_LIST_FILTER_OPTIONS,
    ).filter((entry) => entry.field === 'hasCustomDomain')
    expect(custom).toMatchObject({ type: 'singleSelect', filterable: true })
  })

  it('the Users list matches the Auth flag, both ways', () => {
    const suspended = { disabled: true }
    const active = { disabled: false }
    const only = { field: 'disabled', op: 'equals', value: 'true' }
    const none = { field: 'disabled', op: 'equals', value: 'false' }
    expect(matchListFilter(suspended, USER_LIST_FILTER_FIELDS, only)).toBe(true)
    expect(matchListFilter(active, USER_LIST_FILTER_FIELDS, only)).toBe(false)
    expect(matchListFilter(active, USER_LIST_FILTER_FIELDS, none)).toBe(true)
  })
})

describe('the stored flag means "in force now"', () => {
  const NOW = 1_800_000_000_000

  it('reads the suspended* family as the rules and the tenant do', () => {
    expect(suspensionInForce(undefined, undefined, NOW)).toBe(false)
    expect(suspensionInForce(null, NOW + 1, NOW)).toBe(false)
    // No expiry is indefinite.
    expect(suspensionInForce(NOW - 1, undefined, NOW)).toBe(true)
    expect(suspensionInForce({ seconds: 1 }, null, NOW)).toBe(true)
    // An expiry reached or passed ends it.
    expect(suspensionInForce(NOW - 10, NOW, NOW)).toBe(false)
    expect(suspensionInForce(NOW - 10, NOW + 1, NOW)).toBe(true)
    // A malformed expiry keeps the lock.
    expect(suspensionInForce(NOW - 10, 'next tuesday', NOW)).toBe(true)
  })

  it('settles only when a request asks about it', () => {
    expect(asksAboutSuspension([{ field: 'plan' }])).toBe(false)
    expect(asksAboutSuspension([{ field: SUSPENDED_FIELD }])).toBe(true)
  })

  it('clears every lapsed flag, page by page, and nothing else', async () => {
    type Doc = { id: string; suspended: boolean; suspendedUntilMs?: number }
    const docs: Doc[] = [
      { id: 'lapsed-1', suspended: true, suspendedUntilMs: NOW - 5 },
      { id: 'lapsed-2', suspended: true, suspendedUntilMs: NOW },
      { id: 'timed', suspended: true, suspendedUntilMs: NOW + 5 },
      { id: 'open', suspended: true },
      { id: 'clear', suspended: false, suspendedUntilMs: NOW - 5 },
    ]
    const asked: string[] = []
    const query = (clauses: Array<[string, string, unknown]>) => ({
      where: (path: string, op: string, value: unknown) => query([...clauses, [path, op, value]]),
      limit: () => ({
        get: async () => {
          asked.push(clauses.map(([path, op]) => `${path} ${op}`).join(' & '))
          const matched = docs.filter((doc) =>
            clauses.every(([path, op, value]) => {
              const stored = (doc as Record<string, unknown>)[path]
              if (op === '==') return stored === value
              if (op === '<=') return typeof stored === 'number' && stored <= (value as number)
              throw new Error(`unexpected ${op}`)
            }),
          )
          return {
            empty: matched.length === 0,
            size: matched.length,
            docs: matched.map((doc) => ({ ref: doc })),
          }
        },
      }),
    })
    const collection = {
      ...query([]),
      firestore: {
        batch: () => {
          const writes: Array<[Doc, Record<string, unknown>]> = []
          return {
            update: (ref: Doc, data: Record<string, unknown>) => writes.push([ref, data]),
            commit: async () => {
              for (const [ref, data] of writes) Object.assign(ref, data)
            },
          }
        },
      },
    }
    const result = await settleLapsedSuspensions(collection as never, NOW)
    expect(result).toEqual({ cleared: 2, bounded: false })
    expect(docs.filter((doc) => doc.suspended).map((doc) => doc.id)).toEqual(['timed', 'open'])
    expect(asked[0]).toBe('suspended == & suspendedUntilMs <=')
  })

  it('has the composite the settle query needs, on both collections', () => {
    const settle = {
      fields: [
        { fieldPath: 'suspended', order: 'ASCENDING' as const },
        { fieldPath: 'suspendedUntilMs', order: 'ASCENDING' as const },
      ],
    }
    expect(missingListQueryIndexes(INDEX_FILE, 'orgs', [settle])).toEqual([])
    expect(missingListQueryIndexes(INDEX_FILE, 'hosts', [settle])).toEqual([])
  })
})

describe('every writer of the suspension family writes the flag with it', () => {
  /*
   * The family is written by the lockdown core alone; a second writer that
   * forgot the flag would leave the Suspended filter answering for a lock
   * that is not there, or missing one that is.
   */
  const WRITERS = [
    'apps/console/utils/server/org-lockdown.ts',
    // `consoleDomains/{name}` — a different collection with its own
    // `suspendedAt`, which no staff list filters by.
    'libs/tenant/data/admin/src/lib/server/console-domains.ts',
  ]

  it('names every source that writes `suspendedAt`', () => {
    const found = execFileSync(
      'git',
      ['grep', '-l', '-E', 'suspendedAt:[[:space:]]*(FieldValue|firebaseAdmin|Date[.]now)', '--', 'apps', 'libs'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      .filter((path) => !/\.spec\.tsx?$|\/specs\//.test(path))
    expect(found.sort()).toEqual([...WRITERS].sort())
  })

  it('the lockdown core writes the flag at each of its four writes', () => {
    const source = readFileSync(join(REPO_ROOT, WRITERS[0]), 'utf8')
    const family = source.match(/suspendedAt: (FieldValue\.\w+\(\)|Date\.now\(\))/g) ?? []
    const flag = source.match(/\[SUSPENDED_FIELD\]:/g) ?? []
    expect(family).toHaveLength(4)
    expect(flag).toHaveLength(family.length)
  })
})
