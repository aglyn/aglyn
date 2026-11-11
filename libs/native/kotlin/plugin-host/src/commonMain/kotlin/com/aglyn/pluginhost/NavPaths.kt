package com.aglyn.pluginhost

import com.aglyn.contracts.NativeNavListId
import com.aglyn.contracts.NativeNavManifest
import com.aglyn.contracts.NativeNavRow
import com.aglyn.contracts.ResolvedNavList
import io.ktor.http.encodeURLParameter

/*
 * One resolver for every way into a place (AGL-4059): a link (an App Link, `aglyn://`, a notification's or a push's, a
 * search row's) and a stored place (Starred, Recent, a search row's screen) both become the same [NavPath], the levels a
 * person passes navigating there by hand: the sidebar's mode, the area row (or its section), then each screen pushed over
 * it. The Apple kit holds the same port (`NavPaths.swift`), and both replay `libs/native/contracts/nav-path-cases.json`.
 */

/** The list a place's area row is in, and so the mode the sidebar shows it in. */
enum class NavPathMode(val raw: String) {
  /** The scope's everyday list (the site's, or the whole workspace's). */
  MAIN("main"),
  WORKSPACE_SETTINGS("workspaceSettings"),
  SITE_SETTINGS("siteSettings"),
  /** The staff list. */
  STAFF("staff"),
}

/** The shell's own pages a link can name, which no manifest row opens. */
enum class NavShellPage(val raw: String) { HOME("home"), NOTIFICATIONS("notifications"), NOTIFICATION_SETTINGS("notificationSettings") }

/** What the sidebar selects for a place: one of the shell's pages, or a manifest row (or one of its sections). */
sealed interface NavArea {
  data class Shell(val page: NavShellPage) : NavArea
  /** A row by its id, and the screen and params the row or the section opens. */
  data class Row(val id: String, val screen: String, val params: NativeParams = emptyMap()) : NavArea
}

/** One level pushed over the area. */
sealed interface NavStep {
  data class Screen(val screen: String, val params: NativeParams = emptyMap()) : NavStep
  /** A Besigner page (a whole console path), the only web content. */
  data class Besigner(val path: String) : NavStep
  /** A console page the app has no native screen for yet. */
  data class Unavailable(val path: String) : NavStep
}

/**
 * Where a place is, top-down: the sidebar's mode, the area it selects, and what is pushed over the area, the place itself
 * last. Back walks [pushed] up one level at a time; the area's crumbs come from its row.
 */
data class NavPath(val mode: NavPathMode = NavPathMode.MAIN, val area: NavArea, val pushed: List<NavStep> = emptyList()) {
  /**
   * Whether the sidebar's Starred row the place was opened from stays the selected row: only where the sidebar still shows
   * Starred, the scope's everyday list. A place in a settings mode or the staff list selects its own row there (a starred
   * Site settings › SEO selects SEO, AGL-4059).
   */
  val keepsStarredRow: Boolean get() = mode == NavPathMode.MAIN && area is NavArea.Row

  /** The same path with every level's workspace and site slugs dropped: a link carries them, a stored place does not. */
  val unscoped: NavPath
    get() = copy(pushed = pushed.map { if (it is NavStep.Screen) it.copy(params = NavPaths.withoutScope(it.params)) else it })
}

/** The lists a place is looked up in: the manifest's, every plugin's rows in, and the staff list where the person is staff. */
data class NavPathLists(
  val workspace: ResolvedNavList,
  val site: ResolvedNavList,
  val workspaceSettings: ResolvedNavList,
  val siteSettings: ResolvedNavList,
  val staff: ResolvedNavList? = null,
) {
  /** The lists in the order a place is looked for: the scope's own list, its settings, the workspace's settings, staff. */
  internal fun ordered(inSite: Boolean): List<Pair<NavPathMode, ResolvedNavList>> = buildList {
    if (inSite) {
      add(NavPathMode.MAIN to site)
      add(NavPathMode.SITE_SETTINGS to siteSettings)
    } else {
      add(NavPathMode.MAIN to workspace)
    }
    add(NavPathMode.WORKSPACE_SETTINGS to workspaceSettings)
    staff?.let { add(NavPathMode.STAFF to it) }
  }
}

/** A link's workspace and site, and its path. */
data class NavLinkPath(val scope: ConsoleScopeSplit, val path: NavPath)

object NavPaths {
  private const val HOME_SCREEN = "shell.home"
  private const val ANALYTICS_SCREEN = "shell.analytics"

  /** The params a link adds for the workspace and site it names. */
  private val SCOPE_KEYS = setOf("orgSlug", "hostSlug")

  fun withoutScope(params: NativeParams): NativeParams = params.filterKeys { it !in SCOPE_KEYS }

  /**
   * The manifest's lists with every plugin's rows (a place opens under its row even while its plugin's row is hidden),
   * trimmed to the screens [has] says this build has; the shell's own screens are always there.
   */
  fun lists(
    manifest: NativeNavManifest = com.aglyn.contracts.Contracts.nativeNavManifest,
    staff: ResolvedNavList? = null,
    has: (String) -> Boolean,
  ): NavPathLists {
    val plugins = manifest.lists.flatMap { it.groups }.flatMap { it.rows }
      .flatMap { row -> listOf(row.pluginId) + row.sections.orEmpty().map { it.pluginId } }.filterNotNull().distinct()
    fun available(screen: String) = screen.startsWith("shell.") || has(screen)
    fun list(id: NativeNavListId): ResolvedNavList {
      val resolved = com.aglyn.contracts.resolveNavList(manifest, id, plugins, hostAdmin = true)
      return resolved.copy(groups = resolved.groups.map { group ->
        group.copy(rows = group.rows.filter { available(it.screen) }.map { row -> row.copy(sections = row.sections?.filter { available(it.screen) }) })
      })
    }
    return NavPathLists(
      list(NativeNavListId.WORKSPACE), list(NativeNavListId.SITE), list(NativeNavListId.WORKSPACE_SETTINGS),
      list(NativeNavListId.SITE_SETTINGS), staff,
    )
  }

  // Entry points

  /**
   * A console link (an App Link, `aglyn://`, a notification's or a push's link once [DeepLinks.notificationLink] has put it
   * in the console's form, a search row's link): the workspace and site it names, and its path. [inSite] stands for a link
   * that names no workspace (`/manage/…`, `/admin/…`), which opens where the window stands.
   */
  fun link(link: String?, routes: List<NativeDeepLink>, lists: NavPathLists, inSite: Boolean): NavLinkPath? {
    val raw = DeepLinks.consolePathOf(link) ?: return null
    var full = DeepLinks.withoutFragment(raw)
    // An AI job's notice that built nothing of its own to open (`/{hostId}?aiJob=…`) opens that job (AGL-3911).
    aiJobOf(full)?.let { jobId -> full = full.substringBefore('?').trimEnd('/') + "/ai-jobs/" + jobId.encodeURLParameter() }
    val bare = full.substringBefore('?')
    val queryText = if ('?' in full) full.substringAfter('?') else null
    val scope = DeepLinks.splitConsoleScope(bare)
    val here = if (scope.orgSlug != null) scope.hostSlug != null else inSite
    val query = queryText?.let(DeepLinks::parseQuery).orEmpty()
    val rest = scope.rest
    val levels = ancestors(rest, queryText != null, routes).toMutableList()
    DeepLinks.match(rest, query, routes)?.let { (screen, params) ->
      levels += NavStep.Screen(screen, params + listOfNotNull(scope.orgSlug?.let { "orgSlug" to it }, scope.hostSlug?.let { "hostSlug" to it }))
      return NavLinkPath(scope, assemble(levels, here, lists))
    }
    val last: NavStep = when {
      BesignerPaths.isBesignerPath(raw) -> NavStep.Besigner(raw)
      rest.startsWith("/manage/notifications/settings") -> return NavLinkPath(scope, NavPath(area = NavArea.Shell(NavShellPage.NOTIFICATION_SETTINGS)))
      rest.startsWith("/manage/notifications") -> return NavLinkPath(scope, NavPath(area = NavArea.Shell(NavShellPage.NOTIFICATIONS)))
      // The site's Analytics page is the shell's own (`shell.analytics`, the site list's Overview row).
      rest == "/analytics" || rest.startsWith("/analytics/") -> return NavLinkPath(scope, assemble(listOf(NavStep.Screen(ANALYTICS_SCREEN)), here, lists))
      // A workspace's own address (`/{orgSlug}`) and a site's dashboard are their Home.
      scope.orgSlug != null && rest == "/" -> return NavLinkPath(scope, NavPath(area = NavArea.Shell(NavShellPage.HOME)))
      else -> NavStep.Unavailable(full)
    }
    val path = assemble(levels, here, lists)
    return NavLinkPath(scope, path.copy(pushed = path.pushed + last))
  }

  /**
   * A stored place (a Starred or Recent item, a search row's screen): its screen and params, the row it was saved from when
   * it was a sidebar row (`kind` `screen`), and whether it is a site's.
   */
  fun place(
    screen: String,
    params: NativeParams = emptyMap(),
    rowId: String? = null,
    inSite: Boolean,
    routes: List<NativeDeepLink>,
    lists: NavPathLists,
  ): NavPath {
    if (screen == HOME_SCREEN) return NavPath(area = NavArea.Shell(NavShellPage.HOME))
    val own = withoutScope(params)
    // A row the place was saved from opens under that row, on its section when the place is one.
    if (rowId != null) {
      row(rowId, screen, own, inSite, lists)?.let { (mode, row, rowParams) ->
        val extra = own.filter { (key, value) -> rowParams[key] != value }
        return NavPath(mode, NavArea.Row(row.id, screen, rowParams), if (extra.isEmpty()) emptyList() else listOf(NavStep.Screen(screen, own)))
      }
    }
    // Any other place opens where its console address puts it: under each page on the way to it.
    consoleAddress(screen, own, routes)?.let { address ->
      val bare = address.substringBefore('?')
      val queryText = if ('?' in address) address.substringAfter('?') else null
      val levels = ancestors(bare, queryText != null, routes).toMutableList()
      val resolved = DeepLinks.match(bare, queryText?.let(DeepLinks::parseQuery).orEmpty(), routes)?.second.orEmpty()
      levels += NavStep.Screen(screen, resolved + own)
      return assemble(levels, inSite, lists)
    }
    return assemble(listOf(NavStep.Screen(screen, own)), inSite, lists)
  }

  /** A Starred or Recent item, or any account item: a `screen` item is a sidebar row, by its id. */
  fun place(item: com.aglyn.contracts.AccountItemRef, routes: List<NativeDeepLink>, lists: NavPathLists): NavPath =
    place(item.screen, item.params.orEmpty(), item.id.takeIf { item.kind == "screen" }, item.hostId != null, routes, lists)

  /** The row a one-box screens-and-settings match names: its id is `{list}.{row}` or `{list}.{row}.{section}`. */
  fun searchRowId(id: String): String? = id.split('.').getOrNull(1)

  // The path

  /**
   * The pages a console path passes on the way to it, top-down (`/products/orders` above `/products/orders?order=…`,
   * `/crm/contacts` above `/crm/contacts/{id}`): every shorter prefix a route answers.
   */
  internal fun ancestors(rest: String, hadQuery: Boolean, routes: List<NativeDeepLink>): List<NavStep> {
    val segments = rest.split('/').filter { it.isNotEmpty() }
    val candidates = buildList {
      if (hadQuery) add(rest)
      for (count in segments.size - 1 downTo 1) add("/" + segments.take(count).joinToString("/"))
    }
    return candidates.mapNotNull { candidate -> DeepLinks.match(candidate, emptyMap(), routes)?.let { NavStep.Screen(it.first, it.second) } }.reversed()
  }

  private data class RowHit(val mode: NavPathMode, val row: NativeNavRow, val screen: String, val params: NativeParams, val exact: Boolean)

  /**
   * The levels (top-down, the place last) as the sidebar holds them. The first level a row opens is the area; it moves down
   * onto each next level that is exactly a row or section (Marketing, then its Campaigns; Workspace settings' first page,
   * then SSO), staying on the same row while that row holds the level. What is left is pushed over the area, a screen
   * repeated by the next level (a list, then the same list on one record) only once, at its deepest.
   */
  internal fun assemble(levels: List<NavStep>, inSite: Boolean, lists: NavPathLists): NavPath {
    val ordered = lists.ordered(inSite)
    var area: Pair<Int, RowHit>? = null
    for ((index, level) in levels.withIndex()) {
      if (level !is NavStep.Screen) continue
      val current = area
      if (current != null) {
        val section = exactCandidate(level.screen, level.params, current.second.row)
        val hit = if (section == null) rowMatch(level.screen, level.params, ordered) else null
        area = when {
          section != null -> index to current.second.copy(screen = section.first, params = section.second, exact = true)
          hit != null && hit.exact -> index to hit
          else -> break
        }
      } else {
        rowMatch(level.screen, level.params, ordered)?.let { area = index to it }
      }
    }
    var path = NavPath(area = NavArea.Shell(NavShellPage.HOME))
    var rest = levels
    area?.let { (index, hit) ->
      path = NavPath(hit.mode, if (hit.screen == HOME_SCREEN) NavArea.Shell(NavShellPage.HOME) else NavArea.Row(hit.row.id, hit.screen, hit.params))
      rest = levels.drop(index + 1)
    }
    val pushed = mutableListOf<NavStep>()
    for (step in rest) {
      val previous = pushed.lastOrNull()
      if (step is NavStep.Screen && previous is NavStep.Screen && previous.screen == step.screen) pushed[pushed.lastIndex] = step else pushed += step
    }
    // The area's own screen again with nothing more than the area's params is the area.
    val first = pushed.firstOrNull()
    val areaRow = path.area as? NavArea.Row
    if (areaRow != null && first is NavStep.Screen && first.screen == areaRow.screen &&
      withoutScope(first.params).all { (key, value) -> areaRow.params[key] == value }
    ) {
      pushed.removeAt(0)
    }
    return path.copy(pushed = pushed)
  }

  /** The row's own screen and each of its sections', with their params. */
  private fun candidates(row: NativeNavRow): List<Pair<String, NativeParams>> =
    listOf(row.screen to row.params.orEmpty()) + row.sections.orEmpty().map { it.screen to it.params.orEmpty() }

  /** The row's own screen or one of its sections that is exactly this level (no record of its own picked). */
  private fun exactCandidate(screen: String, params: NativeParams, row: NativeNavRow): Pair<String, NativeParams>? {
    val own = withoutScope(params)
    return candidates(row).firstOrNull { it.first == screen && it.second == own }
  }

  /**
   * The best row or section for a screen in the lists, in their order: one whose params the level carries (the more the
   * better), else the first that opens the screen at all.
   */
  private fun rowMatch(screen: String, params: NativeParams, lists: List<Pair<NavPathMode, ResolvedNavList>>): RowHit? {
    val own = withoutScope(params)
    var fallback: RowHit? = null
    for ((mode, list) in lists) {
      var best: RowHit? = null
      for (row in list.groups.flatMap { it.rows }) {
        for ((candidate, candidateParams) in candidates(row)) {
          if (candidate != screen) continue
          if (candidateParams.all { (key, value) -> own[key] == value }) {
            if (best == null || candidateParams.size > best.params.size) best = RowHit(mode, row, screen, candidateParams, candidateParams == own)
          } else if (fallback == null) {
            fallback = RowHit(mode, row, screen, candidateParams, exact = false)
          }
        }
      }
      if (best != null) return best
    }
    return fallback
  }

  /** The row with this id in the lists, when it (or one of its sections) opens [screen], with the section's params. */
  private fun row(id: String, screen: String, params: NativeParams, inSite: Boolean, lists: NavPathLists): Triple<NavPathMode, NativeNavRow, NativeParams>? {
    for ((mode, list) in lists.ordered(inSite)) {
      val row = list.groups.flatMap { it.rows }.firstOrNull { it.id == id } ?: continue
      val matches = candidates(row).filter { it.first == screen }
      if (matches.isEmpty()) continue
      val fitting = matches.filter { (_, candidate) -> candidate.all { (key, value) -> params[key] == value } }
      val pick = fitting.maxByOrNull { it.second.size } ?: matches.first()
      return Triple(mode, row, pick.second)
    }
    return null
  }

  /**
   * The console address (scoped: `/products/orders?order=o1`) a screen and params are at: the route for the screen that
   * takes the most of its params, the shortest on a tie. Null when no route opens the screen with these params.
   */
  fun consoleAddress(screen: String, params: NativeParams, routes: List<NativeDeepLink>): String? {
    var best: Triple<String, Int, Int>? = null
    for (route in routes) {
      if (route.screen != screen) continue
      val pattern = DeepLinks.RoutePattern(route.path)
      val segments = mutableListOf<String>()
      var bound = 0
      var fits = true
      for (segment in pattern.path.split('/').filter { it.isNotEmpty() }) {
        val param = DeepLinks.PathParam.of(segment)
        if (param == null) {
          segments += segment
          continue
        }
        val value = params[param.name]?.takeIf { it.isNotEmpty() && param.admits(it) }
        if (value == null) {
          fits = false
          break
        }
        segments += value.encodeURLParameter()
        bound += 1
      }
      val query = mutableListOf<String>()
      if (fits) {
        for ((key, param) in pattern.query) {
          val value = params[param]?.takeIf { it.isNotEmpty() }
          if (value == null) {
            fits = false
            break
          }
          query += "$key=${value.encodeURLParameter()}"
          bound += 1
        }
      }
      if (!fits) continue
      val address = "/" + segments.joinToString("/") + if (query.isEmpty()) "" else "?" + query.joinToString("&")
      val current = best
      if (current == null || bound > current.second || (bound == current.second && segments.size < current.third)) {
        best = Triple(address, bound, segments.size)
      }
    }
    return best?.first
  }

  /** The job an AI job's notice names on a workspace's or site's own address (`/{orgSlug}/hosts/{hostSlug}?aiJob=…`). */
  private fun aiJobOf(full: String): String? {
    if ('?' !in full) return null
    val path = full.substringBefore('?')
    val scope = DeepLinks.splitConsoleScope(path)
    if (scope.orgSlug == null || scope.rest.trimEnd('/').isNotEmpty()) return null
    return DeepLinks.parseQuery(full.substringAfter('?'))["aiJob"]?.takeIf { it.isNotEmpty() }
  }
}
