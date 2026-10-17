package com.aglyn.site

import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestorePage
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.Live
import com.aglyn.site.pages.PAGES_TOP_LEVEL_PAGE
import com.aglyn.site.pages.PagesTreeLoader
import com.aglyn.site.pages.SiteRouting
import com.aglyn.site.pages.pageAncestors
import com.aglyn.site.pages.pageTree
import com.aglyn.site.pages.visiblePageRows
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** A site's screens in memory, answering `__name__` windows and `parentId in` queries the way Firestore pages them. */
private class ScreensReader(private val docs: List<FirestoreDoc>) : FirestoreReader {
  val queries = mutableListOf<FirestoreQuery>()
  var gets = 0

  override suspend fun get(path: String): FirestoreDoc? {
    gets++
    return docs.firstOrNull { it.path == path }
  }

  override suspend fun page(query: FirestoreQuery): FirestorePage {
    queries += query
    val matching = docs.sortedBy { it.path }.filter { doc ->
      query.filters.all { filter -> filter.op == FilterOp.IN && (filter.value as List<*>).contains(doc.data[filter.field]) }
    }
    val after = query.startAfter?.firstOrNull() as? String
    val rest = if (after == null) matching else matching.filter { it.path > after }
    val limit = query.limit ?: rest.size
    val shown = rest.take(limit)
    return FirestorePage(shown, if (rest.size > limit) listOf(shown.last().path) else null)
  }

  override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = emptyFlow()
  override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = emptyFlow()
}

class PagesTreeTest {
  private fun doc(id: String, parent: String? = null, order: Long? = null) = FirestoreDoc(
    id,
    "hosts/h/screens/$id",
    buildMap {
      put("displayName", id)
      parent?.let { put("parentId", it) }
      order?.let { put("order", it) }
    },
  )

  private fun p(i: Int) = "p" + i.toString().padStart(2, '0')

  /** 60 top-level pages; p00..p04 each hold three children, and each p00's child holds two more (three levels). */
  private val site = buildList {
    for (i in 0 until 60) add(doc(p(i), order = i.toLong()))
    for (i in 0 until 5) for (j in 0 until 3) add(doc("${p(i)}-c$j", parent = p(i)))
    for (j in 0 until 3) for (k in 0 until 2) add(doc("p00-c$j-g$k", parent = "p00-c$j"))
  }

  @Test
  fun readsTheTopLevelTwentyFiveAtATimeWithItsChildCounts() = runTest {
    val reader = ScreensReader(site)
    val loader = PagesTreeLoader(reader, "h")
    loader.loadMore()
    val tree = pageTree(loader.drawable(), SiteRouting())
    val top = tree.filter { it.depth == 0 }
    assertTrue(top.size >= PAGES_TOP_LEVEL_PAGE, "at least a page of top-level rows")
    // Counts and chevrons are exact before anything is opened: one `in` query per batch of drawn rows.
    assertEquals(3, tree.first { it.page.id == "p00" }.childCount)
    assertTrue(reader.queries.any { q -> q.filters.any { it.op == FilterOp.IN } })
    assertTrue(loader.reads < site.size, "the first screen reads less than the whole site (${loader.reads} of ${site.size})")

    // Collapsed: only the top level shows until a row is opened.
    assertEquals(top.map { it.page.id }, visiblePageRows(tree, emptySet(), Int.MAX_VALUE).rows.map { it.page.id })
    val opened = visiblePageRows(tree, setOf("p00"), Int.MAX_VALUE).rows.map { it.page.id }
    assertEquals(listOf("p00", "p00-c0", "p00-c1", "p00-c2", "p01"), opened.take(5))

    // Opening a row reads its children's children once; opening it again reads nothing.
    loader.expand("p00")
    val afterExpand = loader.reads
    assertEquals(2, pageTree(loader.drawable(), SiteRouting()).first { it.page.id == "p00-c0" }.childCount)
    loader.expand("p00")
    assertEquals(afterExpand, loader.reads)

    // Scrolling on reads the rest of the top level.
    while (!loader.ended) loader.loadMore()
    assertEquals(60, pageTree(loader.drawable(), SiteRouting()).count { it.depth == 0 })
  }

  @Test
  fun aSearchReadsEveryWindowAndFindsAnyPage() = runTest {
    val loader = PagesTreeLoader(ScreensReader(site), "h")
    loader.loadMore()
    loader.loadAll()
    val tree = pageTree(loader.drawable(), SiteRouting())
    assertEquals(listOf("p00-c2-g1"), visiblePageRows(tree, emptySet(), Int.MAX_VALUE, query = "c2-g1").rows.map { it.page.id })
    assertEquals(setOf("p00", "p00-c1"), pageAncestors(tree, "p00-c1-g0"))
  }

  @Test
  fun aLinkToADeepPageReadsItsChainAndAChangeIsPatchedNotReread() = runTest {
    val reader = ScreensReader(site)
    val loader = PagesTreeLoader(reader, "h")
    loader.loadMore()
    loader.reveal("p00-c1-g1")
    assertTrue("p00-c1-g1" in loader.drawable().map { it.id })
    val windows = reader.queries.size
    loader.patch("p03")
    assertEquals(windows, reader.queries.size, "a patch reads documents, never another window")
  }

  @Test
  fun visibleRowsPageTheTopLevel() {
    val tree = pageTree(site.mapNotNull(com.aglyn.site.pages.PageNode::from), SiteRouting())
    val first = visiblePageRows(tree, setOf("p00"), 2)
    assertEquals(listOf("p00", "p00-c0", "p00-c1", "p00-c2", "p01"), first.rows.map { it.page.id })
    assertTrue(first.hasMore)
  }
}
