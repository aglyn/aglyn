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
 * THE NATIVE APPS' NAVIGATION, AS DATA (AGL-3943).
 *
 * One manifest both shells draw (docs/mobile/native-navigation.md): the
 * sidebar for the whole workspace, the sidebar inside one site, and the two
 * settings modes (the workspace's, and the site's, which merges the
 * console's Setup and Admin). Zach chose the site's groups on 2026-10-18:
 * an Overview row, Starred, Website, Sell, Customers, More, Site settings.
 *
 * Every row names:
 * - the console's word for it (`label`), held to the console by
 *   `apps/console/specs/native-nav-manifest.spec.ts`, which reads the
 *   console's own tabs, sections and plugin declarations;
 * - one icon per idea, an SF Symbol and a Material Symbol;
 * - the native screen it opens (a plugin's declared screen, a core screen
 *   spec, a site platform screen or a `shell.*` destination);
 * - the plugin it belongs to, so it hides when that plugin is off for the
 *   workspace or the site.
 *
 * The core's own rows (Home, Overview, Sites, Pages, Media, the settings
 * modes) are here; a plugin's rows are its own, in
 * `libs/plugins/<plugin>/src/lib/native-nav.ts` (`NATIVE_NAV_ROWS`), placed
 * into a list's group by `order` (docs/PACKAGES.md rule 3: the core never
 * names a plugin). `generate:native-contracts` assembles the two
 * (`assembleNativeNav`) into the manifest the apps read,
 * `ContractValues.nativeNavManifest`.
 *
 * NO IMPORTS, on purpose: the native apps read this through the generated
 * contracts, so it must stay a plain module.
 */

/** A list the shells draw. */
export type NativeNavListId = 'workspace' | 'site' | 'workspaceSettings' | 'siteSettings'

/** One icon per idea: the same row draws the same picture in both scopes. */
export interface NativeNavIcon {
  /** An SF Symbol name. */
  apple: string
  /** A Material Symbol name, as `AglynIcons.named` takes it. */
  android: string
}

/**
 * Where a row's console twin lives:
 * - `orgTab` / `hostTab`: a console tab, by its id (`org-nav-tabs.ts`,
 *   `host-nav-tabs.ts`);
 * - `orgPluginTab` / `hostPluginTab`: a plugin's `orgNavItems` / `navItems`
 *   entry, by its href;
 * - `orgPluginSection` / `hostPluginSection`: a section of a plugin's hub, as
 *   `{href}/{sectionId}`;
 * - `setupSection`: a site's Setup section, by its id (`setup-sections.ts`);
 * - `hostAdminSection`, `orgSettingsSection`, `teamSection`,
 *   `billingSection`: a section of those hubs, by its `Route` name;
 * - `consoleWidget`: a plugin's card, as `{slot}/{widgetId}`;
 * - `shell`: a place the app's shell owns (Home, Overview's page, the
 *   settings modes), whose console twin is the page named in `id`;
 * - `nativeOnly`: a native screen the console has no page for.
 */
export type NativeNavConsoleSurface =
  | 'orgTab'
  | 'hostTab'
  | 'orgPluginTab'
  | 'hostPluginTab'
  | 'orgPluginSection'
  | 'hostPluginSection'
  | 'setupSection'
  | 'hostAdminSection'
  | 'orgSettingsSection'
  | 'teamSection'
  | 'billingSection'
  | 'consoleWidget'
  | 'shell'
  | 'nativeOnly'

export interface NativeNavConsoleRef {
  surface: NativeNavConsoleSurface
  id: string
}

/** A section inside a row's area, as the console's section rail lists it. */
export interface NativeNavSection {
  id: string
  label: string
  screen: string
  params?: Record<string, string>
  /** Set only when the section belongs to another plugin than its row's. */
  pluginId?: string
  console: NativeNavConsoleRef
}

/** An action the area offers from its title bar (Scan stock, New product). */
export interface NativeNavAction {
  id: string
  label: string
  icon: NativeNavIcon
  screen: string
  params?: Record<string, string>
}

export interface NativeNavRow {
  /** The idea's id: the same in every list that shows it (`media`). */
  id: string
  /** The console's word. */
  label: string
  /**
   * The console's word when the native label is a decision of its own
   * (Overview for the site's analytics, Zach 2026-10-18).
   */
  consoleLabel?: string
  icon: NativeNavIcon
  /** The native screen the row opens. */
  screen: string
  params?: Record<string, string>
  /** The plugin the row belongs to: off for the workspace or site, the row hides. */
  pluginId?: string
  /** Only a site admin sees the row, as only they see the console's Admin tab. */
  requiresHostAdmin?: boolean
  /** A settings row's one line, in the words the screens already use. */
  description?: string
  /** Search words besides the label, so typing "billing" finds Plan. */
  keywords?: string[]
  /** Where the row sits in its group, ascending; a plugin's row is placed by it. */
  order?: number
  sections?: NativeNavSection[]
  actions?: NativeNavAction[]
  console: NativeNavConsoleRef
}

export interface NativeNavGroup {
  id: string
  /** The heading; absent for a group drawn without one. */
  label?: string
  /** Folded at rest unless it holds the screen in use, remembered per device. */
  foldable: boolean
  /** `starred`: the person's starred items for this scope, drawn by the shell. */
  dynamic?: 'starred'
  rows: NativeNavRow[]
}

export interface NativeNavList {
  id: NativeNavListId
  /** The settings mode's title, after its owner's name ("Juniper Street Co. settings"). */
  title?: string
  groups: NativeNavGroup[]
}

/** A console place no row holds, and where the apps put it instead. */
export interface NativeNavElsewhere {
  console: NativeNavConsoleRef
  where: string
}

/** A plugin's row, and the list and group it goes in. */
export interface NativeNavContribution {
  list: NativeNavListId
  /** A group of that list, by id. */
  group: string
  row: NativeNavRow
}

export interface NativeNavManifest {
  lists: NativeNavList[]
  /** Destinations the shells own, which no plugin registers. */
  shellScreens: string[]
  elsewhere: NativeNavElsewhere[]
}

/** The shells' own destinations. */
export const NATIVE_NAV_SHELL_SCREENS: readonly string[] = [
  'shell.home',
  'shell.analytics',
  'shell.workspaceSettings',
  'shell.siteSettings',
]

/** An icon pair, for the rows here and in the plugins. */
export const nativeNavIcon = (apple: string, android: string): NativeNavIcon => ({ apple, android })

/** A console reference, for the rows here and in the plugins. */
export const nativeNavRef = (surface: NativeNavConsoleSurface, id: string): NativeNavConsoleRef => ({
  surface,
  id,
})

/** A section of a plugin hub, at the scope its row stands in. */
export function nativeNavHubSection(
  scope: 'org' | 'host',
  href: string,
  id: string,
  label: string,
  screen: string,
  extra: Partial<Pick<NativeNavSection, 'params' | 'pluginId'>> = {},
): NativeNavSection {
  return {
    id,
    label,
    screen,
    ...extra,
    console: nativeNavRef(scope === 'org' ? 'orgPluginSection' : 'hostPluginSection', `${href}/${id}`),
  }
}

const icon = nativeNavIcon
const ref = nativeNavRef

const ICONS = {
  home: icon('house', 'home'),
  overview: icon('chart.bar', 'bar_chart'),
  sites: icon('globe', 'public'),
  pages: icon('doc.text', 'description'),
  media: icon('photo.on.rectangle', 'photo_library'),
  settings: icon('gearshape', 'settings'),
  emails: icon('envelope', 'mail'),
  members: icon('person.2', 'group'),
  roles: icon('person.badge.key', 'admin_panel_settings'),
  activity: icon('clock.arrow.circlepath', 'history'),
  plan: icon('creditcard', 'credit_card'),
  usage: icon('gauge.with.dots.needle.33percent', 'data_usage'),
  invoices: icon('doc.plaintext', 'receipt_long'),
  billingSettings: icon('slider.horizontal.3', 'tune'),
  plugins: icon('puzzlepiece.extension', 'extension'),
  branding: icon('paintbrush', 'brush'),
  sso: icon('key.viewfinder', 'vpn_key'),
  profile: icon('building.2', 'apartment'),
  apiKeys: icon('key', 'key'),
  integrations: icon('point.3.connected.trianglepath.dotted', 'hub'),
  privacy: icon('hand.raised', 'privacy_tip'),
  holds: icon('exclamationmark.triangle', 'warning'),
  importExport: icon('arrow.up.arrow.down', 'sync'),
  ownership: icon('person.crop.circle.badge.checkmark', 'manage_accounts'),
  delete: icon('trash', 'delete_forever'),
  details: icon('info.circle', 'info'),
  business: icon('briefcase', 'business'),
  seo: icon('magnifyingglass', 'travel_explore'),
  tracking: icon('chart.line.uptrend.xyaxis', 'query_stats'),
  theme: icon('paintpalette', 'palette'),
  domain: icon('link', 'domain'),
  security: icon('lock', 'security'),
  errorPages: icon('exclamationmark.circle', 'error_outline'),
  backup: icon('square.and.arrow.down', 'backup'),
} as const

const HOME_ROW: NativeNavRow = {
  id: 'home',
  label: 'Home',
  icon: ICONS.home,
  screen: 'shell.home',
  order: 10,
  console: ref('shell', 'home'),
}

const WORKSPACE: NativeNavList = {
  id: 'workspace',
  groups: [
    { id: 'top', foldable: false, rows: [HOME_ROW] },
    { id: 'starred', label: 'Starred', foldable: true, dynamic: 'starred', rows: [] },
    {
      id: 'workspace',
      foldable: false,
      rows: [
        {
          id: 'sites',
          label: 'Sites',
          icon: ICONS.sites,
          screen: 'site.sites',
          order: 10,
          console: ref('orgTab', 'nav-tab-org-sites'),
        },
        {
          id: 'media',
          label: 'Media',
          icon: ICONS.media,
          screen: 'site.media',
          order: 90,
          console: ref('orgTab', 'nav-tab-org-media'),
        },
      ],
    },
  ],
}

const SITE: NativeNavList = {
  id: 'site',
  groups: [
    {
      id: 'top',
      foldable: false,
      rows: [
        HOME_ROW,
        {
          id: 'overview',
          label: 'Overview',
          consoleLabel: 'Analytics',
          icon: ICONS.overview,
          screen: 'shell.analytics',
          order: 20,
          keywords: ['analytics', 'traffic', 'visitors'],
          console: ref('hostTab', 'nav-tab-analytics'),
        },
      ],
    },
    { id: 'starred', label: 'Starred', foldable: true, dynamic: 'starred', rows: [] },
    {
      id: 'website',
      label: 'Website',
      foldable: true,
      rows: [
        {
          id: 'pages',
          label: 'Pages',
          icon: ICONS.pages,
          screen: 'site.pages',
          order: 10,
          sections: [
            { id: 'pages', label: 'Pages', screen: 'site.pages', console: ref('hostTab', 'nav-tab-screens') },
            { id: 'components', label: 'Components', screen: 'site.components', console: ref('hostTab', 'nav-tab-components') },
            { id: 'layouts', label: 'Layouts', screen: 'site.layouts', console: ref('hostTab', 'nav-tab-layouts') },
            { id: 'templates', label: 'Templates', screen: 'site.templates', console: ref('hostTab', 'nav-tab-templates') },
            { id: 'content', label: 'Content', screen: 'site.content', console: ref('hostTab', 'nav-tab-content') },
          ],
          console: ref('hostTab', 'nav-tab-screens'),
        },
        {
          id: 'media',
          label: 'Media',
          icon: ICONS.media,
          screen: 'site.media',
          order: 20,
          console: ref('hostTab', 'nav-tab-media'),
        },
      ],
    },
    { id: 'sell', label: 'Sell', foldable: true, rows: [] },
    { id: 'customers', label: 'Customers', foldable: true, rows: [] },
    { id: 'more', label: 'More', foldable: true, rows: [] },
    {
      id: 'settings',
      foldable: false,
      rows: [
        {
          id: 'siteSettings',
          label: 'Site settings',
          icon: ICONS.settings,
          screen: 'shell.siteSettings',
          order: 10,
          console: ref('shell', 'siteSettings'),
        },
      ],
    },
  ],
}

/** Each row's place, in the order written. */
const ordered = (rows: NativeNavRow[]): NativeNavRow[] =>
  rows.map((row, index) => ({ ...row, order: row.order ?? (index + 1) * 10 }))

const setupRow = (
  id: string,
  label: string,
  rowIcon: NativeNavIcon,
  description: string,
  keywords?: string[],
): NativeNavRow => ({
  id,
  label,
  icon: rowIcon,
  screen: id === 'theme' ? 'site.theme' : 'site.setup',
  ...(id === 'theme' ? {} : { params: { section: id } }),
  description,
  ...(keywords ? { keywords } : {}),
  console: ref('setupSection', id),
})

const adminRow = (
  id: string,
  label: string,
  rowIcon: NativeNavIcon,
  screen: string,
  route: string,
): NativeNavRow => ({
  id,
  label,
  icon: rowIcon,
  screen,
  requiresHostAdmin: true,
  console: ref('hostAdminSection', route),
})

const settingsRow = (
  surface: NativeNavConsoleSurface,
  id: string,
  label: string,
  rowIcon: NativeNavIcon,
  screen: string,
  route: string,
  extra: Partial<Pick<NativeNavRow, 'keywords' | 'order'>> = {},
): NativeNavRow => ({ id, label, icon: rowIcon, screen, ...extra, console: ref(surface, route) })

const WORKSPACE_SETTINGS: NativeNavList = {
  id: 'workspaceSettings',
  title: 'settings',
  groups: [
    {
      id: 'team',
      label: 'Team',
      foldable: false,
      rows: ordered([
        settingsRow('teamSection', 'members', 'Members', ICONS.members, 'core.team', 'MANAGE_TEAM_MEMBERS', { keywords: ['team', 'invite', 'people'] }),
        settingsRow('teamSection', 'roles', 'Custom roles', ICONS.roles, 'core.team.roles', 'MANAGE_TEAM_ROLES', { keywords: ['permissions'] }),
        settingsRow('teamSection', 'activity', 'Recent activity', ICONS.activity, 'core.team.activity', 'MANAGE_TEAM_ACTIVITY', { keywords: ['audit log'] }),
      ]),
    },
    {
      id: 'billing',
      label: 'Billing',
      foldable: false,
      rows: [
        settingsRow('billingSection', 'plan', 'Plan', ICONS.plan, 'core.billing', 'MANAGE_BILLING', { order: 10, keywords: ['billing', 'upgrade', 'subscription'] }),
        settingsRow('billingSection', 'usage', 'Usage', ICONS.usage, 'core.billing.usage', 'MANAGE_BILLING_USAGE', { order: 20, keywords: ['billing', 'limits'] }),
        settingsRow('billingSection', 'invoices', 'Invoices', ICONS.invoices, 'core.billing.invoices', 'MANAGE_BILLING_INVOICES', { order: 40, keywords: ['billing', 'receipts'] }),
        settingsRow('billingSection', 'billingSettings', 'Settings', ICONS.billingSettings, 'core.billing.settings', 'MANAGE_BILLING_SETTINGS', { order: 50, keywords: ['billing', 'payment method', 'tax'] }),
      ],
    },
    {
      id: 'workspace',
      label: 'Workspace',
      foldable: false,
      rows: ordered([
        settingsRow('orgTab', 'plugins', 'Plugins', ICONS.plugins, 'core.plugins', 'nav-tab-org-plugins'),
        settingsRow('orgSettingsSection', 'branding', 'Branding', ICONS.branding, 'core.settings.branding', 'ORG_SETTINGS_BRANDING', { keywords: ['white label', 'logo', 'colors'] }),
        settingsRow('orgSettingsSection', 'sso', 'Single sign-on', ICONS.sso, 'core.settings.sso', 'ORG_SETTINGS_SSO', { keywords: ['sso', 'saml'] }),
        settingsRow('orgSettingsSection', 'profile', 'Profile', ICONS.profile, 'core.settings.profile', 'ORG_SETTINGS_PROFILE'),
        settingsRow('orgSettingsSection', 'apiKeys', 'API keys', ICONS.apiKeys, 'core.settings.apiKeys', 'ORG_SETTINGS_API_KEYS'),
        settingsRow('orgSettingsSection', 'integrations', 'Integrations', ICONS.integrations, 'core.settings.integrations', 'ORG_SETTINGS_INTEGRATIONS'),
        settingsRow('orgSettingsSection', 'general', 'General', ICONS.settings, 'core.settings.general', 'ORG_SETTINGS_GENERAL', { keywords: ['name', 'address'] }),
      ]),
    },
    {
      id: 'data',
      label: 'Data & compliance',
      foldable: false,
      rows: ordered([
        settingsRow('orgSettingsSection', 'privacy', 'Privacy', ICONS.privacy, 'core.settings.privacy', 'ORG_SETTINGS_PRIVACY', { keywords: ['gdpr', 'erase'] }),
        settingsRow('orgSettingsSection', 'holds', 'Holds & reviews', ICONS.holds, 'core.settings.holds', 'ORG_SETTINGS_HOLDS'),
        settingsRow('orgSettingsSection', 'importExport', 'Import & export', ICONS.importExport, 'core.settings.data', 'ORG_SETTINGS_DATA', { keywords: ['csv', 'export'] }),
      ]),
    },
    {
      id: 'danger',
      label: 'Danger zone',
      foldable: false,
      rows: ordered([
        settingsRow('orgSettingsSection', 'ownership', 'Ownership', ICONS.ownership, 'core.settings.ownership', 'ORG_SETTINGS_OWNERSHIP', { keywords: ['transfer'] }),
        settingsRow('orgSettingsSection', 'delete', 'Delete', ICONS.delete, 'core.settings.delete', 'ORG_SETTINGS_DELETE'),
      ]),
    },
  ],
}

const SITE_SETTINGS: NativeNavList = {
  id: 'siteSettings',
  title: 'settings',
  groups: [
    {
      id: 'people',
      foldable: false,
      rows: ordered([
        {
          id: 'users',
          label: 'Users',
          icon: ICONS.members,
          screen: 'core.site.users',
          keywords: ['team', 'collaborators'],
          console: ref('hostTab', 'nav-tab-users'),
        },
      ]),
    },
    {
      id: 'setup',
      label: 'Setup',
      foldable: false,
      rows: ordered([
        setupRow('details', 'Basic details', ICONS.details, 'Logo, business details, layout and languages'),
        setupRow('business', 'Business profile', ICONS.business, 'What the business is, for everything that writes about it'),
        setupRow('seo', 'SEO', ICONS.seo, 'Search title, social image, business profile and verification', ['search']),
        setupRow('tracking', 'Tracking', ICONS.tracking, 'Analytics, ad tags and the consent banner', ['cookies', 'pixels']),
        setupRow('theme', 'Theme', ICONS.theme, 'Colors, font, shape and your saved themes', ['colors', 'fonts']),
        setupRow('emails', 'Emails', ICONS.emails, 'The emails your site sends to customers'),
        setupRow('integrations', 'Integrations', ICONS.integrations, 'Email platforms, Zapier, live chat and the other tools your site connects to'),
      ]),
    },
    {
      id: 'admin',
      label: 'Admin',
      foldable: false,
      rows: ordered([
        adminRow('general', 'General', ICONS.settings, 'core.site.general', 'HOST_ADMIN_GENERAL'),
        adminRow('plugins', 'Plugins', ICONS.plugins, 'core.site.plugins', 'HOST_ADMIN_PLUGINS'),
        adminRow('domain', 'Custom Domain', ICONS.domain, 'core.site.domain', 'HOST_ADMIN_DOMAIN'),
        adminRow('security', 'Security', ICONS.security, 'core.site.security', 'HOST_ADMIN_SECURITY'),
        adminRow('errorPages', 'Error pages', ICONS.errorPages, 'core.site.errorPages', 'HOST_ADMIN_ERROR_PAGES'),
        adminRow('activity', 'Activity', ICONS.activity, 'core.site.activity', 'HOST_ADMIN_ACTIVITY'),
        adminRow('backup', 'Backup & template', ICONS.backup, 'core.site.backup', 'HOST_ADMIN_BACKUP'),
        adminRow('danger', 'Danger zone', ICONS.delete, 'core.site.delete', 'HOST_ADMIN_DANGER'),
      ]),
    },
  ],
}

/**
 * The core's half of the manifest: every list and group, and the core's own
 * rows. The manifest the apps read (`ContractValues.nativeNavManifest`) is
 * this with each plugin's `NATIVE_NAV_ROWS` placed by `assembleNativeNav`.
 */
export const NATIVE_NAV_MANIFEST: NativeNavManifest = {
  lists: [WORKSPACE, SITE, WORKSPACE_SETTINGS, SITE_SETTINGS],
  shellScreens: [...NATIVE_NAV_SHELL_SCREENS],
  elsewhere: [
    { console: ref('hostTab', 'nav-tab-dashboard'), where: 'Home, inside the site (shell.home)' },
    { console: ref('hostTab', 'nav-tab-setup'), where: 'Site settings → Setup' },
    { console: ref('hostTab', 'nav-tab-admin'), where: 'Site settings → Admin' },
    { console: ref('orgTab', 'nav-tab-org-team'), where: 'Workspace settings → Team' },
    { console: ref('orgTab', 'nav-tab-org-billing'), where: 'Workspace settings → Billing' },
    { console: ref('orgTab', 'nav-tab-org-settings'), where: 'Workspace settings' },
    { console: ref('orgTab', 'nav-tab-org-support'), where: 'Help menu → Contact support (core.support)' },
  ],
}

/**
 * The manifest with the plugins' rows placed: each into its list's group by
 * `order` (a tie keeps the core's row first, then registration order). A row
 * naming a list or group the core does not have is refused by name, so a
 * plugin cannot quietly invent a group.
 */
export function assembleNativeNav(
  core: NativeNavManifest,
  contributions: readonly NativeNavContribution[],
  elsewhere: readonly NativeNavElsewhere[] = [],
): NativeNavManifest {
  const lists = core.lists.map((list) => ({
    ...list,
    groups: list.groups.map((group) => ({ ...group, rows: [...group.rows] })),
  }))
  for (const { list: listId, group: groupId, row } of contributions) {
    const group = lists.find((list) => list.id === listId)?.groups.find((entry) => entry.id === groupId)
    if (!group || group.dynamic) {
      throw new Error(`native nav: ${row.id} names ${listId}/${groupId}, which is not a group of rows`)
    }
    if (group.rows.some((entry) => entry.id === row.id)) {
      throw new Error(`native nav: ${listId}/${groupId} holds ${row.id} twice`)
    }
    group.rows.push(row)
  }
  for (const list of lists) {
    for (const group of list.groups) {
      group.rows = group.rows
        .map((row, index) => ({ row, index }))
        .sort((a, b) => (a.row.order ?? 0) - (b.row.order ?? 0) || a.index - b.index)
        .map(({ row }) => row)
    }
  }
  return { ...core, lists, elsewhere: [...core.elsewhere, ...elsewhere] }
}

/** A list as one scope shows it: rows for plugins that are off, or admin rows for a non-admin, left out. */
export interface ResolvedNavList {
  id: NativeNavListId
  title?: string
  groups: NativeNavGroup[]
}

/**
 * One list for the workspace or site in hand, from the assembled manifest
 * (`ContractValues.nativeNavManifest`). `enabledPluginIds` is the site's
 * effective set (`resolveHostEnabledPlugins`) in site scope and the
 * workspace's (`resolveEnabledPlugins`) otherwise. A section of another
 * plugin than its row's hides with that plugin. A group left with no rows is
 * dropped, except the starred group, which the shell fills.
 */
export function resolveNavList(
  manifest: NativeNavManifest,
  listId: NativeNavListId,
  enabledPluginIds: readonly string[],
  hostAdmin: boolean,
): ResolvedNavList {
  const list = manifest.lists.find((entry) => entry.id === listId)
  if (!list) return { id: listId, groups: [] }
  const on = new Set(enabledPluginIds)
  const shows = (pluginId?: string) => !pluginId || on.has(pluginId)
  const groups: NativeNavGroup[] = []
  for (const group of list.groups) {
    const rows = group.rows
      .filter((row) => shows(row.pluginId) && (hostAdmin || !row.requiresHostAdmin))
      .map((row) =>
        row.sections
          ? { ...row, sections: row.sections.filter((section) => shows(section.pluginId)) }
          : row,
      )
    if (!rows.length && !group.dynamic) continue
    groups.push({ ...group, rows })
  }
  return { id: list.id, ...(list.title ? { title: list.title } : {}), groups }
}
