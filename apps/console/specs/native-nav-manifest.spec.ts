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
 * The native apps' navigation is held to the console's (AGL-3943).
 *
 * `NATIVE_NAV_MANIFEST` (`@aglyn/aglyn/app-utils/native-nav`) is what both
 * shells draw. Nothing used to keep the apps' sidebar in step with the
 * console: rows came from each plugin's `order:` number, under their own
 * words. This spec reads the console's OWN tabs, hub sections, setup and
 * admin sections and plugin declarations (every plugin reached through the
 * generated manifest, as an app spec must) and holds the manifest to them:
 *
 * - every row and section says the console's word for the place it opens;
 * - every console tab is placed: a row, a section, or a named elsewhere;
 * - every workspace-scope row is a real organization-level console surface;
 * - every Setup, Admin, workspace settings, Team and Billing section is in a
 *   settings mode;
 * - every screen is one a plugin declares, a core screen spec, a site
 *   platform screen or a shell destination, and every plugin id is real;
 * - one icon per idea, and every Material icon is one the Kotlin kit draws.
 */

import { readdirSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import {
  listConsoleNavItems,
  listConsoleOrgNavItems,
  listConsoleWidgets,
  resetPluginServicesForTests,
} from '@aglyn/aglyn'
import type {
  NativeNavConsoleRef,
  NativeNavList,
  NativeNavManifest,
  NativeNavRow,
} from '@aglyn/aglyn/app-utils/native-nav'
import hostNavTabItems from '@aglyn/console-ui/host-nav-tabs'
import orgNavTabItems from '@aglyn/console-ui/org-nav-tabs'
import { CONSOLE_PLUGIN_MANIFEST } from '../constants/plugins.client.generated'
import { setupSections } from '../app/(app)/[orgSlug]/hosts/[host]/setup/setup-sections'
import { DOCS_HELP_TOPICS } from '../constants/docs-help.generated'

const ROOT = resolve(__dirname, '../../..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

/**
 * Rows gated on a plugin other than the one that owns their screen, by screen,
 * each for a reason its native-nav module states (AGL-3966): `sms` is
 * infrastructure with no switch, so its Customer texts row shows where the
 * store is on, and the switch lives on commerce's Customer notifications card.
 * Anything not named here is gated on its own plugin.
 */
const GATED_ON_ANOTHER_PLUGIN: Readonly<Record<string, string>> = { 'sms.texts': 'commerce' }
const screenOwner = (screen: string) => screen.split('.')[0]

/**
 * The manifest the apps read: the core's lists with every plugin's rows
 * placed, as `generate:native-contracts` assembles it (its `--check` keeps
 * the file current). Read from disk, so this app spec imports no plugin.
 */
const NATIVE_NAV_MANIFEST = (
  JSON.parse(read('libs/native/contracts/contracts.generated.json')) as {
    NATIVE_NAV_MANIFEST: NativeNavManifest
  }
).NATIVE_NAV_MANIFEST

const plugins = (
  JSON.parse(read('plugins.config.json')) as {
    plugins: Array<{ id: string; mobile?: { contributes?: { screens?: string[] } } }>
  }
).plugins

/** `{ label }` by Route name, read from a hub layout's own section list. */
function layoutSections(path: string, pattern: RegExp): Map<string, string> {
  const out = new Map<string, string>()
  for (const match of read(path).matchAll(pattern)) out.set(match[1], match[2])
  expect(out.size).toBeGreaterThan(0)
  return out
}

const LAYOUTS = 'apps/console/app/(app)/[orgSlug]'
const SECTION_CALL = /section\(\s*Route\.(\w+),\s*'([^']+)'/g
const SECTION_OBJECT = /buildRoute\(Route\.(\w+), \{ orgSlug \}\)[\s\S]*?label: '([^']+)'/g

let console_: {
  hostTabs: Map<string, string>
  hostPluginTabs: Map<string, string>
  hostPluginSections: Map<string, string>
  orgTabs: Map<string, string>
  orgPluginTabs: Map<string, string>
  orgPluginSections: Map<string, string>
  setup: Map<string, string>
  hostAdmin: Map<string, string>
  orgSettings: Map<string, string>
  team: Map<string, string>
  billing: Map<string, string>
  widgets: Map<string, string>
  /** The help page each plugin hub's header names, by `{scope}:{href}`. */
  hubDocs: Map<string, string>
}

/** A docs topic and anchor as the console's help links them. */
function docsPath(topic: string | undefined, anchor?: string): string | undefined {
  const entry = topic ? (DOCS_HELP_TOPICS as Record<string, { path: string }>)[topic] : undefined
  return entry ? `${entry.path}${anchor ?? ''}` : undefined
}

beforeAll(async () => {
  resetPluginServicesForTests()
  for (const entry of CONSOLE_PLUGIN_MANIFEST) {
    const register = (entry.register as Record<string, string> | undefined)?.console
    if (!register) continue
    const loaded = (await entry.load()) as Record<string, () => void>
    loaded[register]()
  }
  const staticHost = hostNavTabItems('o', 'h', [], { hostAdmin: true })
  const navItems = listConsoleNavItems()
  const orgItems = listConsoleOrgNavItems().map((entry) => entry.navItem)
  const widgets = new Map<string, string>()
  for (const slot of ['hostAnalytics', 'orgBillingUsage', 'consoleTopBar']) {
    for (const { widget } of listConsoleWidgets(slot)) {
      widgets.set(`${slot}/${widget.widgetId}`, widget.title ?? '')
    }
  }
  console_ = {
    hostTabs: new Map(staticHost.map((tab) => [tab.id, tab.label])),
    hostPluginTabs: new Map(navItems.map((item) => [item.href, item.label])),
    hostPluginSections: new Map(
      navItems.flatMap((item) =>
        (item.sections ?? []).map((section) => [`${item.href}/${section.id}`, section.label] as const),
      ),
    ),
    orgTabs: new Map(orgNavTabItems('o').map((tab) => [tab.id, tab.label])),
    orgPluginTabs: new Map(orgItems.map((item) => [item.href, item.label])),
    orgPluginSections: new Map(
      orgItems.flatMap((item) =>
        (item.sections ?? []).map((section) => [`${item.href}/${section.id}`, section.label] as const),
      ),
    ),
    setup: new Map(setupSections('o', 'h').map((section) => [section.id, section.label])),
    hostAdmin: layoutSections(`${LAYOUTS}/hosts/[host]/admin/(sections)/layout.tsx`, SECTION_CALL),
    orgSettings: layoutSections(`${LAYOUTS}/settings/(sections)/layout.tsx`, SECTION_CALL),
    team: layoutSections(`${LAYOUTS}/team/(sections)/layout.tsx`, SECTION_OBJECT),
    billing: layoutSections(`${LAYOUTS}/billing/(sections)/layout.tsx`, SECTION_OBJECT),
    widgets,
    hubDocs: new Map(
      [
        ...navItems.map((item) => ['host', item] as const),
        ...orgItems.map((item) => ['org', item] as const),
      ].flatMap(([scope, item]) => {
        const header = (item as { header?: { docsTopic?: string; docsAnchor?: string } }).header
        const path = docsPath(header?.docsTopic, header?.docsAnchor)
        return path ? [[`${scope}:${item.href}`, path] as const] : []
      }),
    ),
  }
}, 120_000)

const lists = NATIVE_NAV_MANIFEST.lists
const list = (id: NativeNavList['id']) => lists.find((entry) => entry.id === id) as NativeNavList
const rowsOf = (entry: NativeNavList) => entry.groups.flatMap((group) => group.rows)
const allRows = lists.flatMap(rowsOf)
const allRefs = (): NativeNavConsoleRef[] => [
  ...allRows.flatMap((row) => [row.console, ...(row.sections ?? []).map((section) => section.console)]),
  ...NATIVE_NAV_MANIFEST.elsewhere.map((entry) => entry.console),
]
const has = (ref: NativeNavConsoleRef) =>
  allRefs().some((entry) => entry.surface === ref.surface && entry.id === ref.id)

/** The console's word for a ref, or undefined when the console has no such place. */
function consoleLabel(ref: NativeNavConsoleRef): string | undefined {
  switch (ref.surface) {
    case 'hostTab':
      return console_.hostTabs.get(ref.id)
    case 'hostPluginTab':
      return console_.hostPluginTabs.get(ref.id)
    case 'hostPluginSection':
      return console_.hostPluginSections.get(ref.id)
    case 'orgTab':
      return console_.orgTabs.get(ref.id)
    case 'orgPluginTab':
      return console_.orgPluginTabs.get(ref.id)
    case 'orgPluginSection':
      return console_.orgPluginSections.get(ref.id)
    case 'setupSection':
      return console_.setup.get(ref.id)
    case 'hostAdminSection':
      return console_.hostAdmin.get(ref.id)
    case 'orgSettingsSection':
      return console_.orgSettings.get(ref.id)
    case 'teamSection':
      return console_.team.get(ref.id)
    case 'billingSection':
      return console_.billing.get(ref.id)
    case 'consoleWidget':
      return console_.widgets.get(ref.id)
    default:
      return undefined
  }
}

describe('the native nav manifest says the console’s words', () => {
  it('CONTROL: the console was read, plugins and all', () => {
    expect(console_.hostPluginTabs.get('/products')).toBe('Products')
    expect(console_.orgPluginTabs.get('/crm')).toBe('CRM')
    expect(console_.hostAdmin.get('HOST_ADMIN_DANGER')).toBe('Danger zone')
    expect(console_.team.get('MANAGE_TEAM_ACTIVITY')).toBe('Recent activity')
    expect(console_.billing.get('MANAGE_BILLING_SETTINGS')).toBe('Settings')
  })

  it.each(
    allRows
      .flatMap((row) => [
        { what: row.id, label: row.consoleLabel ?? row.label, ref: row.console },
        ...(row.sections ?? []).map((section) => ({
          what: `${row.id}/${section.id}`,
          label: section.label,
          ref: section.console,
        })),
      ])
      .filter(({ ref }) => ref.surface !== 'shell' && ref.surface !== 'nativeOnly'),
  )('$what is labeled as the console labels $ref.surface $ref.id', ({ label, ref }) => {
    expect(consoleLabel(ref)).toBe(label)
  })

  it('a native-only row is named as its screen is named on both platforms', () => {
    for (const row of allRows.filter((entry) => entry.console.surface === 'nativeOnly')) {
      const plugin = GATED_ON_ANOTHER_PLUGIN[row.screen] ? screenOwner(row.screen) : (row.pluginId as string)
      expect(read(`libs/plugins/${plugin}/src/android/src/commonMain/kotlin/com/aglyn/plugins/${plugin}/Register.kt`)).toContain(`"${row.label}"`)
      const swift = readdirSync(join(ROOT, `libs/plugins/${plugin}/src/ios/Sources`))[0]
      expect(read(`libs/plugins/${plugin}/src/ios/Sources/${swift}/Register.swift`)).toContain(`"${row.label}"`)
    }
  })
})

describe('every console place is placed', () => {
  it('every console tab is a row, a section or a named elsewhere', () => {
    const missing = [
      ...[...console_.hostTabs.keys()].map((id) => ({ surface: 'hostTab' as const, id })),
      ...[...console_.hostPluginTabs.keys()].map((id) => ({ surface: 'hostPluginTab' as const, id })),
      ...[...console_.orgTabs.keys()].map((id) => ({ surface: 'orgTab' as const, id })),
      ...[...console_.orgPluginTabs.keys()].map((id) => ({ surface: 'orgPluginTab' as const, id })),
    ].filter((ref) => !has(ref))
    expect(missing).toEqual([])
  })

  it('every elsewhere names a place the console really has', () => {
    for (const { console: ref } of NATIVE_NAV_MANIFEST.elsewhere) {
      expect([ref, consoleLabel(ref)]).toEqual([ref, expect.any(String)])
    }
  })

  it('every Setup, site Admin, workspace settings, Team and Billing section is in a settings mode', () => {
    const refs = (entry: NativeNavList) => rowsOf(entry).map((row) => `${row.console.surface}:${row.console.id}`)
    const site = refs(list('siteSettings'))
    const workspace = refs(list('workspaceSettings'))
    expect([...console_.setup.keys()].filter((id) => !site.includes(`setupSection:${id}`))).toEqual([])
    expect([...console_.hostAdmin.keys()].filter((id) => !site.includes(`hostAdminSection:${id}`))).toEqual([])
    for (const [surface, ids] of [
      ['orgSettingsSection', console_.orgSettings],
      ['teamSection', console_.team],
      ['billingSection', console_.billing],
    ] as const) {
      // The org settings hub's own Plugins section is the Plugins tab's page.
      const unplaced = [...ids.keys()].filter(
        (id) => !workspace.includes(`${surface}:${id}`) && id !== 'ORG_SETTINGS_PLUGINS',
      )
      expect(unplaced).toEqual([])
    }
  })

  it('every workspace-scope row is a real organization-level console surface', () => {
    for (const row of rowsOf(list('workspace'))) {
      if (row.console.surface === 'shell') continue
      expect([row.id, row.console.surface]).toEqual([row.id, expect.stringMatching(/^org(Tab|PluginTab)$/)])
      expect([row.id, consoleLabel(row.console)]).toEqual([row.id, row.label])
      for (const section of row.sections ?? []) {
        expect([row.id, section.console.surface]).toEqual([row.id, 'orgPluginSection'])
      }
    }
  })
})

describe('every plugin’s rows are assembled', () => {
  it('every plugin with a native-nav module is a part of the assembled manifest', () => {
    const config = JSON.parse(read('tools/scripts/native-contracts.json')) as {
      assembled: { NATIVE_NAV_MANIFEST: { parts: string[] } }
    }
    const modules = readdirSync(join(ROOT, 'libs/plugins'))
      .map((dir) => `libs/plugins/${dir}/src/lib/native-nav.ts`)
      .filter((path) => {
        try {
          read(path)
          return true
        } catch {
          return false
        }
      })
    expect([...config.assembled.NATIVE_NAV_MANIFEST.parts].sort()).toEqual(modules.sort())
  })

  it('a plugin’s rows name that plugin', () => {
    const config = JSON.parse(read('tools/scripts/native-contracts.json')) as {
      assembled: { NATIVE_NAV_MANIFEST: { parts: string[] } }
    }
    for (const part of config.assembled.NATIVE_NAV_MANIFEST.parts) {
      const plugin = part.split('/')[2]
      const gatedElsewhere = Object.entries(GATED_ON_ANOTHER_PLUGIN)
        .filter(([screen]) => screenOwner(screen) === plugin)
        .map(([, gate]) => gate)
      for (const match of read(part).matchAll(/pluginId: '([^']+)',\n\s+order/g)) {
        expect([part, gatedElsewhere.includes(match[1]) ? plugin : match[1]]).toEqual([part, plugin])
      }
    }
  })
})

describe('every row opens something real', () => {
  const declared = new Set(plugins.flatMap((plugin) => plugin.mobile?.contributes?.screens ?? []))
  const coreScreens = new Set(
    readdirSync(join(ROOT, 'libs/native/screens'))
      .filter((file) => file.endsWith('.screens.json'))
      .flatMap((file) => {
        const spec = JSON.parse(read(`libs/native/screens/${file}`)) as { screens?: unknown }
        const screens = spec.screens ?? spec
        return Array.isArray(screens)
          ? screens.map((screen) => (screen as { id: string }).id)
          : Object.keys(screens as object)
      }),
  )
  /** The site platform's screens, as BOTH platforms declare them. */
  const siteScreens = (() => {
    const kotlin = new Set(
      [
        'libs/native/kotlin/site/src/commonMain/kotlin/com/aglyn/site/sites/SitesScreens.kt',
        'libs/native/kotlin/site/src/commonMain/kotlin/com/aglyn/site/pages/PagesScreens.kt',
        'libs/native/kotlin/site/src/commonMain/kotlin/com/aglyn/site/media/MediaScreens.kt',
        'libs/native/kotlin/site/src/commonMain/kotlin/com/aglyn/site/setup/SetupScreens.kt',
        'libs/native/kotlin/site/src/commonMain/kotlin/com/aglyn/site/content/ContentScreens.kt',
        'libs/native/kotlin/site/src/commonMain/kotlin/com/aglyn/site/artifacts/Artifacts.kt',
      ].flatMap((path) => [...read(path).matchAll(/"(site\.[a-z]+)"/g)].map((match) => match[1])),
    )
    const apple = read('libs/native/apple/Sources/AglynSite/SitePlatform.swift')
    return { kotlin, apple }
  })()
  const pluginIds = new Set(plugins.map((plugin) => plugin.id))

  const opens = (screen: string): boolean => {
    if (screen.startsWith('shell.')) return NATIVE_NAV_MANIFEST.shellScreens.includes(screen)
    if (screen.startsWith('core.')) return coreScreens.has(screen)
    if (screen.startsWith('site.')) return siteScreens.kotlin.has(screen)
    return declared.has(screen)
  }

  it.each(
    allRows.flatMap((row: NativeNavRow) => [
      { what: row.id, screen: row.screen, pluginId: row.pluginId },
      ...(row.sections ?? []).map((section) => ({
        what: `${row.id}/${section.id}`,
        screen: section.screen,
        pluginId: section.pluginId ?? row.pluginId,
      })),
      ...(row.actions ?? []).map((action) => ({
        what: `${row.id}:${action.id}`,
        screen: action.screen,
        pluginId: row.pluginId,
      })),
    ]),
  )('$what opens $screen, which exists', ({ screen, pluginId }) => {
    expect([screen, opens(screen)]).toEqual([screen, true])
    if (pluginId) expect(pluginIds.has(pluginId)).toBe(true)
    // A plugin's screen belongs to that plugin.
    if (pluginId && !screen.startsWith('core.') && !screen.startsWith('site.') && !screen.startsWith('shell.')) {
      const owner = plugins.find((plugin) => plugin.mobile?.contributes?.screens?.includes(screen))
      const expected = GATED_ON_ANOTHER_PLUGIN[screen] === pluginId ? screenOwner(screen) : pluginId
      expect([screen, owner?.id]).toEqual([screen, expected])
    }
  })

  it('the site platform screens are Apple’s too', () => {
    for (const screen of siteScreens.kotlin) {
      if (screen === 'site.components' || screen === 'site.layouts' || screen === 'site.templates') continue
      expect([screen, siteScreens.apple.includes(`"${screen}"`)]).toEqual([screen, true])
    }
  })
})

describe('one icon per idea', () => {
  const kotlinIcons = new Set(
    ['Icons.kt', 'IconsContent.kt'].flatMap((file) =>
      [...read(`libs/native/kotlin/ui/src/commonMain/kotlin/com/aglyn/ui/${file}`).matchAll(/"([a-z_0-9]+)" to/g)].map(
        (match) => match[1],
      ),
    ),
  )
  const icons = allRows.flatMap((row) => [
    { id: row.id, icon: row.icon },
    ...(row.actions ?? []).map((action) => ({ id: `action:${action.id}`, icon: action.icon })),
  ])

  it('every Material icon is one the Kotlin kit draws', () => {
    expect(icons.filter(({ icon }) => !kotlinIcons.has(icon.android)).map(({ id, icon }) => `${id}: ${icon.android}`)).toEqual([])
  })

  it('the same idea draws the same picture in every list', () => {
    const byId = new Map<string, string>()
    for (const { id, icon } of icons) {
      const seen = byId.get(id)
      const key = `${icon.apple}|${icon.android}`
      if (seen) expect([id, key]).toEqual([id, seen])
      byId.set(id, key)
    }
  })

  it('two ideas in one list never share a picture', () => {
    for (const entry of lists) {
      const rows = rowsOf(entry)
      for (const platform of ['apple', 'android'] as const) {
        const owners = new Map<string, string>()
        for (const row of rows) {
          const owner = owners.get(row.icon[platform])
          if (owner && owner !== row.id) throw new Error(`${entry.id}: ${row.id} and ${owner} share ${row.icon[platform]}`)
          owners.set(row.icon[platform], row.id)
        }
      }
    }
  })

  it('the workspace and site sidebars share no picture between two ideas', () => {
    const rows = [...rowsOf(list('workspace')), ...rowsOf(list('site'))]
    for (const platform of ['apple', 'android'] as const) {
      const owners = new Map<string, string>()
      for (const row of rows) {
        const owner = owners.get(row.icon[platform])
        expect([row.icon[platform], owner ?? row.id]).toEqual([row.icon[platform], row.id])
        owners.set(row.icon[platform], row.id)
      }
    }
  })
})


/**
 * The help each place's console page offers (AGL-3943): a plugin hub's
 * header (`docsTopic`, `docsAnchor`), a settings hub's `help` prop, and the
 * Sites list's. The registry is the console's own, `docs-help.generated.ts`.
 */
describe('every row’s help is the console’s help for that place', () => {
  const LAYOUT_HELP = /help=\{\{\s*topic: '(\w+)',\s*anchor: '([^']+)'/
  const layoutDocs = (path: string) => {
    const match = read(path).match(LAYOUT_HELP)
    return match ? docsPath(match[1], match[2]) : undefined
  }
  const HUB_LAYOUTS: Partial<Record<NativeNavConsoleRef['surface'], string>> = {
    teamSection: `${LAYOUTS}/team/(sections)/layout.tsx`,
    billingSection: `${LAYOUTS}/billing/(sections)/layout.tsx`,
    orgSettingsSection: `${LAYOUTS}/settings/(sections)/layout.tsx`,
    hostAdminSection: `${LAYOUTS}/hosts/[host]/admin/(sections)/layout.tsx`,
  }
  const ORG_TAB_PAGES: Record<string, string> = {
    'nav-tab-org-sites': `${LAYOUTS}/hosts/page.tsx`,
  }

  /** What the console's help for a row's place says, when the console has a readable one. */
  function expected(ref: NativeNavConsoleRef): string | undefined {
    switch (ref.surface) {
      case 'hostPluginTab':
        return console_.hubDocs.get(`host:${ref.id}`)
      case 'orgPluginTab':
        return console_.hubDocs.get(`org:${ref.id}`)
      case 'hostPluginSection':
        return console_.hubDocs.get(`host:/${ref.id.split('/')[1]}`)
      case 'orgPluginSection':
        return console_.hubDocs.get(`org:/${ref.id.split('/')[1]}`)
      case 'orgTab':
        return ORG_TAB_PAGES[ref.id] ? layoutDocs(ORG_TAB_PAGES[ref.id]) : undefined
      default:
        return HUB_LAYOUTS[ref.surface] ? layoutDocs(HUB_LAYOUTS[ref.surface] as string) : undefined
    }
  }

  it('CONTROL: the console’s help was read', () => {
    expect(console_.hubDocs.get('org:/crm')).toBe('/content-and-data/crm/overview#at-the-organization-level')
    expect(console_.hubDocs.get('host:/crm')).toBe('/content-and-data/crm/overview')
  })

  it.each(
    lists.flatMap((entry) =>
      rowsOf(entry).map((row) => ({ what: `${entry.id}/${row.id}`, row })),
    ),
  )('$what carries the console’s help for its place', ({ row }) => {
    expect(row.docs).toBe(expected(row.console))
    for (const section of row.sections ?? []) {
      expect([section.id, section.docs]).toEqual([section.id, row.docs])
    }
  })
})

/**
 * The Create new menu offers what the console offers from that scope
 * (AGL-3943), each item named as the console's own create action names it.
 * The evidence is the console's button, read from the file that draws it.
 */
describe('the Create new menu is the console’s create actions', () => {
  const create = NATIVE_NAV_MANIFEST.create ?? []
  const items = create.flatMap((entry) => entry.items.map((item) => ({ scope: entry.scope, item })))
  const EVIDENCE: Record<string, [string, string]> = {
    'workspace/site': ['apps/console/app/(app)/[orgSlug]/hosts/page.tsx', "'Create site'"],
    'workspace/contact': ['libs/plugins/crm/src/lib/components/contacts-section.tsx', "'New contact'"],
    'workspace/emailTemplate': ['libs/plugins/email/src/lib/components/org-email-templates-card.tsx', "'New template'"],
    'site/page': ['apps/console/app/(app)/[orgSlug]/hosts/[host]/screens/page.tsx', "'Create new page'"],
    'site/product': ['libs/plugins/commerce/src/lib/components/console/products-hub-card.component.tsx', "'Add product'"],
    'site/draftOrder': ['libs/plugins/commerce/src/lib/components/console/host-orders-card.component.tsx', "'Draft order'"],
    'site/service': ['libs/plugins/bookings/src/lib/components/bookings-console-page.tsx', "'Add service'"],
    'site/event': ['libs/plugins/events-calendar/src/lib/components/events-console-page.tsx', "'Add event'"],
    'site/form': ['libs/plugins/forms/src/lib/components/host-forms-card.component.tsx', "'Create Form'"],
    'site/contact': ['libs/plugins/crm/src/lib/components/contacts-section.tsx', "'New contact'"],
  }

  it('CONTROL: both scopes have a menu', () => {
    expect(create.map((entry) => entry.scope).sort()).toEqual(['site', 'workspace'])
  })

  it('every item is a create action the console draws, and every one listed here is offered', () => {
    expect(items.map(({ scope, item }) => `${scope}/${item.id}`).sort()).toEqual(Object.keys(EVIDENCE).sort())
    for (const [key, [file, button]] of Object.entries(EVIDENCE)) {
      expect([key, read(file).includes(button)]).toEqual([key, true])
    }
  })

  it.each(items.map(({ scope, item }) => ({ what: `${scope}/${item.id}`, item })))(
    '$what opens a real screen from a real console place, in its plugin',
    ({ item }) => {
      expect([item.console, consoleLabel(item.console)]).toEqual([item.console, expect.any(String)])
      const owner = plugins.find((plugin) => plugin.mobile?.contributes?.screens?.includes(item.screen))
      if (item.pluginId) expect([item.screen, owner?.id]).toEqual([item.screen, item.pluginId])
      else expect(item.screen.startsWith('site.')).toBe(true)
    },
  )

  it('each menu draws one picture per item, all of them in the Kotlin kit', () => {
    const kotlin = new Set(
      ['Icons.kt', 'IconsContent.kt'].flatMap((file) =>
        [...read(`libs/native/kotlin/ui/src/commonMain/kotlin/com/aglyn/ui/${file}`).matchAll(/"([a-z_0-9]+)" to/g)].map(
          (match) => match[1],
        ),
      ),
    )
    for (const entry of create) {
      for (const platform of ['apple', 'android'] as const) {
        const pictures = entry.items.map((item) => item.icon[platform])
        expect(new Set(pictures).size).toBe(pictures.length)
      }
      expect(entry.items.filter((item) => !kotlin.has(item.icon.android)).map((item) => item.id)).toEqual([])
    }
  })
})
