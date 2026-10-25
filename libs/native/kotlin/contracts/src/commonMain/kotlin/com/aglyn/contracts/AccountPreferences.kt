package com.aglyn.contracts

/*
 * The preferences a person keeps on their account (`users/{uid}`), ported once from
 * libs/aglyn/src/lib/app-utils/account-preferences.ts (AGL-3943) and held to it by the
 * replayed cases in AccountPreferencesCasesTest: pins (five at most, everywhere), recent
 * workspaces and the rail they make, starred and recent items, the color picked for each
 * workspace and the apps' synced theme.
 *
 * Profiles are the plain values a Firestore read hands over (maps, lists, strings).
 */

private fun field(profile: Any?, name: String): Any? = (profile as? Map<*, *>)?.get(name)

/** Non-empty strings only, in order, without repeats. */
private fun idList(value: Any?): List<String> =
  ((value as? List<*>) ?: return emptyList()).filterIsInstance<String>().filter { it.isNotEmpty() }.distinct()

private val colorPattern by lazy { Regex(Contracts.accountColorPattern) }

/** Whether a value is a picked color, `#` and six hex digits. */
fun isAccountColor(value: Any?): Boolean = value is String && colorPattern.matches(value)

// ── Pins ────────────────────────────────────────────────────────────────────

private val pinnedMax get() = Contracts.pinnedOrgsMax.toInt()

/** Every id stored as pinned, in order; may exceed the cap for an account that pinned before there was one. */
fun readPinnedOrgs(profile: Any?): List<String> = idList(field(profile, Contracts.pinnedOrgsField))

/** The pins in force: the first five stored, until the person picks. */
fun effectivePinnedOrgs(stored: List<String>): List<String> = idList(stored).take(pinnedMax)

/** The account pinned more than the cap before there was one, and has to pick which to keep. */
fun pinnedOrgsOverCap(stored: List<String>): Boolean = idList(stored).size > pinnedMax

/** Pins a workspace at the end, or says the list is full (the caller then asks "Pinned is full. Replace one?"). */
fun pinOrg(pinned: List<String>, orgId: String): PinOrgResult {
  val current = effectivePinnedOrgs(pinned)
  return when {
    orgId.isEmpty() || orgId in current -> PinOrgResult(PinOrgOutcome.ALREADY_PINNED, current)
    current.size >= pinnedMax -> PinOrgResult(PinOrgOutcome.FULL, current)
    else -> PinOrgResult(PinOrgOutcome.PINNED, current + orgId)
  }
}

/** The pins without one workspace. */
fun unpinOrg(pinned: List<String>, orgId: String): List<String> = idList(pinned).filter { it != orgId }

/** The pins with [orgId] in the place [replacing] held; unchanged when that is not pinned or [orgId] already is. */
fun replacePinnedOrg(pinned: List<String>, replacing: String, orgId: String): List<String> {
  val current = effectivePinnedOrgs(pinned)
  if (orgId.isEmpty() || orgId in current || replacing !in current) return current
  return current.map { if (it == replacing) orgId else it }
}

/** The answer to "Keep which 5 pins?": the ticked ones in their pinned order, never more than the cap. */
fun keepPinnedOrgs(stored: List<String>, keep: List<String>): List<String> {
  val kept = keep.toSet()
  return idList(stored).filter { it in kept }.take(pinnedMax)
}

/** The pins with one moved up (negative) or down a place; unchanged at an end. */
fun movePinnedOrg(pinned: List<String>, orgId: String, offset: Int): List<String> {
  val current = effectivePinnedOrgs(pinned).toMutableList()
  val from = current.indexOf(orgId)
  val to = from + if (offset < 0) -1 else 1
  if (from == -1 || to < 0 || to >= current.size) return current
  current[from] = current[to]
  current[to] = orgId
  return current
}

// ── Recent workspaces and the rail ──────────────────────────────────────────

private val recentOrgsMax get() = Contracts.recentOrgsMax.toInt()

/** The recently opened workspaces as stored, newest first. */
fun readRecentOrgs(profile: Any?): List<String> = idList(field(profile, Contracts.recentOrgsField)).take(recentOrgsMax)

/** The recent workspaces after opening one: it moves to the front, the oldest falls off. */
fun recordRecentOrg(recent: List<String>, orgId: String): List<String> {
  if (orgId.isEmpty()) return idList(recent).take(recentOrgsMax)
  return (listOf(orgId) + idList(recent).filter { it != orgId }).take(recentOrgsMax)
}

/**
 * The rail for one account, the same however few workspaces it has (Figma Rail 12:338, "Many workspaces"): up to five
 * pinned, a divider, up to three recent, a divider, then "All workspaces (N)", which opens the switcher where pins are
 * edited (AGL-3996). `rest` is always empty. [orgIds] is every membership in the switcher's order; an id the
 * person no longer belongs to is ignored.
 */
fun railWorkspaces(orgIds: List<String>, pinned: List<String>, recent: List<String>): RailWorkspaces {
  val members = idList(orgIds)
  val belongs = members.toSet()
  val pins = effectivePinnedOrgs(pinned).filter { it in belongs }
  val pinnedSet = pins.toSet()
  return RailWorkspaces(
    allTile = members.isNotEmpty(),
    pinned = pins,
    recent = idList(recent).filter { it in belongs && it !in pinnedSet }.take(Contracts.railRecentOrgs.toInt()),
    rest = emptyList(),
    total = members.size.toLong(),
  )
}

/**
 * The one letter a workspace tile without a logo shows (Figma Rail/Workspace tile, Type=Initial): the first letter or
 * digit of its name, upper-cased; "?" for a name with neither.
 */
fun workspaceInitial(name: String): String = name.firstOrNull { it.isLetterOrDigit() }?.uppercase() ?: "?"


// ── Starred and recent items ────────────────────────────────────────────────

/** One item's identity: the same screen or record in the same place. */
fun accountItemKey(kind: String, id: String, orgId: String, hostId: String?): String = "$kind:$orgId:${hostId.orEmpty()}:$id"

fun accountItemKey(item: AccountItemRef): String = accountItemKey(item.kind, item.id, item.orgId, item.hostId)
fun accountItemKey(item: StarredItem): String = accountItemKey(item.kind, item.id, item.orgId, item.hostId)
fun accountItemKey(item: RecentItem): String = accountItemKey(item.kind, item.id, item.orgId, item.hostId)

private fun stringMap(value: Any?): Map<String, String>? {
  val map = value as? Map<*, *> ?: return null
  val out = LinkedHashMap<String, String>()
  for ((key, entry) in map) if (key is String && entry is String) out[key] = entry
  return out.ifEmpty { null }
}

private fun itemRef(value: Any?): AccountItemRef? {
  val raw = value as? Map<*, *> ?: return null
  fun text(key: String) = raw[key] as? String ?: ""
  val kind = text("kind")
  val id = text("id")
  val orgId = text("orgId")
  val screen = text("screen")
  if (kind.isEmpty() || id.isEmpty() || orgId.isEmpty() || screen.isEmpty()) return null
  return AccountItemRef(
    hostId = text("hostId").ifEmpty { null },
    id = id,
    kind = kind,
    label = text("label").take(Contracts.accountItemLabelMax.toInt()),
    orgId = orgId,
    params = stringMap(raw["params"]),
    screen = screen,
  )
}

private fun at(value: Any?): Long = when (value) {
  is Long -> value
  is Int -> value.toLong()
  is Double -> if (value.isFinite()) value.toLong() else 0
  is Number -> value.toLong()
  else -> 0
}

private fun starColor(value: Any?): StarColor? = (value as? String)?.let { raw -> StarColor.entries.firstOrNull { it.raw == raw && it != StarColor.UNKNOWN } }

/** An item as plain values, the shape stored in the account's lists. */
fun AccountItemRef.toPlain(): Map<String, Any?> = buildMap {
  put("kind", kind); put("id", id); put("orgId", orgId)
  hostId?.let { put("hostId", it) }
  put("label", label); put("screen", screen)
  params?.let { put("params", it) }
}

fun StarredItem.toRef() = AccountItemRef(hostId, id, kind, label, orgId, params, screen)
fun RecentItem.toRef() = AccountItemRef(hostId, id, kind, label, orgId, params, screen)

fun StarredItem.toPlain(): Map<String, Any?> = toRef().toPlain() + buildMap {
  color?.let { put("color", it.raw) }
  put("starredAtMs", starredAtMs)
}

fun RecentItem.toPlain(): Map<String, Any?> = toRef().toPlain() + mapOf("openedAtMs" to openedAtMs)

private fun AccountItemRef.starred(color: StarColor?, atMs: Long) = StarredItem(color, hostId, id, kind, label, orgId, params, screen, atMs)
private fun AccountItemRef.recent(atMs: Long) = RecentItem(hostId, id, kind, label, atMs, orgId, params, screen)

/** The starred items as stored, each well formed, without repeats, never more than the cap. */
fun readStarred(profile: Any?): List<StarredItem> = starredFrom(field(profile, Contracts.starredField))

private fun starredFrom(stored: Any?): List<StarredItem> {
  val list = stored as? List<*> ?: return emptyList()
  val seen = mutableSetOf<String>()
  val out = mutableListOf<StarredItem>()
  for (entry in list) {
    val ref = itemRef(entry) ?: continue
    if (!seen.add(accountItemKey(ref))) continue
    val raw = entry as Map<*, *>
    out += ref.starred(starColor(raw["color"]), at(raw["starredAtMs"]))
  }
  return out.take(Contracts.starredMax.toInt())
}

private fun List<StarredItem>.cleaned() = starredFrom(map { it.toPlain() })

/** Stars an item at the end of the list, or unstars it; a full list says so instead. */
fun toggleStarred(starred: List<StarredItem>, item: AccountItemRef, nowMs: Long): StarResult = toggleStarredPlain(starred, item.toPlain(), nowMs)

/** [toggleStarred] for an item as plain values, which may be malformed (then nothing changes). */
fun toggleStarredPlain(starred: List<StarredItem>, item: Any?, nowMs: Long): StarResult {
  val current = starred.cleaned()
  val ref = itemRef(item) ?: return StarResult(StarOutcome.FULL, current)
  val key = accountItemKey(ref)
  if (current.any { accountItemKey(it) == key }) return StarResult(StarOutcome.UNSTARRED, current.filter { accountItemKey(it) != key })
  if (current.size >= Contracts.starredMax) return StarResult(StarOutcome.FULL, current)
  return StarResult(StarOutcome.STARRED, current + ref.starred(null, nowMs))
}

/** The starred items with one item's color dot set, or cleared with null. */
fun setStarColor(starred: List<StarredItem>, key: String, color: StarColor?): List<StarredItem> =
  starred.cleaned().map { entry ->
    if (accountItemKey(entry) != key) entry else entry.copy(color = color?.takeIf { it != StarColor.UNKNOWN })
  }

/** The recent items as stored, newest first, each well formed, never more than the cap. */
fun readRecents(profile: Any?): List<RecentItem> = recentsFrom(field(profile, Contracts.recentsField))

private fun recentsFrom(stored: Any?): List<RecentItem> {
  val list = stored as? List<*> ?: return emptyList()
  val seen = mutableSetOf<String>()
  val out = mutableListOf<RecentItem>()
  for (entry in list) {
    val ref = itemRef(entry) ?: continue
    if (!seen.add(accountItemKey(ref))) continue
    out += ref.recent(at((entry as Map<*, *>)["openedAtMs"]))
  }
  return out.take(Contracts.recentsMax.toInt())
}

/** The recent items after opening one: it moves to the front, the oldest falls off. */
fun recordRecent(recents: List<RecentItem>, item: AccountItemRef, nowMs: Long): List<RecentItem> = recordRecentPlain(recents, item.toPlain(), nowMs)

/** [recordRecent] for an item as plain values, which may be malformed (then nothing changes). */
fun recordRecentPlain(recents: List<RecentItem>, item: Any?, nowMs: Long): List<RecentItem> {
  val current = recentsFrom(recents.map { it.toPlain() })
  val ref = itemRef(item) ?: return current
  val key = accountItemKey(ref)
  return (listOf(ref.recent(nowMs)) + current.filter { accountItemKey(it) != key }).take(Contracts.recentsMax.toInt())
}

// ── Workspace colors ────────────────────────────────────────────────────────

/** The colors the person picked, by workspace id, the valid ones only. */
fun readWorkspaceColors(profile: Any?): Map<String, String> {
  val stored = field(profile, Contracts.workspaceColorsField) as? Map<*, *> ?: return emptyMap()
  val out = LinkedHashMap<String, String>()
  for ((orgId, color) in stored) {
    if (orgId is String && orgId.isNotEmpty() && isAccountColor(color)) out[orgId] = color as String
    if (out.size >= Contracts.workspaceColorsMax) break
  }
  return out
}

/**
 * The color a workspace with no picked, brand or logo color shows on its tile: one of `WORKSPACE_STABLE_COLORS`, chosen
 * by 32-bit FNV-1a over the id's UTF-16 code units, as the console chooses it, so the same workspace has the same color
 * on every device and in both apps. Null for an empty id.
 */
fun workspaceStableColor(orgId: Any?): String? {
  val palette = Contracts.workspaceStableColors
  if (orgId !is String || orgId.isEmpty() || palette.isEmpty()) return null
  var hash = 0x811C9DC5u
  for (unit in orgId) {
    hash = hash xor unit.code.toUInt()
    hash *= 0x01000193u
  }
  return palette[(hash % palette.size.toUInt()).toInt()]
}

/**
 * A workspace's color: the one the person picked, else its brand color (`brandingProfile.primaryColor`), else a color
 * taken from its logo (Zach, 2026-10-18). A picked color always tints the app; brand and logo colors only while
 * "Use each workspace's brand" is on. Given the workspace's id, one with none of the three gets its stable color
 * ([workspaceStableColor]), which colors only its tile, never the app.
 */
fun resolveWorkspaceColor(
  picked: Any?,
  brandColor: Any?,
  logoColor: Any?,
  useWorkspaceBrand: Boolean,
  orgId: Any? = null,
): WorkspaceColor {
  val stable = workspaceStableColor(orgId)
  return when {
    isAccountColor(picked) -> WorkspaceColor(picked as String, WorkspaceColorSource.PICKED, true)
    isAccountColor(brandColor) -> WorkspaceColor(brandColor as String, WorkspaceColorSource.BRAND, useWorkspaceBrand)
    isAccountColor(logoColor) -> WorkspaceColor(logoColor as String, WorkspaceColorSource.LOGO, useWorkspaceBrand)
    stable != null -> WorkspaceColor(stable, WorkspaceColorSource.STABLE, false)
    else -> WorkspaceColor(null, WorkspaceColorSource.NONE, false)
  }
}

// ── Theme ───────────────────────────────────────────────────────────────────

private fun <E> oneOf(value: Any?, allowed: List<E>, raw: (E) -> String, fallback: E): E =
  allowed.firstOrNull { raw(it) == value } ?: fallback

/** The synced theme, every field filled: a missing or unknown value reads as the default. */
fun readAppTheme(profile: Any?): AppThemePrefs {
  val raw = field(profile, Contracts.appThemeField) as? Map<*, *> ?: emptyMap<String, Any?>()
  val defaults = Contracts.defaultAppTheme
  val accent = raw["accent"]
  val appIcon = raw["appIcon"]
  return AppThemePrefs(
    accent = if (accent == "theme" || isAccountColor(accent)) accent as String else defaults.accent,
    appearance = oneOf(raw["appearance"], Contracts.appAppearances, { it.raw }, defaults.appearance),
    appIcon = if (appIcon is String && appIcon.isNotEmpty() && appIcon.length <= Contracts.appIconIdMax) appIcon else defaults.appIcon,
    density = oneOf(raw["density"], Contracts.appDensities, { it.raw }, defaults.density),
    sidebarStyle = oneOf(raw["sidebarStyle"], Contracts.appSidebarStyles, { it.raw }, defaults.sidebarStyle),
    textSize = oneOf(raw["textSize"], Contracts.appTextSizes, { it.raw }, defaults.textSize),
    theme = oneOf(raw["theme"], Contracts.appThemeNames, { it.raw }, defaults.theme),
    useWorkspaceBrand = raw["useWorkspaceBrand"] as? Boolean ?: defaults.useWorkspaceBrand,
  )
}

/** The theme as the plain values stored under `appTheme`. */
fun AppThemePrefs.toPlain(): Map<String, Any?> = mapOf(
  "appearance" to appearance.raw,
  "theme" to theme.raw,
  "accent" to accent,
  "density" to density.raw,
  "textSize" to textSize.raw,
  "sidebarStyle" to sidebarStyle.raw,
  "appIcon" to appIcon,
  "useWorkspaceBrand" to useWorkspaceBrand,
)
