package com.aglyn.contracts

/*
 * The native apps' navigation as data (AGL-3943), ported once from
 * libs/aglyn/src/lib/app-utils/native-nav.ts, one-box-search.ts and name-match.ts and held
 * to them by NavRulesCasesTest: the lists a scope shows, and the screens-and-settings matches
 * the one box offers before the server answers.
 */

/** The manifest both shells draw. */
val NativeNavManifestValue: NativeNavManifest get() = Contracts.nativeNavManifest

/**
 * One list for the workspace or site in hand: rows of plugins that are off, and admin rows for a non-admin, left out; a
 * section of another plugin than its row's hides with that plugin; a group left empty is dropped unless the shell fills it.
 */
fun resolveNavList(manifest: NativeNavManifest, listId: NativeNavListId, enabledPluginIds: Collection<String>, hostAdmin: Boolean): ResolvedNavList {
  val list = manifest.lists.firstOrNull { it.id == listId } ?: return ResolvedNavList(emptyList(), listId)
  val on = enabledPluginIds.toSet()
  fun shows(pluginId: String?) = pluginId == null || pluginId in on
  val groups = list.groups.mapNotNull { group ->
    val rows = group.rows
      .filter { shows(it.pluginId) && (hostAdmin || it.requiresHostAdmin != true) }
      .map { row -> row.sections?.let { sections -> row.copy(sections = sections.filter { shows(it.pluginId) }) } ?: row }
    if (rows.isEmpty() && group.dynamic == null) null else group.copy(rows = rows)
  }
  return ResolvedNavList(groups, list.id, list.title)
}

/** [resolveNavList] on the manifest this build carries. */
fun resolveNavList(listId: NativeNavListId, enabledPluginIds: Collection<String>, hostAdmin: Boolean): ResolvedNavList =
  resolveNavList(NativeNavManifestValue, listId, enabledPluginIds, hostAdmin)

// ── Create menus (native-nav.ts) ────────────────────────────────────────────

/**
 * The "+" menu for a scope: items of a plugin that is off, and admin-only items for a non-admin, left out; an item the
 * person lacks the permission, the site role or the plan for stays, blocked with why (`resolveCreateList`).
 */
fun resolveCreateList(
  manifest: NativeNavManifest,
  scope: NativeNavCreateScope,
  enabledPluginIds: Collection<String>,
  permissions: Map<String, Boolean>,
  features: Map<String, Boolean>,
  hostRole: String?,
): List<ResolvedCreateItem> {
  val on = enabledPluginIds.toSet()
  val items = manifest.create?.firstOrNull { it.scope == scope }?.items.orEmpty()
  return items
    .filter { (it.pluginId == null || it.pluginId in on) && (it.requiresHostAdmin != true || hostRole == "admin") }
    .map { item ->
      val reason = when {
        item.permission != null && permissions[item.permission] != true -> Contracts.nativeCreatePermissionReason
        item.hostRoles != null && (hostRole ?: "") !in item.hostRoles -> Contracts.nativeCreateSiteRoleReason
        item.planFeature != null && features[item.planFeature] != true -> item.blockedReason ?: Contracts.nativeCreatePlanReason
        else -> null
      }
      item.resolved(blocked = reason != null, reason = reason)
    }
}

/** [resolveCreateList] on the manifest this build carries. */
fun resolveCreateList(
  scope: NativeNavCreateScope,
  enabledPluginIds: Collection<String>,
  permissions: Map<String, Boolean>,
  features: Map<String, Boolean>,
  hostRole: String?,
): List<ResolvedCreateItem> = resolveCreateList(NativeNavManifestValue, scope, enabledPluginIds, permissions, features, hostRole)

private fun NativeNavCreateItem.resolved(blocked: Boolean, reason: String?) = ResolvedCreateItem(
  blocked = blocked, blockedReason = blockedReason, console = console, hostRoles = hostRoles, icon = icon, id = id, label = label,
  order = order, params = params, permission = permission, planFeature = planFeature, pluginId = pluginId, reason = reason,
  requiresHostAdmin = requiresHostAdmin, screen = screen,
)

// ── Name matching (name-match.ts) ───────────────────────────────────────────

object MatchScore {
  const val EXACT = 1000
  const val NAME_PREFIX = 800
  const val WORD_PREFIX = 600
  const val SUBSTRING = 400
  const val ALL_WORDS = 200
  const val SECONDARY = 100
}

private val wordSplit = Regex("[^\\p{L}\\p{N}]+")
private val marks = Regex("\\p{M}+")

/** Lower case, accents dropped, trimmed: what a search compares. */
fun foldForSearch(value: String?): String = normalizeNfkd(value.orEmpty()).replace(marks, "").lowercase().trim()

fun searchWords(query: String?): List<String> = foldForSearch(query).split(wordSplit).filter { it.isNotEmpty() }

/** The shortest query worth searching. */
const val MIN_QUERY_LENGTH = 2

fun isSearchableQuery(query: String?): Boolean = foldForSearch(query).length >= MIN_QUERY_LENGTH

/** How well [name] (or, failing it, [extra]) matches [query]; null when it does not. */
fun scoreMatch(name: String, extra: List<String?>, query: String): Int? {
  val words = searchWords(query)
  if (words.isEmpty()) return null
  val folded = foldForSearch(name)
  val nameWords = folded.split(wordSplit).filter { it.isNotEmpty() }
  val phrase = words.joinToString(" ")
  if (folded == phrase) return MatchScore.EXACT
  if (folded.startsWith(phrase)) return MatchScore.NAME_PREFIX
  if (nameWords.any { it.startsWith(phrase) }) return MatchScore.WORD_PREFIX
  if (folded.contains(phrase)) return MatchScore.SUBSTRING
  if (words.all { word -> nameWords.any { it.startsWith(word) } }) return MatchScore.ALL_WORDS
  val haystack = extra.map { foldForSearch(it) }.filter { it.isNotEmpty() }
  if (haystack.isNotEmpty()) {
    val joined = haystack.joinToString(" ")
    if (words.all { joined.contains(it) }) return MatchScore.SECONDARY
  }
  return null
}

/** Score first, then the shorter label, then A to Z. */
val scoredOrder: Comparator<Pair<Int, String>> = Comparator { a, b ->
  when {
    a.first != b.first -> b.first - a.first
    a.second.length != b.second.length -> a.second.length - b.second.length
    else -> a.second.compareTo(b.second)
  }
}

// ── Screens and settings in the one box (one-box-search.ts) ─────────────────

/** A screens-and-settings match before ranking. */
data class OneBoxScored(val row: OneBoxRow, val score: Int)

enum class OneBoxScope { ACCOUNT, WORKSPACE, SITE }

private val listHeadings = mapOf(
  NativeNavListId.WORKSPACE to "Workspace",
  NativeNavListId.SITE to "Site",
  NativeNavListId.WORKSPACE_SETTINGS to "Workspace settings",
  NativeNavListId.SITE_SETTINGS to "Site settings",
)

/**
 * The screens-and-settings matches for where the person stands: the workspace's lists with no site, the site's lists (and
 * the workspace settings) with one, for the plugins on in that scope.
 */
fun searchNavScreens(text: String, scope: OneBoxScope, enabledPluginIds: Collection<String>, hostAdmin: Boolean): List<OneBoxScored> =
  searchNavScreens(NativeNavManifestValue, text, scope, enabledPluginIds, hostAdmin)

fun searchNavScreens(manifest: NativeNavManifest, text: String, scope: OneBoxScope, enabledPluginIds: Collection<String>, hostAdmin: Boolean): List<OneBoxScored> {
  if (!isSearchableQuery(text) || scope == OneBoxScope.ACCOUNT) return emptyList()
  val lists = if (scope == OneBoxScope.SITE) {
    listOf(NativeNavListId.SITE, NativeNavListId.SITE_SETTINGS, NativeNavListId.WORKSPACE_SETTINGS)
  } else {
    listOf(NativeNavListId.WORKSPACE, NativeNavListId.WORKSPACE_SETTINGS)
  }
  data class Entry(val id: String, val label: String, val screen: String, val params: Map<String, String>?, val keywords: List<String>)
  val seen = mutableSetOf<String>()
  val out = mutableListOf<OneBoxScored>()
  for (listId in lists) {
    val heading = listHeadings.getValue(listId)
    for (group in resolveNavList(manifest, listId, enabledPluginIds, hostAdmin).groups) {
      for (row in group.rows) {
        val where = group.label?.let { "$heading · $it" } ?: heading
        val entries = listOf(Entry("${listId.raw}.${row.id}", row.label, row.screen, row.params, row.keywords.orEmpty() + (group.label ?: ""))) +
          row.sections.orEmpty().filter { it.label != row.label }.map { section ->
            Entry("${listId.raw}.${row.id}.${section.id}", section.label, section.screen, section.params, listOf(row.label, group.label ?: ""))
          }
        for (entry in entries) {
          val key = "${entry.screen}|${entry.params.orEmpty().entries.joinToString(",") { "${it.key}=${it.value}" }}"
          if (key in seen || entry.screen == "shell.home") continue
          val score = scoreMatch(entry.label, entry.keywords, text) ?: continue
          seen += key
          out += OneBoxScored(
            OneBoxRow(
              detail = if (entry.label == row.label) where else "$where · ${row.label}",
              group = Contracts.oneBoxScreensGroup,
              id = entry.id,
              label = entry.label,
              params = entry.params,
              screen = entry.screen,
            ),
            score,
          )
        }
      }
    }
  }
  return out
}

/** The screens-and-settings matches ranked as the one box shows them. */
fun rankedNavScreens(text: String, scope: OneBoxScope, enabledPluginIds: Collection<String>, hostAdmin: Boolean): List<OneBoxRow> =
  searchNavScreens(text, scope, enabledPluginIds, hostAdmin)
    .sortedWith { a, b -> scoredOrder.compare(a.score to a.row.label, b.score to b.row.label) }
    .map { it.row }

// ── The phone's Home (AGL-4006) ─────────────────────────────────────────────

/**
 * The phone's Home: every area of the scope as the same tile, in the sidebar's own groups (its More headed Tools), then
 * the scope's own places last: Overview and Site settings in a site, Team and Workspace settings everywhere. [list] is the
 * scope's everyday list as the app shows it, [team] the workspace settings' Members row when the person may open it, and
 * [ownerName] heads the whole workspace's areas.
 */
fun phoneHomeGroups(list: ResolvedNavList, team: NativeNavRow?, ownerName: String): List<PhoneHomeGroup> {
  val inSite = list.id == NativeNavListId.SITE
  val own = mutableListOf<NativeNavRow>()
  val groups = mutableListOf<PhoneHomeGroup>()
  for (group in list.groups) {
    if (group.dynamic != null) continue
    val rows = group.rows.filter { it.screen != "shell.home" }
    if (group.id == "top" || group.id == "settings") {
      own += rows
      continue
    }
    if (rows.isEmpty()) continue
    val label = Contracts.phoneHomeGroupLabels[group.id] ?: group.label ?: ownerName.ifEmpty { null }
    groups += PhoneHomeGroup(id = group.id, label = label, rows = rows)
  }
  team?.let { own += it.copy(label = Contracts.phoneHomeTeamLabel) }
  own += Contracts.workspaceSettingsRow
  groups += PhoneHomeGroup(
    id = "scope",
    label = if (inSite) Contracts.phoneHomeSiteGroupLabel else Contracts.phoneHomeWorkspaceGroupLabel,
    rows = own,
  )
  return groups
}

/** Whether a Home tile may go in the tab bar: an area, never Home itself or a settings mode. */
fun isTabPinnable(screen: String): Boolean =
  screen != "shell.home" && screen != "shell.workspaceSettings" && screen != "shell.siteSettings"
