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
  listPluginConsoleCrons,
  pluginConsoleCronScheduledJobs,
  resetPluginConsoleCronsForTests,
} from '@aglyn/aglyn/plugin-manager/plugin-console-crons'
import {
  listPluginOrgErasers,
  resetPluginOrgErasersForTests,
} from '@aglyn/aglyn/plugin-manager/plugin-org-erasure'
import {
  listPluginPersonErasers,
  resetPluginPersonErasersForTests,
} from '@aglyn/aglyn/plugin-manager/plugin-person-erasure'
import {
  listPluginUserErasers,
  resetPluginUserErasersForTests,
} from '@aglyn/aglyn/plugin-manager/plugin-user-erasure'
import { registerOutreachConsoleServerDeclarations } from './declarations.console-server'

/**
 * Outreach's console-only declarations (AGL-2978): the workspace eraser and
 * the account eraser (AGL-3106) are in place once the console boots,
 * registered once however often boot runs, and the tenant runtime's manifest
 * never names them.
 */

const REPO_ROOT = join(__dirname, '../../../../..')

beforeEach(() => {
  resetPluginOrgErasersForTests()
  resetPluginUserErasersForTests()
  resetPluginPersonErasersForTests()
  resetPluginConsoleCronsForTests()
})

describe('registerOutreachConsoleServerDeclarations (AGL-2978)', () => {
  it('registers the workspace and account erasers under the plugin, once', () => {
    registerOutreachConsoleServerDeclarations()
    registerOutreachConsoleServerDeclarations()
    expect(listPluginOrgErasers()).toEqual(['outreach'])
    expect(listPluginUserErasers()).toEqual(['outreach'])
  })

  it('registers them again after the registries are reset', () => {
    registerOutreachConsoleServerDeclarations()
    resetPluginOrgErasersForTests()
    resetPluginUserErasersForTests()
    registerOutreachConsoleServerDeclarations()
    expect(listPluginOrgErasers()).toEqual(['outreach'])
    expect(listPluginUserErasers()).toEqual(['outreach'])
  })

  it('declares the send and sync jobs on the console tick, and the person eraser, once (AGL-2981)', () => {
    registerOutreachConsoleServerDeclarations()
    registerOutreachConsoleServerDeclarations()
    expect(listPluginConsoleCrons().map((job) => [job.pluginId, job.id])).toEqual([
      ['outreach', 'outreach-send'],
      ['outreach', 'outreach-sync'],
    ])
    expect(listPluginPersonErasers()).toEqual(['outreach'])
    // Each job has its own row on /api/health/crons, saying what stops with it.
    for (const row of pluginConsoleCronScheduledJobs()) {
      expect(row).toMatchObject({ cron: '*/15 * * * *', runner: 'cloud-scheduler', graceMinutes: 45 })
      expect(row.drives.length).toBeGreaterThan(40)
    }
  })

  it('declares without loading the runtime: the jobs and the eraser import it when they first run', () => {
    const source = readFileSync(join(__dirname, 'declarations.console-server.ts'), 'utf8')
    expect(source).not.toMatch(/^import[^\n]*from '\.\/runtime\//m)
    expect(source).toContain("import('./runtime/send-job')")
    expect(source).toContain("import('./runtime/sync-job')")
  })

  it('is called by the console’s server declarations manifest and by no tenant manifest', () => {
    const call = "(await import('@aglyn/plugins-outreach/declarations.console-server')).registerOutreachConsoleServerDeclarations()"
    const read = (path: string) => readFileSync(join(REPO_ROOT, path), 'utf8')
    expect(read('apps/console/constants/plugins.declarations.server.generated.ts')).toContain(call)
    expect(read('apps/tenant/utils/plugins.declarations.server.generated.ts')).not.toContain('plugins-outreach')
  })
})
