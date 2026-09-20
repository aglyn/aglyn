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
 * Every first-party plugin declares exactly what its registrars register
 * (AGL-3116).
 *
 * The loaders place a plugin by its `contributes` declaration in
 * `plugins.config.json` and by nothing else: a console screen loads the
 * plugins that declare a slot it renders, and a published page the plugins
 * that declare a component it places. A registration the declaration omits
 * is therefore a surface that silently never loads, and one it declares and
 * never registers loads a plugin for nothing.
 *
 * So this runs every registrar the generated console manifest names, reads
 * what each one put in the registries, and compares it with the catalog.
 * The marketplace verifier does the same for a published bundle, statically;
 * here the registrars themselves run, so nothing is inferred.
 */

import {
  components,
  listConsoleExtensions,
  type ConsoleExtension,
  type PluginContributions,
} from '@aglyn/aglyn'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CONSOLE_PLUGIN_MANIFEST } from '../constants/plugins.client.generated'

const REPO_ROOT = resolve(__dirname, '../../..')

const catalog = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'plugins.config.json'), 'utf8'),
) as { plugins: Array<{ id: string; contributes?: PluginContributions }> }

const declared = new Map(
  catalog.plugins.map((plugin) => [plugin.id, plugin.contributes ?? {}]),
)

/** Console extension fields the shell draws on every screen. */
const SHELL_FIELDS = [
  'navItems',
  'orgNavItems',
  'providers',
  'staffPages',
  'dashboardCards',
  'settingsSections',
] as const

/** What a set of console extensions contributes, in the declaration's shape. */
function consoleContributions(extensions: readonly ConsoleExtension[]) {
  const slots = new Set<string>()
  const routes = new Set<string>()
  const orgRoutes = new Set<string>()
  let shell = false
  for (const extension of extensions) {
    for (const widget of extension.widgets ?? []) slots.add(widget.slot)
    for (const item of extension.navItems ?? []) routes.add(item.href)
    for (const item of extension.orgNavItems ?? []) orgRoutes.add(item.href)
    if (SHELL_FIELDS.some((field) => (extension[field] as unknown[] | undefined)?.length)) {
      shell = true
    }
  }
  return {
    slots: [...slots].sort(),
    routes: [...routes].sort(),
    orgRoutes: [...orgRoutes].sort(),
    shell,
  }
}

const sorted = (list: readonly string[] | undefined) => [...(list ?? [])].sort()

describe('first-party plugins declare what they register (AGL-3116)', () => {
  // The registries log every registration; the comparison is the output.
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
  })
  afterAll(() => {
    jest.restoreAllMocks()
  })

  it('names a declaration for every plugin in the manifest', () => {
    for (const entry of CONSOLE_PLUGIN_MANIFEST) {
      expect([entry.id, declared.has(entry.id)]).toEqual([entry.id, true])
    }
  })

  it.each(
    CONSOLE_PLUGIN_MANIFEST.filter(
      (entry) => entry.register['console'] || entry.register['staff'],
    ).map((entry) => [entry.id, entry] as const),
  )('%s declares the console surfaces its registrar registers', async (id, entry) => {
    const before = new Set(listConsoleExtensions().map((extension) => extension.pluginId))
    const mod = await entry.load()
    for (const surface of ['console', 'staff']) {
      const name = entry.register[surface]
      // Awaited, because a registrar that loads what the surface uses
      // returns a promise (AGL-3141).
      if (name) await (mod[name] as () => void | Promise<void>)()
    }
    // A registrar may register more than one extension — commerce registers
    // the User Accounts card under the `accounts` switch — and every one of
    // them loads with this plugin's code.
    const registered = listConsoleExtensions().filter(
      (extension) => extension.pluginId === id || !before.has(extension.pluginId),
    )
    const found = consoleContributions(registered)
    const own = declared.get(id)?.console ?? {}
    expect({ id, ...found }).toEqual({
      id,
      slots: sorted(own.slots),
      routes: sorted(own.routes),
      orgRoutes: sorted(own.orgRoutes),
      shell: Boolean(own.shell),
    })
  })

  it('declares the canvas components every site registrar registers', async () => {
    const owner = new Map<string, string>()
    for (const entry of CONSOLE_PLUGIN_MANIFEST) {
      const name = entry.register['site']
      if (!name) continue
      const before = new Set(Object.keys(components.schemas))
      const load = entry.loads?.['site'] ?? entry.load
      // Awaited, and called with no use context, so a registrar that can
      // narrow itself registers ALL of what it declares (AGL-3141).
      await ((await load())[name] as () => void | Promise<void>)()
      for (const componentId of Object.keys(components.schemas)) {
        if (!before.has(componentId)) owner.set(componentId, entry.id)
      }
    }
    // A feature bundle registers once `mui` has, so components that arrived
    // after their own registrar returned are attributed by the plugin id their
    // schema carries.
    for (const [componentId, schema] of Object.entries(components.schemas)) {
      if (!owner.has(componentId) && schema?.pluginId) owner.set(componentId, schema.pluginId)
    }
    const byPlugin = new Map<string, string[]>()
    for (const [componentId, pluginId] of owner) {
      byPlugin.set(pluginId, [...(byPlugin.get(pluginId) ?? []), componentId])
    }
    for (const entry of CONSOLE_PLUGIN_MANIFEST) {
      if (!entry.register['site']) continue
      expect({ id: entry.id, components: sorted(byPlugin.get(entry.id)) }).toEqual({
        id: entry.id,
        components: sorted(declared.get(entry.id)?.site?.components),
      })
    }
  })
})
