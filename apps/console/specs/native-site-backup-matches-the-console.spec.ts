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
import { resolveOrgEntitlements } from '@aglyn/aglyn'

/**
 * The native Backup & restore screens call the routes and plan gate the
 * console's `SiteBackupCard` uses: `/api/hosts/export` (a download, or
 * `list: true` for the catalog), `/api/hosts/import` with the actions the
 * package client sends, and the `siteExport` feature.
 */
const text = readFileSync(
  join(__dirname, '../../../libs/native/screens/site.screens.json'),
  'utf8',
)

// The import wizard's screens live in their own file (`site-import.screens.json`).
const importText = readFileSync(
  join(__dirname, '../../../libs/native/screens/site-import.screens.json'),
  'utf8',
)

describe('native site backup and restore', () => {
  it('gates on a feature the entitlements route returns', () => {
    const { features } = resolveOrgEntitlements({ plan: 'pro' } as never)
    expect(Object.keys(features)).toContain('siteExport')
    expect(text).toContain('data.ent.features.siteExport')
  })

  it('sends the import actions the package client sends', () => {
    for (const action of ['plan', 'apply', 'undoPlan', 'undo']) {
      expect(importText).toContain(`"action": "${action}"`)
    }
    expect(importText).toContain('"url": "/api/hosts/import"')
    expect(text).toContain('"url": "/api/hosts/export"')
  })
})
