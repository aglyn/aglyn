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
 * | `tabBars` | {@link TabBarPins}, the phone's tab bar per site and per workspace | 4 areas each, 100 in all |
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
  /**
   * `plain` keeps the sidebar on the theme's surface; `tinted` lays the THEME's accent over it at 5%, on a theme other
   * than Aglyn only (Aglyn's sidebar is always neutral). A workspace's color never tints it: that is its rail tile's.
   */
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
  /**
   * Workspaces listed on the rail beyond the pins and the recents. Always
   * empty: every account reaches the rest through the All tile
   * (AGL-3996). The field stays so the apps that read it need no change.
   */
  rest: string[]
  /** Whether the last tile is "All workspaces", opening the searchable switcher: whenever there is a workspace. */
  allTile: boolean
  /** How many workspaces the person belongs to, shown under the All tile. */
  total: number
}

/**
 * The rail for one account, the same for every account however few
 * workspaces it has (Figma Rail 12:338, "Many workspaces"): up to five
 * pinned, a divider, up to three recent under "Recent", a divider, then the
 * "All workspaces" tile with the total, which opens the switcher where pins
 * are edited. A small account that saw every tile in one unlabeled column
 * had no way into the switcher and no Recent label or divider. `orgIds` is every membership, in the switcher's order;
 * an id the person no longer belongs to is ignored.
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
  return {
    pinned: pins,
    recent: idList(recent)
      .filter((id) => belongs.has(id) && !pinnedSet.has(id))
      .slice(0, RAIL_RECENT_ORGS),
    rest: [],
    allTile: members.length > 0,
    total: members.length,
  }
}

/**
 * The one letter a workspace tile without a logo shows (Figma Rail/Workspace
 * tile, Type=Initial): the first letter or digit of its name, upper-cased;
 * "?" for a name with neither. One letter, not two: the tile's color, picked
 * per workspace, tells two workspaces with the same letter apart.
 */
export function workspaceInitial(name: string): string {
  const first = /[\p{L}\p{N}]/u.exec(name ?? '')
  return first ? first[0].toUpperCase() : '?'
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

/**
 * The colors a workspace's tile takes when nothing else gives it one
 * ({@link workspaceStableColor}): the console's blue for text on a light
 * ground (primary.dark), deep tones of the brand palette's
 * violet and pink, and a rose, orange, gold, green and teal beside them,
 * each dark enough that the tile's white initial reads at 4.5:1 or more. The
 * slate is left out: it is the tile of a workspace with no id at all.
 */
export const WORKSPACE_STABLE_COLORS: readonly string[] = [
  '#0077AD',
  '#6A4FD8',
  '#A62BBF',
  '#C2185B',
  '#B4501A',
  '#8A6A00',
  '#2E7D5B',
  '#00796B',
]

/**
 * The color a workspace with no picked, brand or logo color shows on its
 * tile: one of {@link WORKSPACE_STABLE_COLORS}, chosen by its id, so the same
 * workspace has the same color on every device and in every app, and two
 * workspaces with the same initial usually differ. The id is hashed with
 * 32-bit FNV-1a over its UTF-16 code units, which each platform computes the
 * same way. Null for an empty id.
 */
export function workspaceStableColor(orgId: unknown): string | null {
  if (typeof orgId !== 'string' || orgId === '') return null
  let hash = 0x811c9dc5
  for (let i = 0; i < orgId.length; i++) {
    hash ^= orgId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return WORKSPACE_STABLE_COLORS[hash % WORKSPACE_STABLE_COLORS.length] ?? null
}

export type WorkspaceColorSource = 'picked' | 'brand' | 'logo' | 'stable' | 'none'

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
 *
 * Given the workspace's id, a workspace with none of the three still gets a
 * color: its stable one ({@link workspaceStableColor}). That one colors only
 * its tile (the rail, the pickers, the menus, the sidebar's header), never
 * the app.
 */
export function resolveWorkspaceColor(
  picked: unknown,
  brandColor: unknown,
  logoColor: unknown,
  useWorkspaceBrand: boolean,
  orgId?: unknown,
): WorkspaceColor {
  if (isAccountColor(picked)) return { color: picked, source: 'picked', tintsApp: true }
  if (isAccountColor(brandColor)) {
    return { color: brandColor, source: 'brand', tintsApp: useWorkspaceBrand }
  }
  if (isAccountColor(logoColor)) {
    return { color: logoColor, source: 'logo', tintsApp: useWorkspaceBrand }
  }
  const stable = workspaceStableColor(orgId)
  if (stable) return { color: stable, source: 'stable', tintsApp: false }
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

// ── The phone's tab bar (AGL-4006) ──────────────────────────────────────────

/** `users/{uid}` field holding the areas the person keeps in the phone's tab bar, per site and per workspace. */
export const TAB_BARS_FIELD = 'tabBars'

/**
 * The most areas one tab bar holds beside Home: iOS and
 * Material take five destinations at most, and nothing ever overflows into a
 * More tab. With four, Create leaves the bar for the top bar.
 */
export const TAB_BAR_AREAS_MAX = 4

/** The most sites and workspaces the account keeps a tab bar for, the bound the Firestore rules hold. */
export const TAB_BARS_MAX = 100

/** The tab bar's own slots beside the areas: Home, always first, and Create new. */
export const TAB_BAR_HOME = 'home'
export const TAB_BAR_CREATE = 'create'

/** One site's or workspace's tab bar. */
export interface TabBarPins {
  /** `site:<hostId>` or `org:<orgId>` ({@link tabBarScope}). */
  scope: string
  /** Nav manifest row ids, in the person's order, at most {@link TAB_BAR_AREAS_MAX}. */
  areas: string[]
  /**
   * The person pinned, unpinned or reordered here by hand. Until then the
   * first areas they open take the free spots and stay (the default the
   * orchestrator settled on 2026-10-20: nothing guessed, nothing rotating);
   * after it, only the person changes the bar.
   */
  chosen: boolean
}

export type TabPinOutcome = 'pinned' | 'alreadyPinned' | 'full'

export interface TabPinResult {
  /** Every stored tab bar after the request: unchanged unless `outcome` is `pinned`. */
  tabBars: TabBarPins[]
  outcome: TabPinOutcome
}

/** What a phone's tab bar shows, in order, and where Create new goes. */
export interface TabBarLayout {
  /** {@link TAB_BAR_HOME}, the areas, and {@link TAB_BAR_CREATE} in the centre unless it moved to the top bar. */
  slots: string[]
  /** Four areas fill the bar, so Create new sits in the top bar beside the AI button. */
  createInTopBar: boolean
}

/** The key of one site's tab bar, or the whole workspace's. */
export function tabBarScope(orgId: string, hostId?: string | null): string {
  return hostId ? `site:${hostId}` : `org:${orgId}`
}

function tabAreaList(value: unknown): string[] {
  return idList(value)
    .filter((id) => id !== TAB_BAR_HOME && id !== TAB_BAR_CREATE)
    .slice(0, TAB_BAR_AREAS_MAX)
}

function tabBarList(value: unknown): TabBarPins[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: TabBarPins[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const raw = entry as Record<string, unknown>
    const scope = raw['scope']
    if (typeof scope !== 'string' || !/^(site|org):./.test(scope) || seen.has(scope)) continue
    seen.add(scope)
    out.push({ scope, areas: tabAreaList(raw['areas']), chosen: raw['chosen'] === true })
  }
  return out.slice(-TAB_BARS_MAX)
}

/**
 * Every tab bar the person keeps, each well formed, without repeats. Anything
 * that is not a `{ scope, areas, chosen }` reads as no tab bar, so a stray
 * value can never take the phone's shell down.
 */
export function readTabBars(profile: unknown): TabBarPins[] {
  return tabBarList(field(profile, TAB_BARS_FIELD))
}

/** One scope's areas, in the person's order. */
export function tabBarAreas(tabBars: readonly TabBarPins[], scope: string): string[] {
  return tabBarList(tabBars).find((bar) => bar.scope === scope)?.areas ?? []
}

/**
 * Every tab bar with one scope's replaced. A scope seen for the first time
 * goes last; past {@link TAB_BARS_MAX} the oldest OTHER scopes give way.
 */
function withTabBar(tabBars: readonly TabBarPins[], next: TabBarPins): TabBarPins[] {
  const current = tabBarList(tabBars)
  const at = current.findIndex((bar) => bar.scope === next.scope)
  const out = at === -1 ? [...current, next] : current.map((bar, index) => (index === at ? next : bar))
  while (out.length > TAB_BARS_MAX) {
    const oldest = out.findIndex((bar) => bar.scope !== next.scope)
    if (oldest === -1) break
    out.splice(oldest, 1)
  }
  return out
}

/**
 * Pins an area at the end of a scope's tab bar (long-press a tile, "Add to tab
 * bar"), or says the bar is full: a full bar is never made room in quietly.
 */
export function pinTabArea(
  tabBars: readonly TabBarPins[],
  scope: string,
  area: string,
): TabPinResult {
  const current = tabBarList(tabBars)
  const areas = tabBarAreas(current, scope)
  if (!area || area === TAB_BAR_HOME || area === TAB_BAR_CREATE || areas.includes(area)) {
    return { tabBars: current, outcome: 'alreadyPinned' }
  }
  if (areas.length >= TAB_BAR_AREAS_MAX) return { tabBars: current, outcome: 'full' }
  return {
    tabBars: withTabBar(current, { scope, areas: [...areas, area], chosen: true }),
    outcome: 'pinned',
  }
}

/** A scope's tab bar without one area; the person chose, so opened areas no longer fill the spot. */
export function unpinTabArea(
  tabBars: readonly TabBarPins[],
  scope: string,
  area: string,
): TabBarPins[] {
  const areas = tabBarAreas(tabBars, scope)
  return withTabBar(tabBars, { scope, areas: areas.filter((id) => id !== area), chosen: true })
}

/** A scope's tab bar with one area moved left (`-1`) or right (`1`) a place; unchanged at an end. */
export function moveTabArea(
  tabBars: readonly TabBarPins[],
  scope: string,
  area: string,
  offset: number,
): TabBarPins[] {
  const areas = tabBarAreas(tabBars, scope)
  const from = areas.indexOf(area)
  const to = from + (offset < 0 ? -1 : 1)
  if (from === -1 || to < 0 || to >= areas.length) return tabBarList(tabBars)
  const next = [...areas]
  next[from] = next[to]
  next[to] = area
  return withTabBar(tabBars, { scope, areas: next, chosen: true })
}

/** A scope's tab bar as the Tab bar sheet left it: these areas, in this order, at most four. */
export function setTabAreas(
  tabBars: readonly TabBarPins[],
  scope: string,
  areas: readonly string[],
): TabBarPins[] {
  return withTabBar(tabBars, { scope, areas: tabAreaList(areas), chosen: true })
}

/**
 * The default before anyone pins: an area the person opens takes a free spot
 * and stays there, until the bar is full or the person changes it by hand.
 * Unchanged once the scope is `chosen`, the area is in the bar already, or the
 * bar is full.
 */
export function autoPinTabArea(
  tabBars: readonly TabBarPins[],
  scope: string,
  area: string,
): TabBarPins[] {
  const current = tabBarList(tabBars)
  const bar = current.find((entry) => entry.scope === scope)
  const areas = bar?.areas ?? []
  if (!area || area === TAB_BAR_HOME || area === TAB_BAR_CREATE) return current
  if (bar?.chosen || areas.includes(area) || areas.length >= TAB_BAR_AREAS_MAX) return current
  return withTabBar(current, { scope, areas: [...areas, area], chosen: false })
}

/**
 * The tab bar to draw: Home first, then the pinned areas the scope can open
 * (`available`, the Home tiles' ids in this build), with Create new in the
 * centre slot. Four areas fill the bar, and Create moves to the top bar.
 */
export function tabBarLayout(areas: readonly string[], available: readonly string[]): TabBarLayout {
  const open = new Set(available)
  const shown = tabAreaList(areas).filter((id) => open.has(id))
  if (shown.length >= TAB_BAR_AREAS_MAX) {
    return { slots: [TAB_BAR_HOME, ...shown], createInTopBar: true }
  }
  const slots = [TAB_BAR_HOME, ...shown]
  slots.splice(Math.floor((shown.length + 2) / 2), 0, TAB_BAR_CREATE)
  return { slots, createInTopBar: false }
}

// ── Who is signed in ────────────────────────────────────────────────────────

/**
 * `users/{uid}` field holding the person's own picture (AGL-1961). Lowercase
 * `url`: the roster's `photoURL` spelling reads as nothing here.
 */
export const ACCOUNT_PHOTO_FIELD = 'photoUrl'

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * The person's own picture, the same answer in the console and both apps
 * (AGL-4010): `users/{uid}.photoUrl` first (the profile they edit, filled from
 * the identity provider on every sign-in), else the sign-in record's
 * `photoURL`, else null, so the caller draws initials. A blank value is never
 * a picture, so a photo in either place wins over an empty one in the other.
 * A library pick is stored as a `/api/media/cdn/...` path; resolving it to an
 * address is the caller's (`mediaPreviewURL` on native).
 */
export function readAccountPhoto(profile: unknown, authPhotoUrl: unknown): string | null {
  return trimmed(field(profile, ACCOUNT_PHOTO_FIELD)) || trimmed(authPhotoUrl) || null
}

/**
 * The person's own name, the same answer in the console and both apps
 * (AGL-2486, AGL-4010): the profile's first and last name, else the sign-in
 * record's display name (empty for an SSO account), else the email address,
 * else empty.
 */
export function readAccountName(
  profile: unknown,
  authDisplayName: unknown,
  email: unknown,
): string {
  const fromProfile = [field(profile, 'firstName'), field(profile, 'lastName')]
    .map(trimmed)
    .filter(Boolean)
    .join(' ')
  return fromProfile || trimmed(authDisplayName) || trimmed(email)
}
