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
  listPluginActivityActions,
  listPluginActivityFilters,
  pluginActivityActionLabel,
  pluginActivityGroupForAction,
  pluginStaffAuditActionGroup,
  pluginStaffAuditActionGroupLabel,
  registerPluginActivityActions,
  resetPluginActivityActionsForTests,
} from './plugin-activity-actions'

const AI = {
  pluginId: 'ai',
  group: { id: 'ai', label: 'AI', staffAuditPrefixes: ['billing.assistOverage.'] },
  actions: [
    { key: 'ai.job.output', label: 'AI generated', scope: ['org', 'host'] as const },
    { key: 'ai.job.canceled', label: 'Canceled an AI generation', scope: 'org' as const },
  ],
}

const BACKUPS = {
  pluginId: 'acme-backups',
  group: { id: 'backups', label: 'Backups' },
  actions: [
    { key: 'backup.snapshot.taken', label: 'Took a backup', scope: 'host' as const },
  ],
}

beforeEach(() => resetPluginActivityActionsForTests())

describe('registerPluginActivityActions', () => {
  it('labels a declared code and answers nothing for prose', () => {
    registerPluginActivityActions(AI)
    expect(pluginActivityActionLabel('ai.job.output')).toBe('AI generated')
    expect(pluginActivityActionLabel('Saved the screen')).toBeUndefined()
    expect(pluginActivityActionLabel(undefined)).toBeUndefined()
    expect(pluginActivityGroupForAction('ai.job.canceled')?.id).toBe('ai')
  })

  it('a second, unrelated plugin gets its own chip and facet group', () => {
    registerPluginActivityActions(AI)
    registerPluginActivityActions(BACKUPS)
    expect(listPluginActivityFilters()).toEqual([
      { group: AI.group, actions: ['ai.job.output', 'ai.job.canceled'] },
      { group: BACKUPS.group, actions: ['backup.snapshot.taken'] },
    ])
    expect(listPluginActivityActions()).toHaveLength(3)
    expect(pluginStaffAuditActionGroup('backup.snapshot.taken')).toBe('backups')
    expect(pluginStaffAuditActionGroupLabel('backups')).toBe('Backups')
  })

  it('files the staff audit rows by code, then by prefix, then by namespace', () => {
    registerPluginActivityActions(AI)
    expect(pluginStaffAuditActionGroup('ai.job.output')).toBe('ai')
    expect(pluginStaffAuditActionGroup('billing.assistOverage.setCap')).toBe('ai')
    expect(pluginStaffAuditActionGroup('billing.disputeOpened')).toBe('billing')
    expect(pluginStaffAuditActionGroup('override')).toBe('override')
    expect(pluginStaffAuditActionGroup('')).toBe('')
    expect(pluginStaffAuditActionGroupLabel('ai')).toBe('AI')
    expect(pluginStaffAuditActionGroupLabel('billing')).toBe('billing')
  })

  it('re-registration by the owner replaces; a stolen code is refused', () => {
    registerPluginActivityActions(AI)
    registerPluginActivityActions({ ...AI, actions: [AI.actions[0]] })
    expect(listPluginActivityActions().map((action) => action.key)).toEqual([
      'ai.job.output',
    ])
    expect(() =>
      registerPluginActivityActions({
        ...BACKUPS,
        actions: [{ key: 'ai.job.output', label: 'x', scope: 'org' }],
      }),
    ).toThrow(/already declared by "ai"; refused "acme-backups"/)
    expect(() =>
      registerPluginActivityActions({ ...BACKUPS, pluginId: ' ' }),
    ).toThrow(/need a pluginId/)
  })

  it('reset forgets everything', () => {
    registerPluginActivityActions(AI)
    resetPluginActivityActionsForTests()
    expect(listPluginActivityFilters()).toEqual([])
  })
})
