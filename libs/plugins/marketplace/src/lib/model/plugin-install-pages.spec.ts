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

import { pluginConfigSchemaFromManifest } from '@aglyn/aglyn'
import { offeredPluginVersion } from '@aglyn/aglyn/app-utils/plugin-manifest'
import {
  installedPluginCaption,
  installPlanOutcome,
  manifestSettingsFields,
  manifestSettingsScreen,
  pluginOfferedVersion,
  pluginSiteSetSummary,
  pluginUpdateAll,
  pluginUpdatePrompt,
  pluginUpdateStatus,
  resolveOrgInstallSummary,
  resolveUninstallTargets,
  staleSites,
  uninstallImpactView,
} from './marketplace-catalog'
import { resolveUpdateState } from './update-state'

/**
 * The rules the plugin pages share with the native apps (`marketplace-catalog.ts`, replayed from
 * function-cases.generated.json) say what the console's own functions say.
 */
describe('what a plugin page says about its installs', () => {
  const pins = [
    null,
    {},
    { listingId: 'l1', version: '1.0.0' },
    { listingId: 'l1', version: '2.0.0' },
    { listingId: 'l1', version: 4 },
    { listingId: 'l1', version: '1.0.0-beta' },
    { listingId: 'l1' },
    { version: '1.0.0' },
    { installedFrom: { listingId: 'l1', version: '1.1.0' }, version: '0.1' },
    { marketplace: { listingId: 'l1', version: '1.0.0' } },
    { source: { listingId: 'l1', version: '1.5.0' } },
  ]
  const offers = [
    { latestApprovedVersion: '1.0.0' },
    { latestApprovedVersion: '1.2.0' },
    { latestApprovedVersion: 4 },
    { latestApprovedVersion: '' },
    {},
    null,
  ]
  const revocations = [null, { versions: [] as string[] }, { versions: ['1.2.0'] }, { versions: 'all' as const }]

  it('compares an installed plugin with its offer as the console does', () => {
    for (const pin of pins) {
      for (const offer of offers) {
        for (const revocation of revocations) {
          const console_ = resolveUpdateState(pin as never, offer as never, 'plugin', revocation as never)
          const offered = pluginOfferedVersion(offer?.latestApprovedVersion, revocation?.versions)
          expect({ pin, offer, revocation, status: pluginUpdateStatus(pin, offered) }).toEqual({ pin, offer, revocation, status: console_ })
        }
      }
    }
  })

  it('offers what the console offers', () => {
    for (const offer of offers) {
      for (const revocation of revocations) {
        expect(pluginOfferedVersion(offer?.latestApprovedVersion, revocation?.versions)).toBe(offeredPluginVersion(offer, revocation as never))
      }
    }
  })

  it('says the same about a set of sites on every path the page takes', () => {
    const hosts = [
      { id: 'h1', label: 'Main site' },
      { id: 'h2', label: 'Blog' },
    ]
    const split = resolveOrgInstallSummary(hosts, { h1: { version: '1.2.0' }, h2: { version: '1.0.0' } }, null)
    expect(pluginSiteSetSummary(split, hosts.length)).toBe('Installed on 2 of 2 sites.')
    expect(staleSites(split.sites, '1.2.0').map((site) => site.hostId)).toEqual(['h2'])
    expect(pluginUpdateAll(split, staleSites(split.sites, '1.2.0'), '1.2.0')).toEqual({ label: 'Update all 1 to v1.2.0', target: '1 site', hostIds: ['h2'] })
    const wide = resolveOrgInstallSummary(hosts, {}, { version: '1.0.0' })
    expect(pluginSiteSetSummary(wide, hosts.length)).toBe('Installed for the whole organization (v1.0.0) — every site, including ones you add later.')
    expect(resolveUninstallTargets(wide, 'org').every((target) => !target.stillCovered)).toBe(true)
    expect(pluginUpdatePrompt({ name: 'Counter', latestVersion: '1.2.0', label: 'Blog', singleSite: true }).others).toBe('Other sites stay on the version they are running.')
    expect(installedPluginCaption({ version: '1.0.0', orgWide: false, siteLabels: ['Blog', 'Shop'] })).toBe('v1.0.0 · 2 sites')
  })

  it('asks for the typed word only where pages break or the check could not speak', () => {
    const targets = [{ hostId: 'h1', label: 'Main site', stillCovered: false }]
    const base = { name: 'Counter', scope: 'org' as const, pluginId: 'counter', targets, impact: null, failed: false }
    expect(uninstallImpactView(base).scanning).toBe(true)
    expect(uninstallImpactView({ ...base, failed: true }).needsAcknowledgement).toBe(true)
    expect(uninstallImpactView({ ...base, pluginId: '' }).needsAcknowledgement).toBe(true)
    const clean = { sites: [], losingSites: 1, placements: 0, affectedScreens: 0, truncated: false, dataSurvives: true }
    expect(uninstallImpactView({ ...base, impact: clean }).needsAcknowledgement).toBe(false)
    expect(uninstallImpactView({ ...base, impact: { ...clean, affectedScreens: 2 } }).alerts[0].tone).toBe('error')
  })

  it('words an install run as the console does', () => {
    expect(installPlanOutcome({ name: 'Counter', installed: 2, errors: [], orgWide: false, updating: true, version: '1.2.0' }).text).toBe(
      'Updated "Counter" to v1.2.0 on 2 sites',
    )
    expect(installPlanOutcome({ name: 'Counter', installed: 0, errors: [], orgWide: false, updating: false })).toEqual({ tone: 'error', text: 'Install failed' })
  })

  describe('a marketplace plugin\'s settings', () => {
    const manifests: unknown[] = [
      null,
      {},
      { config: {} },
      { config: { fields: [] } },
      { config: { fields: 'nope' } },
      {
        config: {
          fields: [
            { key: ' greeting ', label: '  Greeting ', type: 'string', description: 'Shown above the counter.' },
            { key: 'limit', type: 'number', min: 1, max: 10 },
            { key: 'limit', type: 'number' },
            { key: 'live', label: 'Live', type: 'boolean' },
            { key: 'mode', label: 'Mode', type: 'select', options: [{ value: 'a', label: 'A' }, { value: 3, label: 'Three' }, { value: 'b', label: 'B' }] },
            { key: 'empty', type: 'select', options: [] },
            { key: 'bad', type: 'colour' },
            { key: '', type: 'string' },
            { type: 'string' },
            { key: 'plain' },
          ],
          defaults: { greeting: 'Hello', limit: 99, live: 'yes', mode: 'b', plain: 4 },
        },
      },
      { config: { fields: Array.from({ length: 60 }, (_, index) => ({ key: `f${index}`, type: 'number', max: 5 })), defaults: { f0: 3 } } },
    ]

    it('declares the fields and starting values the console reads off a manifest', () => {
      for (const manifest of manifests) {
        const core = pluginConfigSchemaFromManifest('counter', manifest)
        const ported = manifestSettingsFields(manifest)
        expect({ manifest, fields: ported?.fields, defaults: ported?.defaults }).toEqual({ manifest, fields: core?.fields, defaults: core?.defaults })
      }
    })

    it('draws one form field for each, saved where the console saves it', () => {
      expect(manifestSettingsScreen('', 'Counter', manifests[5])).toBeNull()
      expect(manifestSettingsScreen('counter', 'Counter', {})).toBeNull()
      const screen = manifestSettingsScreen('counter', 'Counter', manifests[5]) as {
        id: string
        constants: { defaults: Record<string, unknown> }
        load: { settings: { doc: string } }
        blocks: Array<{ fields: Array<Record<string, unknown>>; submit: { write: { doc: string; fields: Record<string, string> } } }>
      }
      expect(screen.id).toBe('marketplace.pluginSettings.counter')
      expect(screen.load.settings.doc).toBe('orgs/{org.id}/pluginSettings/counter')
      expect(screen.blocks[0].submit.write.doc).toBe('orgs/{org.id}/pluginSettings/counter')
      expect(screen.blocks[0].fields.map((field) => [field['key'], field['kind']])).toEqual([
        ['greeting', 'text'],
        ['limit', 'number'],
        ['live', 'toggle'],
        ['mode', 'select'],
        ['plain', 'text'],
      ])
      expect(screen.blocks[0].fields[1]['help']).toBe('Between 1 and 10.')
      expect(Object.keys(screen.blocks[0].submit.write.fields)).toEqual(['greeting', 'limit', 'live', 'mode', 'plain', 'updatedBy'])
      expect(screen.constants.defaults).toEqual({ greeting: 'Hello', limit: 10, live: false, mode: 'b', plain: '' })
    })
  })
})
