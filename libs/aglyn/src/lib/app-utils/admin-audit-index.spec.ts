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
import {
  registerPluginActivityActions,
  resetPluginActivityActionsForTests,
} from '../plugin-manager/plugin-activity-actions'
import {
  ADMIN_AUDIT_ACCESS_ACTIONS,
  ADMIN_AUDIT_SEARCH_TOKEN_LIMIT,
  adminAuditIndexFields,
  adminAuditSearchTokens,
  withAdminAuditIndex,
} from './admin-audit-index'
import { nameSearchToken } from './name-search'

/*
 * The worked examples the backfill's `--self-test` asserts too
 * (`tools/scripts/lib/admin-audit-index.fixtures.json`), so the script that
 * restamps old rows cannot write a token or a group the writers and the
 * query do not use. The fixture's `groups` stand in for the registry here;
 * `apps/console/specs/admin-audit-action-groups.spec.ts` holds them to the
 * real one.
 */
interface Fixture {
  groups: Array<{ id: string; codes: string[]; prefixes: string[]; accessActions: string[] }>
  accessActions: string[]
  cases: Array<{
    name: string
    entry: Record<string, unknown>
    expected: {
      actionGroup: string
      kind: 'access' | 'change'
      targetKind: string
      targetHostId: string | null
      searchTokens: string[]
    }
  }>
}

const fixture = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', '..', '..', 'tools', 'scripts', 'lib', 'admin-audit-index.fixtures.json'),
    'utf8',
  ),
) as Fixture

beforeAll(() => {
  resetPluginActivityActionsForTests()
  for (const group of fixture.groups) {
    registerPluginActivityActions({
      pluginId: group.id,
      group: {
        id: group.id,
        label: group.id,
        staffAuditPrefixes: group.prefixes,
        staffAuditAccessActions: group.accessActions,
      },
      actions: group.codes.map((key) => ({ key, label: key, scope: 'staff' as const })),
    })
  }
})

afterAll(() => resetPluginActivityActionsForTests())

describe('adminAuditIndexFields', () => {
  it.each(fixture.cases.map((entry) => [entry.name, entry] as const))(
    '%s',
    (_name, { entry, expected }) => {
      expect(adminAuditIndexFields(entry)).toEqual(expected)
    },
  )

  it('finds a code by any word in it, and an address by its domain', () => {
    const tokens = adminAuditSearchTokens({
      action: 'org.override',
      actorEmail: 'jane@acme.com',
    })
    for (const typed of ['override', 'org.override', 'acme', 'jane@acme', 'jane']) {
      expect(tokens).toContain(nameSearchToken(typed))
    }
  })

  it('never stores more than the cap', () => {
    const note = Array.from({ length: 300 }, (_unused, at) => `w${at}-z${at}`).join(' ')
    expect(adminAuditSearchTokens({ action: 'x.y', note })).toHaveLength(
      ADMIN_AUDIT_SEARCH_TOKEN_LIMIT,
    )
  })

  it('the fixture copies the core read list the kind is decided by', () => {
    expect([...fixture.accessActions].sort()).toEqual([...ADMIN_AUDIT_ACCESS_ACTIONS].sort())
  })

  it('keeps the row it stamps, adding only the stamped fields', () => {
    const at = new Date(0)
    const row = withAdminAuditIndex({ action: 'org.override', target: 'orgs/o1', at, before: { a: 1 } })
    expect(row).toMatchObject({ action: 'org.override', target: 'orgs/o1', at, before: { a: 1 } })
    expect(row.scope).toBeNull()
    expect(withAdminAuditIndex({ action: 'lockdown.set', scope: 'org' }).scope).toBe('org')
    expect(Object.keys(row).sort()).toEqual(
      [
        'action',
        'actionGroup',
        'at',
        'before',
        'kind',
        // On every row, null when the writer has none (AGL-3680).
        'scope',
        'searchTokens',
        'target',
        'targetHostId',
        'targetKind',
      ].sort(),
    )
  })
})
