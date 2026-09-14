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
 * The staff audit page's action facet groups AI (AGL-2929).
 *
 * The page is a client component over live Firestore hooks and three
 * layouts, so this reads its SOURCE the way `table-footer-consistency` does
 * and pins the two facts that matter: the facet's grouping is the shared
 * catalog's — one function, imported, not a local re-statement of which
 * prefixes count as AI — and the grouping it imports files the AI-adjacent
 * audit actions under one group. The function's own truth table is in
 * `ai-activity-actions.spec.ts`; the group's members are re-asserted here
 * through the page's import so a drift in either is caught at the page.
 *
 * Since AGL-2940 the grouping is the plugin-declared catalog's: the page
 * imports the registry's grouping, and the AI catalog is one registration
 * in it, loaded here the way the page loads it — through the barrel.
 */

import { readFileSync } from 'node:fs'
// The plugins' declarations (AGL-2939), as the console loads them: the AI
// plugin's levers and activity codes come from its declaration, not core.
import { registerPluginDeclarations } from '../constants/plugins.declarations.generated'
import { join } from 'node:path'
import {
  pluginStaffAuditActionGroup as staffAuditActionGroup,
  pluginStaffAuditActionGroupLabel as staffAuditActionGroupLabel,
} from '@aglyn/aglyn'

const PAGE = readFileSync(
  join(__dirname, '..', 'app', '(app)', 'admin', 'audit', 'page.tsx'),
  'utf8',
)

beforeAll(() => registerPluginDeclarations())

describe('the audit page wires an Action facet through the shared catalog', () => {
  it('imports the grouping and its label from the registry, not a local prefix list', () => {
    expect(PAGE).toMatch(
      /import \{\s*pluginStaffAuditActionGroup as staffAuditActionGroup,\s*pluginStaffAuditActionGroupLabel as staffAuditActionGroupLabel,?\s*\} from '@aglyn\/aglyn'/,
    )
    expect(PAGE).not.toMatch(/['"]billing\.assistOverage\.['"]/)
  })

  it('derives the facet from the page in view and narrows the page by it', () => {
    expect(PAGE).toContain('staffAuditActionGroup(entry.action)')
    expect(PAGE).toMatch(/label="Action"/)
    expect(PAGE).toContain('staffAuditActionGroupLabel(option)')
    expect(PAGE).toMatch(
      /!actionGroup \|\| staffAuditActionGroup\(entry\.action\) === actionGroup/,
    )
  })

  it('files every AI row the staff log holds under the one group the menu labels AI', () => {
    const rows = [
      { action: 'billing.assistOverage.setHardCap' },
      { action: 'billing.assistOverage.setCap' },
      { action: 'platform.aiFreeSpend.paused' },
      { action: 'ai.job.output' },
      { action: 'org.override' },
      { action: 'billing.disputeOpened' },
    ]
    const groups = [...new Set(rows.map((row) => staffAuditActionGroup(row.action)))].sort()
    expect(groups).toEqual(['ai', 'billing', 'org'])
    expect(rows.filter((row) => staffAuditActionGroup(row.action) === 'ai')).toHaveLength(4)
    expect(groups.map(staffAuditActionGroupLabel)).toEqual(['AI', 'billing', 'org'])
  })
})
