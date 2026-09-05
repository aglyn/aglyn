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

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  PLUGIN_ID_RENAMES,
  planHostUpdate,
  planOrgUpdate,
  pluginSettingsTarget,
  renamePluginIds,
} from './plugin-id-rename.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..', '..')

describe('renamePluginIds', () => {
  it('replaces a retired id and leaves the rest in place', () => {
    assert.deepEqual(renamePluginIds(['bookings', 'contacts', 'data']), [
      'bookings',
      'crm',
      'data',
    ])
  })

  it('answers null for a list that is already current', () => {
    assert.equal(renamePluginIds(['bookings', 'crm']), null)
    assert.equal(renamePluginIds([]), null)
    assert.equal(renamePluginIds(undefined), null)
    assert.equal(renamePluginIds('contacts'), null)
  })

  it('folds a list that carried both spellings into one entry', () => {
    assert.deepEqual(renamePluginIds(['crm', 'contacts']), ['crm'])
    assert.deepEqual(renamePluginIds(['contacts', 'crm']), ['crm'])
  })

  it('keeps marketplace listing ids untouched', () => {
    assert.deepEqual(renamePluginIds(['acme-widgets', 'contacts']), [
      'acme-widgets',
      'crm',
    ])
  })
})

describe('document plans', () => {
  it('patches only the org field that changed', () => {
    assert.deepEqual(planOrgUpdate({ enabledPlugins: ['contacts'] }), {
      enabledPlugins: ['crm'],
    })
    assert.equal(planOrgUpdate({ enabledPlugins: ['crm'] }), null)
    assert.equal(planOrgUpdate({}), null)
  })

  it('patches whichever host lists changed, and nothing else', () => {
    assert.deepEqual(
      planHostUpdate({ disabledPlugins: ['contacts'], enabledPlugins: ['accounts'] }),
      { disabledPlugins: ['crm'] },
    )
    assert.deepEqual(planHostUpdate({ enabledPlugins: ['contacts'] }), {
      enabledPlugins: ['crm'],
    })
    assert.equal(planHostUpdate({ disabledPlugins: ['commerce'] }), null)
  })

  it('moves a settings document only under a retired id', () => {
    assert.equal(pluginSettingsTarget('contacts'), 'crm')
    assert.equal(pluginSettingsTarget('crm'), null)
    assert.equal(pluginSettingsTarget('commerce'), null)
  })
})

describe('the rename has completed and the runtime alias is retired (AGL-2614)', () => {
  const source = readFileSync(
    join(REPO_ROOT, 'libs/aglyn/src/lib/plugin-manager/enabled-plugins.ts'),
    'utf8',
  )

  it('the runtime declares no alias table', () => {
    // The alias was the half that made the deploy safe; once the backfill
    // reported zero documents on the old id it became a second name nothing
    // writes and every reader honors. A table returning here is a new rename
    // in flight, and its pair belongs in `PLUGIN_ID_RENAMES` too.
    assert.doesNotMatch(source, /LEGACY_PLUGIN_IDS/)
  })

  it('the seam reads an id as itself', () => {
    assert.match(
      source,
      /export function canonicalPluginId\(pluginId: string\): string \{\s*return pluginId\s*\}/,
    )
  })

  it('the table still records the rename this script performed', () => {
    assert.deepEqual({ ...PLUGIN_ID_RENAMES }, { contacts: 'crm' })
  })
})
