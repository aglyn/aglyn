package com.aglyn.site.pages

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** The most ids one Firestore `in` filter takes. */
internal const val FIRESTORE_IN_MAX = 30

/** Top-level as the routing code reads it (`screen-route.ts`): no parent, or an empty one. */
private fun isTopLevel(page: PageNode): Boolean = page.parentId.isNullOrEmpty()

/**
 * A site's pages read as far as the list shows them (AGL-3896), the same on Apple and Android:
 *
 * - the top level pages through the screens by `__name__` (the console's order), [PAGES_TOP_LEVEL_PAGE] at a time, until
 *   that many NEW top-level rows are in hand or the collection ends; every document read is kept, children included;
 * - for each batch of rows drawn, one `parentId in [ids]` query (30 ids at most, single-field, the automatic index) gives
 *   exact child counts and chevrons, and the children are in hand before a row is opened; opening a row asks the same of
 *   its children, so the next level's chevrons are right. No parent's children are read twice;
 * - a search, a move or anything that needs every page reads the windows left ([loadAll]);
 * - a change patches the cache ([patch]) instead of reading the site again.
 *
 * [reads] counts the documents fetched, for the before/after numbers.
 */
@Stable
class PagesTreeLoader(private val firestore: FirestoreReader, private val hostId: String) {
  private val collection = "hosts/$hostId/screens"
  private val order = listOf(FirestoreOrder("__name__"))
  private val lock = Mutex()
  private var cursor: List<Any?>? = null
  private val childrenRead = mutableSetOf<String>()

  /** Every page read, by id. */
  var pages by mutableStateOf<Map<String, PageNode>>(emptyMap())
    private set
  var ended by mutableStateOf(false)
    private set
  var loading by mutableStateOf(false)
    private set
  var error by mutableStateOf<String?>(null)
    private set
  /** Whether the first windows have answered, so an empty site reads as empty rather than loading. */
  var started by mutableStateOf(false)
    private set
  var reads by mutableStateOf(0)
    private set

  /** The loaded pages the list may draw: a child shows once its parent is in hand (or, every window read, at the top). */
  fun drawable(): List<PageNode> {
    val known = pages
    if (ended) return known.values.toList()
    fun reachable(page: PageNode, depth: Int = 0): Boolean =
      isTopLevel(page) || (depth < 64 && known[page.parentId]?.let { reachable(it, depth + 1) } == true)
    return known.values.filter { reachable(it) }
  }

  private fun keep(docs: List<FirestoreDoc>) {
    reads += docs.size
    if (docs.isEmpty()) return
    val next = pages.toMutableMap()
    for (doc in docs) {
      val page = PageNode.from(doc)
      if (page == null) next.remove(doc.id) else next[doc.id] = page
    }
    pages = next
  }

  private suspend fun guarded(block: suspend () -> Unit) {
    loading = true
    error = null
    try {
      block()
    } catch (failure: CancellationException) {
      throw failure
    } catch (failure: Throwable) {
      error = failure.message ?: "Could not load this site's pages."
    } finally {
      loading = false
      started = true
    }
  }

  /** One window by `__name__`; answers the top-level pages it brought that were not in hand before. */
  private suspend fun window(): List<String> {
    val before = pages.keys
    val page = firestore.page(FirestoreQuery(collection, orderBy = order, limit = PAGES_TOP_LEVEL_PAGE, startAfter = cursor))
    keep(page.docs)
    cursor = page.nextCursor
    if (page.nextCursor == null) ended = true
    return page.docs.mapNotNull { doc -> pages[doc.id]?.takeIf { it.id !in before && isTopLevel(it) }?.id }
  }

  /** The children of [parents] not read yet: one `in` query per 30 ids. */
  private suspend fun children(parents: Collection<String>) {
    val wanted = parents.filter { it !in childrenRead }
    for (chunk in wanted.chunked(FIRESTORE_IN_MAX)) {
      var after: List<Any?>? = null
      do {
        val page = firestore.page(
          FirestoreQuery(collection, filters = listOf(FirestoreFilter("parentId", FilterOp.IN, chunk)), orderBy = order, limit = 100, startAfter = after),
        )
        keep(page.docs)
        after = page.nextCursor
      } while (after != null)
      childrenRead += chunk
    }
  }

  /** The next [PAGES_TOP_LEVEL_PAGE] top-level rows (the first call reads the first), with their children's counts. */
  suspend fun loadMore() = lock.withLock {
    if (ended && started) return@withLock
    guarded {
      val drawn = mutableListOf<String>()
      while (drawn.size < PAGES_TOP_LEVEL_PAGE && !ended) drawn += window()
      children(drawn)
    }
  }

  /** A row opened: its children's children are read, so their chevrons and counts are right. */
  suspend fun expand(id: String) = lock.withLock {
    guarded { children(pages.values.filter { it.parentId == id }.map { it.id }) }
  }

  /** Every page, for a search, a move's parent list or anything else that must see the whole site. */
  suspend fun loadAll() = lock.withLock {
    if (ended) return@withLock
    guarded {
      while (!ended) window()
      childrenRead += pages.keys
    }
  }

  /** A page a link names, with each parent up its chain, read when not in hand (so its row can show, opened to). */
  suspend fun reveal(id: String) = lock.withLock {
    guarded {
      var next: String? = id
      var depth = 0
      while (next != null && depth++ < 64) {
        val known = pages[next] ?: firestore.get("$collection/$next").also { reads++ }?.let(PageNode::from)?.also { pages = pages + (it.id to it) }
        next = known?.parentId?.takeIf { it.isNotEmpty() }
      }
    }
  }

  /** After a change: the changed page read again, and the children it had (a deleted group's move up). */
  suspend fun patch(vararg ids: String) = lock.withLock {
    guarded {
      for (id in ids) {
        val affected = listOf(id) + pages.values.filter { it.parentId == id }.map { it.id }
        val docs = affected.map { it to firestore.get("$collection/$it") }
        reads += docs.size
        val next = pages.toMutableMap()
        for ((key, doc) in docs) {
          val page = doc?.let(PageNode::from)
          if (page == null) next.remove(key) else next[key] = page
        }
        pages = next
      }
    }
  }
}
