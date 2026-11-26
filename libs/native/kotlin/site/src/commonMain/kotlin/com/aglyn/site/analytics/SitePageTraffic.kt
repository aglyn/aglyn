package com.aglyn.site.analytics

import com.aglyn.contracts.ScreenTrafficRow

/*
 * WHICH PAGE OF A SITE A COUNTED PATH IS, for the Pages table (AGL-4253), ported from the console's
 * `app-utils/page-traffic.ts` and `utils/site-page-labels.ts`. The table grouped views by SCREEN, and every product,
 * store collection and post renders through ONE template screen, so a store's catalog showed as one row named after its
 * template. Views now come from the day documents' per-path counts (`hosts/{id}/analytics/{day}.paths`) and the template
 * is only how a path gets its name. A path is classified in the site loader's order: a routed screen that is not a
 * template, then a plugin record at `/{segment}/{slug}`, then a content collection's list or entry, else an address
 * nothing answers now. The Apple twin is AglynSite/SitePageTraffic.swift.
 */

/** The routing map's key for the site root. */
const val SCREEN_ROOT_PATH = "/"

/** What a counted path is, in the site loader's order. */
sealed interface PagePathClass {
  /** One of the site's own pages, routed at this path. */
  data class Page(val screenId: String) : PagePathClass
  /** A plugin's record page: `/{segment}/{slug}`. */
  data class Record(val segment: String, val slug: String) : PagePathClass
  /** A content collection's list, or one of its paged, cursor or category lists. */
  data class CollectionList(val collectionSlug: String) : PagePathClass
  /** One entry of a content collection: `/{collection}/{entry}`. */
  data class Entry(val collectionSlug: String, val entrySlug: String) : PagePathClass
  /** Nothing on the site answers this path now. */
  data object Other : PagePathClass
}

data class PagePathContext(
  /** The host doc's routing map: screen id → route path (`/` or `a/b`). */
  val routes: Map<String, String>,
  /** Screens a collection or the store renders records through. */
  val templateScreenIds: Set<String>,
  /** Path segments records are served under (`products`). */
  val recordSegments: Set<String>,
  /** Slugs of the site's content collections. */
  val contentCollectionSlugs: Set<String>,
)

/** A counted path in the routing map's form: no leading or trailing slash, no query, the root as `/`. */
fun normalizeCountedPath(path: String): String = path.substringBefore('?').trim('/').ifEmpty { SCREEN_ROOT_PATH }

/** The path as a visitor types it: always one leading slash. */
fun displayCountedPath(path: String): String = normalizeCountedPath(path).let { if (it == SCREEN_ROOT_PATH) "/" else "/$it" }

private val POSITIVE_INTEGER = Regex("^[1-9][0-9]*$")

private fun categorySlug(value: String) = value.trim().lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-')

/** Whether [segments] (a content collection's slug first) address its list (entry null) or one entry; null for neither. */
internal fun collectionRoute(segments: List<String>): Pair<String, String?>? {
  val slug = segments.firstOrNull()?.takeIf { it.isNotEmpty() } ?: return null
  val rest = segments.drop(1)
  return when {
    rest.isEmpty() -> slug to null
    rest.size == 1 -> slug to rest[0]
    rest.size == 2 && rest[0] == "page" -> if (POSITIVE_INTEGER.matches(rest[1])) slug to null else null
    rest.size == 2 && (rest[0] == "after" || rest[0] == "before") -> {
      val cursor = runCatching { percentDecode(rest[1]) }.getOrDefault(rest[1]).trim()
      if (cursor.isEmpty()) null else slug to null
    }
    rest.size == 2 && rest[0] == "category" -> if (categorySlug(rest[1]).isEmpty()) null else slug to null
    rest.size == 4 && rest[0] == "category" && rest[2] == "page" ->
      if (POSITIVE_INTEGER.matches(rest[3]) && categorySlug(rest[1]).isNotEmpty()) slug to null else null
    else -> null
  }
}

private fun percentDecode(value: String): String {
  val bytes = mutableListOf<Byte>()
  var index = 0
  while (index < value.length) {
    val char = value[index]
    val hex = if (char == '%' && index + 2 < value.length) value.substring(index + 1, index + 3).toIntOrNull(16) else null
    if (hex != null) {
      bytes += hex.toByte()
      index += 3
    } else {
      bytes += char.toString().encodeToByteArray().toList()
      index += 1
    }
  }
  return bytes.toByteArray().decodeToString()
}

fun classifyPagePath(path: String, context: PagePathContext): PagePathClass {
  val normalized = normalizeCountedPath(path)
  // The first owner in key order: Firestore hands a map out sorted, as the console reads it.
  val owner = context.routes.entries.sortedBy { it.key }.firstOrNull { it.value == normalized }?.key
  if (owner != null && owner !in context.templateScreenIds) return PagePathClass.Page(owner)
  if (normalized == SCREEN_ROOT_PATH) return PagePathClass.Other
  val segments = normalized.split('/')
  if (segments.size == 2 && segments[0] in context.recordSegments) return PagePathClass.Record(segments[0], segments[1])
  if (segments[0] in context.contentCollectionSlugs) {
    collectionRoute(segments)?.let { (collection, entry) ->
      return if (entry != null) PagePathClass.Entry(collection, entry) else PagePathClass.CollectionList(collection)
    }
  }
  return PagePathClass.Other
}

/**
 * Every path's views over the days, merged by the path's normalized form (`/shop` and `/shop/` are one row), most viewed
 * first; a zero or negative count is not a visit.
 */
fun rollUpPathViews(days: List<Map<String, Double>>): List<Pair<String, Double>> {
  val totals = linkedMapOf<String, Double>()
  days.forEach { day ->
    day.forEach { (key, views) ->
      if (views.isFinite() && views > 0) normalizeCountedPath(key).let { totals[it] = (totals[it] ?: 0.0) + views }
    }
  }
  return totals.entries.map { it.key to it.value }.sortedWith(compareByDescending<Pair<String, Double>> { it.second }.thenBy { it.first })
}

/**
 * The record pages the store serves (the console's `registerSitePathKind` calls in the commerce plugin): native has no
 * plugin registry for site paths, so the two kinds are named here.
 */
data class SitePathKind(
  val segment: String,
  val groupLabel: String,
  val noun: String,
  /** The site subcollection the records live in. */
  val collection: String,
  /** Store collections share `collections` with content collections; only `kind: catalog` is one. */
  val catalogOnly: Boolean,
) {
  fun accepts(data: Map<String, Any?>): Boolean = !catalogOnly || data["kind"] == "catalog"

  companion object {
    val PRODUCTS = SitePathKind("products", "Products", "product", "products", catalogOnly = false)
    val STORE_COLLECTIONS = SitePathKind("collections", "Collections", "collection", "collections", catalogOnly = true)
    val ALL = listOf(PRODUCTS, STORE_COLLECTIONS)
  }
}

/** One grouping of the Pages table: Pages, Products, a blog… */
data class SitePageGroup(val id: String, val label: String) {
  companion object {
    val PAGES = SitePageGroup("pages", "Pages")
    val OTHER = SitePageGroup("other", "Other addresses")
  }
}

/** What a counted path is, in words a site owner reads: the product's name, the post's title, the page's title. */
data class SitePageLabel(
  /** The path as a visitor types it: `/products/nova`. */
  val path: String,
  val group: SitePageGroup,
  val title: String,
  /** A second line when the title alone would mislead: a removed record. */
  val note: String? = null,
  /** The live page; null when nothing answers the path now. */
  val liveUrl: String? = null,
  /** The routed screen, for a page that is one screen at one path: the only rows whose device and referrer are its own. */
  val screenId: String? = null,
  /** The product a `/products/{slug}` row names, for opening its editor. */
  val productId: String? = null,
) {
  companion object {
    /** A path shown by its address, when the names could not be read. */
    fun unlabeled(path: String) = SitePageLabel(displayCountedPath(path), SitePageGroup.OTHER, displayCountedPath(path))
  }
}

private fun text(value: Any?): String = (value as? String)?.trim().orEmpty()

/** A site's facts the labels need: its routing map, its public origin and its collections (`hosts/{id}/collections`). */
data class SitePageFacts(
  val routes: Map<String, String>,
  val origin: String?,
  val collections: List<Pair<String, Map<String, Any?>>>,
) {
  /** Content collections by slug, each with its id (a collection without `kind: catalog` is content). */
  val contentBySlug: Map<String, Pair<String, Map<String, Any?>>> by lazy {
    val found = linkedMapOf<String, Pair<String, Map<String, Any?>>>()
    collections.filter { it.second["kind"] != "catalog" }.forEach { (id, data) ->
      val slug = text(data["slug"])
      if (slug.isNotEmpty() && slug !in found) found[slug] = id to data
    }
    found
  }

  /** Every screen a collection designates as a list or entry template (`collectionTemplateScreenIds`). */
  val templateScreenIds: Set<String>
    get() = collections.flatMap { (_, data) -> listOf("listScreenId", "entryScreenId", "templateScreenId").mapNotNull { (data[it] as? String)?.takeIf { s -> s.isNotEmpty() } } }.toSet()

  val context: PagePathContext
    get() = PagePathContext(routes, templateScreenIds, SitePathKind.ALL.map { it.segment }.toSet(), contentBySlug.keys)
}

/** What the labels of some classified paths read: each source is one batch. */
data class SitePageReads(
  val screenIds: List<String>,
  /** Record slugs by segment. */
  val recordSlugs: Map<String, List<String>>,
  /** Entry slugs by content collection slug. */
  val entrySlugs: Map<String, List<String>>,
) {
  companion object {
    fun of(classes: List<PagePathClass>): SitePageReads {
      val screens = linkedSetOf<String>()
      val records = linkedMapOf<String, LinkedHashSet<String>>()
      val entries = linkedMapOf<String, LinkedHashSet<String>>()
      classes.forEach { found ->
        when (found) {
          is PagePathClass.Page -> screens += found.screenId
          is PagePathClass.Record -> records.getOrPut(found.segment) { linkedSetOf() } += found.slug
          is PagePathClass.Entry -> entries.getOrPut(found.collectionSlug) { linkedSetOf() } += found.entrySlug
          else -> Unit
        }
      }
      return SitePageReads(screens.toList(), records.mapValues { it.value.toList() }, entries.mapValues { it.value.toList() })
    }
  }
}

/** What those reads found: screens by id, records by segment then slug, entries by collection slug then slug (id to data). */
data class SitePageFound(
  val screens: Map<String, Map<String, Any?>> = emptyMap(),
  val records: Map<String, Map<String, Pair<String, Map<String, Any?>>>> = emptyMap(),
  val entries: Map<String, Map<String, Pair<String, Map<String, Any?>>>> = emptyMap(),
)

/** Names one classified path (`labelSitePaths`). */
fun sitePageLabel(path: String, found: PagePathClass, facts: SitePageFacts, read: SitePageFound): SitePageLabel {
  val shown = displayCountedPath(path)
  val live = facts.origin?.let { "$it${if (shown == "/") "" else shown}" }
  return when (found) {
    is PagePathClass.Page -> {
      val screen = read.screens[found.screenId]
      val title = listOf(text(screen?.get("displayName")), text(screen?.get("name"))).firstOrNull { it.isNotEmpty() } ?: if (shown == "/") "Home" else shown
      SitePageLabel(shown, SitePageGroup.PAGES, title, liveUrl = live, screenId = found.screenId)
    }
    is PagePathClass.Record -> {
      val kind = SitePathKind.ALL.firstOrNull { it.segment == found.segment } ?: SitePathKind.PRODUCTS
      val record = read.records[found.segment]?.get(found.slug)
      val title = record?.let { text(it.second["name"]) }.orEmpty()
      SitePageLabel(
        shown, SitePageGroup("record:${found.segment}", kind.groupLabel), title.ifEmpty { shown },
        note = if (record == null) "Not a ${kind.noun} on this site now" else null,
        liveUrl = if (record == null) null else live,
        productId = if (kind == SitePathKind.PRODUCTS) record?.first else null,
      )
    }
    is PagePathClass.CollectionList, is PagePathClass.Entry -> {
      val slug = if (found is PagePathClass.Entry) found.collectionSlug else (found as PagePathClass.CollectionList).collectionSlug
      val owner = facts.contentBySlug[slug]?.second
      val name = listOf(text(owner?.get("displayName")), text(owner?.get("name"))).firstOrNull { it.isNotEmpty() } ?: slug
      val group = SitePageGroup("content:$slug", name)
      if (found is PagePathClass.Entry) {
        val entry = read.entries[slug]?.get(found.entrySlug)
        val title = entry?.let { text(it.second["title"]) }.orEmpty()
        SitePageLabel(shown, group, title.ifEmpty { shown }, note = if (entry == null) "Not in $name now" else null, liveUrl = if (entry == null) null else live)
      } else {
        SitePageLabel(shown, group, "$name (list page)", liveUrl = live)
      }
    }
    PagePathClass.Other -> SitePageLabel(shown, SitePageGroup.OTHER, shown, note = "No page answers this address now")
  }
}

/** One row of the Pages table; [screen] is this page's own device and referrer, null where not counted per page. */
data class SitePageRow(val path: String, val views: Double, val label: SitePageLabel, val screen: ScreenTrafficRow?)

/** A kind the rows hold: its rows and views. */
data class SitePageGroupTally(val group: SitePageGroup, val count: Int, val views: Double)

/** The kinds the rows hold, most visited first, Other addresses always last. */
fun sitePageGroups(rows: List<SitePageRow>): List<SitePageGroupTally> {
  val tally = linkedMapOf<SitePageGroup, SitePageGroupTally>()
  rows.forEach { row ->
    val one = tally[row.label.group] ?: SitePageGroupTally(row.label.group, 0, 0.0)
    tally[row.label.group] = one.copy(count = one.count + 1, views = one.views + row.views)
  }
  return tally.values.sortedWith(compareBy<SitePageGroupTally> { it.group == SitePageGroup.OTHER }.thenByDescending { it.views })
}
