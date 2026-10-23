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
 * THE PREFERENCES A PERSON KEEPS ON THEIR ACCOUNT (AGL-3943).
 *
 * One documented shape on `users/{uid}`, read and written the same way by
 * the console and both native apps (docs/mobile/native-navigation.md):
 *
 * | field | shape | cap |
 * | -- | -- | -- |
 * | `pinnedOrgs` | workspace ids, in the order the person keeps them | 5 |
 * | `pinnedHosts` | {@link PinnedHost}s, in the order they were pinned | 5 a workspace, 100 in all |
 * | `recentOrgs` | workspace ids, most recently opened first | 8 |
 * | `starred` | {@link StarredItem}s, in the order they were starred | 50 |
 * | `recents` | {@link RecentItem}s, most recently opened first | 30 |
 * | `workspaceColors` | workspace id → `#RRGGBB` the person picked | 100 |
 * | `appTheme` | {@link AppThemePrefs}, the apps' look, synced | — |
 *
 * The caps are held twice: here, by every writer, and by the Firestore rules,
 * which refuse a write that grows a list past its cap. A list that is ALREADY
 * past it (pins made before the cap, Zach 2026-10-18) may only shrink, so a
 * person with seven pins can still unpin one; the console asks them once
 * which five to keep, and until they answer the first five are the pins.
 *
 * A per-device override of the theme ("this device only") is the device's
 * own, kept in local storage on each platform, and never written here.
 *
 * NO IMPORTS, on purpose: the native apps read these constants, types and
 * the answers of these functions through the generated contracts, so it must
 * stay a plain module.
 */

/** `users/{uid}` field holding the ids of the workspaces the person pinned. */
export const PINNED_ORGS_FIELD = 'pinnedOrgs'

/** The most workspaces a person may pin, everywhere, the console included. */
export const PINNED_ORGS_MAX = 5

/** `users/{uid}` field holding the workspaces opened most recently, newest first. */
export const RECENT_ORGS_FIELD = 'recentOrgs'

/** How many recently opened workspaces are kept. */
export const RECENT_ORGS_MAX = 8

/** How many recent workspaces the rail shows below the pins. */
export const RAIL_RECENT_ORGS = 3

/** An account with this many workspaces or fewer sees them all on the rail. */
export const RAIL_ALL_WORKSPACES_AT_MOST = 8

/** `users/{uid}` field holding the person's starred screens and records. */
export const STARRED_FIELD = 'starred'

/** The most items a person may star. */
export const STARRED_MAX = 50

/** `users/{uid}` field holding the screens and records opened most recently. */
export const RECENTS_FIELD = 'recents'

/** How many recently opened screens and records are kept. */
export const RECENTS_MAX = 30

/** `users/{uid}` field holding the color the person picked for each workspace. */
export const WORKSPACE_COLORS_FIELD = 'workspaceColors'

/** The most workspaces a person may pick a color for. */
export const WORKSPACE_COLORS_MAX = 100

/** `users/{uid}` field holding the apps' theme, synced across devices. */
export const APP_THEME_FIELD = 'appTheme'

/** The longest label a starred or recent item keeps. */
export const ACCOUNT_ITEM_LABEL_MAX = 120

/** A picked color: `#` and six hex digits. */
export const ACCOUNT_COLOR_PATTERN = '^#[0-9A-Fa-f]{6}$'

/** The color dot a starred item may carry, named so each platform draws it from its theme. */
export type StarColor =
  | 'blue'
  | 'purple'
  | 'pink'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'grey'

/** Every star color, in the order the picker lists them. */
export const STAR_COLORS: readonly StarColor[] = [
  'blue',
  'purple',
  'pink',
  'red',
  'orange',
  'yellow',
  'green',
  'grey',
]

/**
 * A screen or a record the person can come back to: what it is, where it
 * belongs, what it was called, and the native screen that opens it.
 */
export interface AccountItemRef {
  /**
   * `screen` for a place in the app (a nav manifest row), otherwise the
   * one-box search kind of the record (`page`, `order`, `contact`, …).
   */
  kind: string
  /** The nav row id for a `screen`, otherwise the record's document id. */
  id: string
  /** The workspace it belongs to. */
  orgId: string
  /** The site, for an item that belongs to one. */
  hostId?: string
  /** What it was called when it was starred or opened. */
  label: string
  /** The native screen that opens it. */
  screen: string
  /** That screen's params. */
  params?: Record<string, string>
}

/** One starred item. */
export interface StarredItem extends AccountItemRef {
  color?: StarColor
  starredAtMs: number
}

/** One recently opened item. */
export interface RecentItem extends AccountItemRef {
  openedAtMs: number
}

export type AppAppearance = 'system' | 'light' | 'dark'

export type AppThemeName = 'aglyn' | 'quiet' | 'night' | 'ocean' | 'warm' | 'highContrast'

export type AppDensity = 'comfortable' | 'compact'

export type AppTextSize = 'system' | 'small' | 'medium' | 'large' | 'extraLarge'

export type AppSidebarStyle = 'tinted' | 'plain'

/** The apps' look, saved on the account so it follows the person to every device. */
export interface AppThemePrefs {
  /** Light, dark or the system's. */
  appearance: AppAppearance
  /** The theme: rail, sidebar tint, surfaces and accent for light and dark together. */
  theme: AppThemeName
  /** `theme` for the theme's own accent, or a `#RRGGBB` the person picked. */
  accent: string
  density: AppDensity
  /** `system` follows Dynamic Type or the font scale; the rest are the Mac and Windows sizes. */
  textSize: AppTextSize
  sidebarStyle: AppSidebarStyle
  /** The app icon's id: `aglyn`, or one of the alternates the apps ship. */
  appIcon: string
  /** A workspace's own brand color tints the app while you are in it. */
  useWorkspaceBrand: boolean
}

/** What a person who never changed anything sees. */
export const DEFAULT_APP_THEME: AppThemePrefs = {
  appearance: 'system',
  theme: 'aglyn',
  accent: 'theme',
  density: 'comfortable',
  textSize: 'system',
  // Plain: a sidebar keeps the theme's neutral ground unless the person picks Tinted (AGL-3990).
  sidebarStyle: 'plain',
  appIcon: 'aglyn',
  useWorkspaceBrand: true,
}

/** Every value each closed theme field accepts, in the order a picker lists them. */
export const APP_APPEARANCES: readonly AppAppearance[] = ['system', 'light', 'dark']
export const APP_THEME_NAMES: readonly AppThemeName[] = [
  'aglyn',
  'quiet',
  'night',
  'ocean',
  'warm',
  'highContrast',
]
export const APP_DENSITIES: readonly AppDensity[] = ['comfortable', 'compact']
export const APP_TEXT_SIZES: readonly AppTextSize[] = [
  'system',
  'small',
  'medium',
  'large',
  'extraLarge',
]
export const APP_SIDEBAR_STYLES: readonly AppSidebarStyle[] = ['tinted', 'plain']

/** The longest app icon id. */
export const APP_ICON_ID_MAX = 40

function field(profile: unknown, name: string): unknown {
  return profile && typeof profile === 'object'
    ? (profile as Record<string, unknown>)[name]
    : undefined
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value.filter((entry): entry is string => typeof entry === 'string' && entry !== ''),
    ),
  ]
}

/** Whether a value is a picked color, `#` and six hex digits. */
export function isAccountColor(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(ACCOUNT_COLOR_PATTERN).test(value)
}

// ── Pins ────────────────────────────────────────────────────────────────────

/**
 * Every id the person stored as pinned, in their order, without repeats.
 *
 * Anything that is not a list of non-empty strings reads as no pins, so a
 * stray value can never take a switcher down. May hold more than
 * {@link PINNED_ORGS_MAX} for an account that pinned before the cap; read
 * {@link effectivePinnedOrgs} for the pins to show.
 */
export function readPinnedOrgs(profile: unknown): string[] {
  return idList(field(profile, PINNED_ORGS_FIELD))
}

/** The pins in force: the first {@link PINNED_ORGS_MAX} stored, until the person picks. */
export function effectivePinnedOrgs(stored: readonly string[]): string[] {
  return idList(stored).slice(0, PINNED_ORGS_MAX)
}

/** The account pinned more than the cap before there was one, and has to pick which to keep. */
export function pinnedOrgsOverCap(stored: readonly string[]): boolean {
  return idList(stored).length > PINNED_ORGS_MAX
}

export type PinOrgOutcome = 'pinned' | 'alreadyPinned' | 'full'

export interface PinOrgResult {
  /** The pins after the request: unchanged unless `outcome` is `pinned`. */
  pinned: string[]
  outcome: PinOrgOutcome
}

/**
 * Pins a workspace at the end of the list, or says the list is full. A full
 * list is never made room in quietly: the caller asks "Pinned is full.
 * Replace one?" and calls {@link replacePinnedOrg} with the answer.
 */
export function pinOrg(pinned: readonly string[], orgId: string): PinOrgResult {
  const current = effectivePinnedOrgs(pinned)
  if (!orgId) return { pinned: current, outcome: 'alreadyPinned' }
  if (current.includes(orgId)) return { pinned: current, outcome: 'alreadyPinned' }
  if (current.length >= PINNED_ORGS_MAX) return { pinned: current, outcome: 'full' }
  return { pinned: [...current, orgId], outcome: 'pinned' }
}

/** The pins without one workspace. */
export function unpinOrg(pinned: readonly string[], orgId: string): string[] {
  return idList(pinned).filter((id) => id !== orgId)
}

/**
 * The pins with `orgId` in the place `replacing` held — the answer to
 * "Pinned is full. Replace one?". Unchanged when `replacing` is not pinned
 * or `orgId` already is.
 */
export function replacePinnedOrg(
  pinned: readonly string[],
  replacing: string,
  orgId: string,
): string[] {
  const current = effectivePinnedOrgs(pinned)
  if (!orgId || current.includes(orgId) || !current.includes(replacing)) return current
  return current.map((id) => (id === replacing ? orgId : id))
}

/**
 * The answer to "Keep which 5?": the stored pins the person ticked, in the
 * order they were pinned, never more than the cap.
 */
export function keepPinnedOrgs(stored: readonly string[], keep: readonly string[]): string[] {
  const kept = new Set(keep)
  return idList(stored)
    .filter((id) => kept.has(id))
    .slice(0, PINNED_ORGS_MAX)
}

/** The pins with one moved up (`-1`) or down (`1`) a place; unchanged at an end. */
export function movePinnedOrg(pinned: readonly string[], orgId: string, offset: number): string[] {
  const current = effectivePinnedOrgs(pinned)
  const from = current.indexOf(orgId)
  const to = from + (offset < 0 ? -1 : 1)
  if (from === -1 || to < 0 || to >= current.length) return current
  const next = [...current]
  next[from] = next[to]
  next[to] = orgId
  return next
}

// ── Site pins ───────────────────────────────────────────────────────────────

/** `users/{uid}` field holding the sites the person pinned, each with its workspace (AGL-4005). */
export const PINNED_HOSTS_FIELD = 'pinnedHosts'

/** The most sites a person may pin in one workspace: five, as for workspaces. */
export const PINNED_HOSTS_PER_WORKSPACE = 5

/**
 * The most site pins the account keeps across every workspace, the bound the
 * Firestore rules hold. Nobody meets it by pinning: it takes twenty
 * workspaces with five each. Past it, the oldest pins of OTHER workspaces
 * give way (see {@link pinHost}).
 */
export const PINNED_HOSTS_MAX = 100

/**
 * One pinned site and the workspace it belongs to. The workspace rides with
 * the pin so a surface that holds only one workspace's sites (the site
 * switcher's window) can tell its own pins apart without reading every site.
 */
export interface PinnedHost {
  orgId: string
  hostId: string
}

function pinnedHostList(value: unknown): PinnedHost[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const pins: PinnedHost[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const { orgId, hostId } = entry as Record<string, unknown>
    if (typeof orgId !== 'string' || !orgId) continue
    if (typeof hostId !== 'string' || !hostId || seen.has(hostId)) continue
    seen.add(hostId)
    pins.push({ orgId, hostId })
  }
  return pins
}

/**
 * Every site pin the person stored, in the order pinned, without repeats.
 * Anything that is not a `{ orgId, hostId }` reads as no pin, so a stray
 * value can never take the sites list down.
 */
export function readPinnedHosts(profile: unknown): PinnedHost[] {
  return pinnedHostList(field(profile, PINNED_HOSTS_FIELD))
}

/** One workspace's pinned site ids, in the order pinned, at most five. */
export function workspacePinnedHosts(stored: readonly PinnedHost[], orgId: string): string[] {
  return pinnedHostList(stored)
    .filter((pin) => pin.orgId === orgId)
    .map((pin) => pin.hostId)
    .slice(0, PINNED_HOSTS_PER_WORKSPACE)
}

export interface PinHostResult {
  /** Every stored pin after the request: unchanged unless `outcome` is `pinned`. */
  pinnedHosts: PinnedHost[]
  outcome: PinOrgOutcome
}

/**
 * Pins a site at the end of its workspace's pins, or says that workspace
 * already has five. As with workspaces, a full list is never made room in
 * quietly: the caller asks "Pinned is full. Replace one?" and calls
 * {@link replacePinnedHost} with the answer. Only the account-wide bound
 * ({@link PINNED_HOSTS_MAX}) makes room, and only from other workspaces.
 */
export function pinHost(stored: readonly PinnedHost[], pin: PinnedHost): PinHostResult {
  const current = pinnedHostList(stored)
  if (!pin.orgId || !pin.hostId) return { pinnedHosts: current, outcome: 'alreadyPinned' }
  const inWorkspace = workspacePinnedHosts(current, pin.orgId)
  if (inWorkspace.includes(pin.hostId)) return { pinnedHosts: current, outcome: 'alreadyPinned' }
  if (inWorkspace.length >= PINNED_HOSTS_PER_WORKSPACE) {
    return { pinnedHosts: current, outcome: 'full' }
  }
  // A site pinned under the workspace it has since moved out of moves with it.
  const next = [
    ...current.filter((entry) => entry.hostId !== pin.hostId),
    { orgId: pin.orgId, hostId: pin.hostId },
  ]
  while (next.length > PINNED_HOSTS_MAX) {
    const oldest = next.findIndex((entry) => entry.orgId !== pin.orgId)
    if (oldest === -1) break
    next.splice(oldest, 1)
  }
  return { pinnedHosts: next, outcome: 'pinned' }
}

/** The stored pins without one site. */
export function unpinHost(stored: readonly PinnedHost[], hostId: string): PinnedHost[] {
  return pinnedHostList(stored).filter((entry) => entry.hostId !== hostId)
}

/**
 * The stored pins with `pin` in the place `replacing` held in the same
 * workspace: the answer to "Pinned is full. Replace one?". Unchanged when
 * `replacing` is not one of that workspace's pins or `pin` already is.
 */
export function replacePinnedHost(
  stored: readonly PinnedHost[],
  replacing: string,
  pin: PinnedHost,
): PinnedHost[] {
  const current = pinnedHostList(stored)
  const inWorkspace = workspacePinnedHosts(current, pin.orgId)
  if (!pin.hostId || inWorkspace.includes(pin.hostId) || !inWorkspace.includes(replacing)) {
    return current
  }
  return current
    .filter((entry) => entry.hostId !== pin.hostId)
    .map((entry) =>
      entry.hostId === replacing ? { orgId: pin.orgId, hostId: pin.hostId } : entry,
    )
}

// ── Recent workspaces and the rail ──────────────────────────────────────────

/** The recently opened workspaces as stored, newest first. */
export function readRecentOrgs(profile: unknown): string[] {
  return idList(field(profile, RECENT_ORGS_FIELD)).slice(0, RECENT_ORGS_MAX)
}

/** The recent workspaces after opening one: it moves to the front, the oldest falls off. */
export function recordRecentOrg(recent: readonly string[], orgId: string): string[] {
  if (!orgId) return idList(recent).slice(0, RECENT_ORGS_MAX)
  return [orgId, ...idList(recent).filter((id) => id !== orgId)].slice(0, RECENT_ORGS_MAX)
}

/** What the workspace rail shows. */
export interface RailWorkspaces {
  /** Pinned, at the top, in the person's order. */
  pinned: string[]
  /** Below the divider: recently opened and not pinned, at most {@link RAIL_RECENT_ORGS}. */
  recent: string[]
  /** Every other workspace, for an account small enough to list them all. */
  rest: string[]
  /** Whether the last tile is "All workspaces", opening the searchable switcher. */
  allTile: boolean
  /** How many workspaces the person belongs to, shown under the All tile. */
  total: number
}

/**
 * The rail for one account: up to five pinned, a divider, up to three recent,
 * then an "All workspaces (N)" tile. An account with
 * {@link RAIL_ALL_WORKSPACES_AT_MOST} workspaces or fewer sees them all and
 * no All tile, since there is nothing to hide. `orgIds` is every membership,
 * in the switcher's order; an id the person no longer belongs to is ignored.
 */
export function railWorkspaces(
  orgIds: readonly string[],
  pinned: readonly string[],
  recent: readonly string[],
): RailWorkspaces {
  const members = idList(orgIds)
  const belongs = new Set(members)
  const pins = effectivePinnedOrgs(pinned).filter((id) => belongs.has(id))
  const pinnedSet = new Set(pins)
  if (members.length <= RAIL_ALL_WORKSPACES_AT_MOST) {
    return {
      pinned: pins,
      recent: [],
      rest: members.filter((id) => !pinnedSet.has(id)),
      allTile: false,
      total: members.length,
    }
  }
  return {
    pinned: pins,
    recent: idList(recent)
      .filter((id) => belongs.has(id) && !pinnedSet.has(id))
      .slice(0, RAIL_RECENT_ORGS),
    rest: [],
    allTile: true,
    total: members.length,
  }
}

// ── Starred and recent items ────────────────────────────────────────────────

/** One item's identity: the same screen or record in the same place. */
export function accountItemKey(
  item: Pick<AccountItemRef, 'kind' | 'id' | 'orgId' | 'hostId'>,
): string {
  return `${item.kind}:${item.orgId}:${item.hostId ?? ''}:${item.id}`
}

function stringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') out[key] = entry
  }
  return Object.keys(out).length ? out : undefined
}

function itemRef(value: unknown): AccountItemRef | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const text = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string) : '')
  const kind = text('kind')
  const id = text('id')
  const orgId = text('orgId')
  const screen = text('screen')
  if (!kind || !id || !orgId || !screen) return null
  const hostId = text('hostId')
  const params = stringMap(raw['params'])
  return {
    kind,
    id,
    orgId,
    ...(hostId ? { hostId } : {}),
    label: text('label').slice(0, ACCOUNT_ITEM_LABEL_MAX),
    screen,
    ...(params ? { params } : {}),
  }
}

function at(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function isStarColor(value: unknown): value is StarColor {
  return (STAR_COLORS as readonly unknown[]).includes(value)
}

/** The starred items as stored, each well formed, without repeats, never more than the cap. */
export function readStarred(profile: unknown): StarredItem[] {
  const stored = field(profile, STARRED_FIELD)
  if (!Array.isArray(stored)) return []
  const seen = new Set<string>()
  const out: StarredItem[] = []
  for (const entry of stored) {
    const ref = itemRef(entry)
    if (!ref) continue
    const key = accountItemKey(ref)
    if (seen.has(key)) continue
    seen.add(key)
    const color = (entry as Record<string, unknown>)['color']
    out.push({
      ...ref,
      ...(isStarColor(color) ? { color } : {}),
      starredAtMs: at((entry as Record<string, unknown>)['starredAtMs']),
    })
  }
  return out.slice(0, STARRED_MAX)
}

export type StarOutcome = 'starred' | 'unstarred' | 'full'

export interface StarResult {
  /** The starred items after the request: unchanged when `outcome` is `full`. */
  starred: StarredItem[]
  outcome: StarOutcome
}

/** Stars an item at the end of the list, or unstars it; a full list says so instead. */
export function toggleStarred(
  starred: readonly StarredItem[],
  item: AccountItemRef,
  nowMs: number,
): StarResult {
  const current = readStarred({ [STARRED_FIELD]: starred })
  const ref = itemRef(item)
  if (!ref) return { starred: current, outcome: 'full' }
  const key = accountItemKey(ref)
  if (current.some((entry) => accountItemKey(entry) === key)) {
    return {
      starred: current.filter((entry) => accountItemKey(entry) !== key),
      outcome: 'unstarred',
    }
  }
  if (current.length >= STARRED_MAX) return { starred: current, outcome: 'full' }
  return { starred: [...current, { ...ref, starredAtMs: nowMs }], outcome: 'starred' }
}

/** The starred items with one item's color dot set, or cleared with `null`. */
export function setStarColor(
  starred: readonly StarredItem[],
  key: string,
  color: StarColor | null,
): StarredItem[] {
  return readStarred({ [STARRED_FIELD]: starred }).map((entry) => {
    if (accountItemKey(entry) !== key) return entry
    const next: StarredItem = { ...entry }
    delete next.color
    return color && isStarColor(color) ? { ...next, color } : next
  })
}

/** The recent items as stored, newest first, each well formed, never more than the cap. */
export function readRecents(profile: unknown): RecentItem[] {
  const stored = field(profile, RECENTS_FIELD)
  if (!Array.isArray(stored)) return []
  const seen = new Set<string>()
  const out: RecentItem[] = []
  for (const entry of stored) {
    const ref = itemRef(entry)
    if (!ref) continue
    const key = accountItemKey(ref)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...ref, openedAtMs: at((entry as Record<string, unknown>)['openedAtMs']) })
  }
  return out.slice(0, RECENTS_MAX)
}

/** The recent items after opening one: it moves to the front, the oldest falls off. */
export function recordRecent(
  recents: readonly RecentItem[],
  item: AccountItemRef,
  nowMs: number,
): RecentItem[] {
  const current = readRecents({ [RECENTS_FIELD]: recents })
  const ref = itemRef(item)
  if (!ref) return current
  const key = accountItemKey(ref)
  return [
    { ...ref, openedAtMs: nowMs },
    ...current.filter((entry) => accountItemKey(entry) !== key),
  ].slice(0, RECENTS_MAX)
}

// ── Workspace colors ────────────────────────────────────────────────────────

/** The colors the person picked, by workspace id, the valid ones only. */
export function readWorkspaceColors(profile: unknown): Record<string, string> {
  const stored = field(profile, WORKSPACE_COLORS_FIELD)
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
  const out: Record<string, string> = {}
  for (const [orgId, color] of Object.entries(stored as Record<string, unknown>)) {
    if (orgId && isAccountColor(color)) out[orgId] = color
    if (Object.keys(out).length >= WORKSPACE_COLORS_MAX) break
  }
  return out
}

export type WorkspaceColorSource = 'picked' | 'brand' | 'logo' | 'none'

export interface WorkspaceColor {
  /** `#RRGGBB`, or null when nothing gives the workspace a color. */
  color: string | null
  source: WorkspaceColorSource
  /** Whether the app is tinted with it while you are in the workspace. */
  tintsApp: boolean
}

/**
 * A workspace's color: the one the person picked, else the workspace's brand
 * color (`brandingProfile.primaryColor`), else a color taken from its logo
 * (Zach, 2026-10-18). The rail tile always shows it; the app is tinted with
 * it while you are in the workspace unless the person turned "Use each
 * workspace's brand" off, which stops the brand and logo colors tinting the
 * app (a picked color still does: the person chose it).
 */
export function resolveWorkspaceColor(
  picked: unknown,
  brandColor: unknown,
  logoColor: unknown,
  useWorkspaceBrand: boolean,
): WorkspaceColor {
  if (isAccountColor(picked)) return { color: picked, source: 'picked', tintsApp: true }
  if (isAccountColor(brandColor)) {
    return { color: brandColor, source: 'brand', tintsApp: useWorkspaceBrand }
  }
  if (isAccountColor(logoColor)) {
    return { color: logoColor, source: 'logo', tintsApp: useWorkspaceBrand }
  }
  return { color: null, source: 'none', tintsApp: false }
}

// ── Theme ───────────────────────────────────────────────────────────────────

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback
}

/** The synced theme, every field filled: a missing or unknown value reads as the default. */
export function readAppTheme(profile: unknown): AppThemePrefs {
  const stored = field(profile, APP_THEME_FIELD)
  const raw =
    stored && typeof stored === 'object' && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {}
  const accent = raw['accent']
  const appIcon = raw['appIcon']
  return {
    appearance: oneOf(raw['appearance'], APP_APPEARANCES, DEFAULT_APP_THEME.appearance),
    theme: oneOf(raw['theme'], APP_THEME_NAMES, DEFAULT_APP_THEME.theme),
    accent: accent === 'theme' || isAccountColor(accent) ? accent : DEFAULT_APP_THEME.accent,
    density: oneOf(raw['density'], APP_DENSITIES, DEFAULT_APP_THEME.density),
    textSize: oneOf(raw['textSize'], APP_TEXT_SIZES, DEFAULT_APP_THEME.textSize),
    sidebarStyle: oneOf(raw['sidebarStyle'], APP_SIDEBAR_STYLES, DEFAULT_APP_THEME.sidebarStyle),
    appIcon:
      typeof appIcon === 'string' && appIcon !== '' && appIcon.length <= APP_ICON_ID_MAX
        ? appIcon
        : DEFAULT_APP_THEME.appIcon,
    useWorkspaceBrand:
      typeof raw['useWorkspaceBrand'] === 'boolean'
        ? (raw['useWorkspaceBrand'] as boolean)
        : DEFAULT_APP_THEME.useWorkspaceBrand,
  }
}
