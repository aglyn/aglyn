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
 * The Action group stamped on an audit row cannot drift from the registry
 * (AGL-3321).
 *
 * Each `adminAudit` row stores the group its action files under, asked of the
 * plugin activity registry as the row is written (`withAdminAuditIndex`), and
 * the audit page queries that stored field. Rows written BEFORE a plugin
 * declared a code or a `staffAuditPrefixes` entry carry the group the old
 * registry gave them — the namespace, typically — so the Action group filter
 * would miss them until the backfill restamps them.
 *
 * The backfill cannot load the registry; it reads a copy,
 * `tools/scripts/lib/admin-audit-index.fixtures.json`. This loads every
 * plugin's declarations the way the console does and fails when the copy and
 * the registry disagree. A plugin adding a code or a prefix is therefore red
 * here until the fixture names it, and the fixture changing is the signal to
 * re-run `tools/scripts/backfill-admin-audit-index.mjs --apply`.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { adminAuditActionGroup, adminAuditKind } from '@aglyn/aglyn/app-utils/admin-audit-index'
import { listPluginActivityRegistrations } from '@aglyn/aglyn/plugin-manager/plugin-activity-actions'
import { registerPluginDeclarations } from '../constants/plugins.declarations.generated'
import { registerPluginServerDeclarations } from '../constants/plugins.declarations.server.generated'

interface FixtureGroup {
  id: string
  codes: string[]
  prefixes: string[]
  accessActions: string[]
}

const fixture = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', 'tools', 'scripts', 'lib', 'admin-audit-index.fixtures.json'),
    'utf8',
  ),
) as { groups: FixtureGroup[] }

const sorted = (values: readonly string[]) => [...values].sort()

beforeAll(async () => {
  await registerPluginDeclarations()
  await registerPluginServerDeclarations()
})

describe('the stamped Action group matches the registry', () => {
  it('the fixture holds every registered group, code, prefix and read — no more, no fewer', () => {
    const registered = listPluginActivityRegistrations()
      .map(({ group, actions }) => ({
        id: group.id,
        codes: sorted(actions.map((action) => action.key)),
        prefixes: sorted(group.staffAuditPrefixes ?? []),
        accessActions: sorted(group.staffAuditAccessActions ?? []),
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
    const copied = fixture.groups
      .map((group) => ({
        ...group,
        codes: sorted(group.codes),
        prefixes: sorted(group.prefixes),
        accessActions: sorted(group.accessActions),
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
    expect(registered).toEqual(copied)
  })

  it('every registered code and prefix stamps the group the fixture gives it', () => {
    const disagreements: string[] = []
    for (const group of fixture.groups) {
      for (const code of group.codes) {
        if (adminAuditActionGroup(code) !== group.id) disagreements.push(code)
      }
      for (const prefix of group.prefixes) {
        const action = `${prefix}anything`
        if (adminAuditActionGroup(action) !== group.id) disagreements.push(action)
      }
    }
    expect(disagreements).toEqual([])
  })

  it('every read a plugin declares is stamped an access', () => {
    const misfiled = fixture.groups
      .flatMap((group) => group.accessActions)
      .filter((action) => adminAuditKind(action) !== 'access')
    expect(misfiled).toEqual([])
  })
})
