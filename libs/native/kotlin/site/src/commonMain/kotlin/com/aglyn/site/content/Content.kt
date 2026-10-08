package com.aglyn.site.content

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.ListFilterRequest
import com.aglyn.contracts.ListQueryRequest
import com.aglyn.contracts.ListQuerySort
import com.aglyn.contracts.ListQuerySortDirection
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDelete
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.FirestoreWriter
import com.aglyn.core.field
import com.aglyn.core.firestoreNow
import com.aglyn.core.jsonValue
import com.aglyn.core.listquery.nameSearchTokens
import com.aglyn.core.listquery.planListQuery
import com.aglyn.core.listquery.toFirestoreQuery
import com.aglyn.core.newDocumentId
import com.aglyn.core.nowMillis
import com.aglyn.ui.Load
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/*
 * A site's content collections and their entries, as the console's Content
 * page reads and changes them (`hosts/[host]/content`): the collections
 * (`hosts/{hostId}/collections`, the content kind) and one collection's
 * entries through ENTRY_LIST_QUERY (the status clause and the title search on
 * the one Firestore query). A collection is created, renamed and bound to its
 * pages through `/api/hosts/collections` and erased through
 * `/api/resources/erase`; an entry is created through `/api/hosts/resources`
 * (the quota-counted create) and then saved, published, scheduled, re-dated
 * and deleted with the same document writes the console makes.
 */

/** The entries list's page (the console's table offers 10, 25 and 50). */
const val ENTRY_PAGE_SIZE = 25

/** A collection holds at most this many categories (`COLLECTION_CATEGORIES_MAX`). */
const val COLLECTION_CATEGORIES_MAX = 50

/** What the byline rule says before an entry without one is published (`ENTRY_BYLINE_REQUIRED_MESSAGE`). */
const val ENTRY_BYLINE_REQUIRED_MESSAGE = "Add an author before publishing — pick one or type a custom byline"

/** The search snippet lengths past which the editor warns. */
const val ENTRY_SEO_TITLE_WARN = 60
const val ENTRY_SEO_DESCRIPTION_WARN = 155

/** A slug as the content page makes one (`slugify`): lower case, every run of other characters one hyphen. */
fun contentSlug(text: String): String = text.lowercase().trim().replace(Regex("[^a-z0-9]+"), "-").trim('-')

/** The collection route's slug rule (`^[a-z0-9]+(?:-[a-z0-9]+)*$`). */
val COLLECTION_SLUG_PATTERN = Regex("^[a-z0-9]+(?:-[a-z0-9]+)*$")

/** One category of a collection. */
data class ContentCategory(val id: String, val name: String, val description: String? = null)

/** One content collection. */
data class ContentCollection(
  val id: String,
  val name: String,
  val slug: String,
  val schemaType: String?,
  val excludeFromSearch: Boolean,
  val categories: List<ContentCategory>,
  val listScreenId: String?,
  val entryScreenId: String?,
) {
  companion object {
    /** Null for a collection of another kind (a commerce catalog shares the path). */
    fun from(doc: FirestoreDoc): ContentCollection? {
      val kind = doc.string("kind")
      if (kind != null && kind != "content") return null
      return ContentCollection(
        id = doc.id,
        name = doc.string("displayName")?.ifBlank { null } ?: doc.id,
        slug = doc.string("slug").orEmpty(),
        schemaType = doc.string("schemaType"),
        excludeFromSearch = doc.bool("excludeEntriesFromSearch") == true,
        categories = (doc.data["categories"] as? List<*>)?.mapNotNull { raw ->
          val map = raw as? Map<*, *> ?: return@mapNotNull null
          val id = map["id"] as? String ?: return@mapNotNull null
          ContentCategory(id, (map["name"] as? String) ?: id, map["description"] as? String)
        }.orEmpty(),
        listScreenId = doc.string("listScreenId")?.ifBlank { null },
        entryScreenId = (doc.string("entryScreenId") ?: doc.string("templateScreenId"))?.ifBlank { null },
      )
    }
  }
}

/** The collections in the picker's order: by name. */
fun sortedCollections(docs: List<FirestoreDoc>): List<ContentCollection> = docs.mapNotNull(ContentCollection::from).sortedBy { it.name.lowercase() }

/** A new category's id: its name as a slug (or `category`), made unique with `-2`, `-3`… */
fun newCategoryId(name: String, existing: List<ContentCategory>): String {
  val base = contentSlug(name).ifEmpty { "category" }
  val taken = existing.map { it.id }.toSet()
  if (base !in taken) return base
  var n = 2
  while ("$base-$n" in taken) n += 1
  return "$base-$n"
}

/** One entry, as the list and the editor read it. */
data class ContentEntry(
  val id: String,
  val title: String,
  val slug: String,
  val excerpt: String,
  val body: String,
  val status: String,
  val categoryId: String?,
  val legacyCategory: String?,
  val tags: List<String>,
  val authorId: String?,
  val authorName: String,
  val coverImage: String,
  val coverImageAlt: String,
  val coverVideo: String,
  val coverVideoDuration: Long?,
  val seoTitle: String,
  val seoDescription: String,
  val publishedAt: FirestoreTimestamp?,
  val publishAt: FirestoreTimestamp?,
  val publishSortAt: FirestoreTimestamp?,
  val updatedAt: FirestoreTimestamp?,
) {
  val hasByline: Boolean get() = !authorId.isNullOrBlank() || authorName.isNotBlank()
  val isLive: Boolean get() = status != "draft"

  companion object {
    fun from(doc: FirestoreDoc): ContentEntry = ContentEntry(
      id = doc.id,
      title = doc.string("title")?.ifBlank { null } ?: "Untitled",
      slug = doc.string("slug").orEmpty(),
      excerpt = doc.string("excerpt").orEmpty(),
      body = doc.string("body").orEmpty(),
      status = doc.string("status")?.ifBlank { null } ?: "draft",
      categoryId = doc.string("categoryId")?.ifBlank { null },
      legacyCategory = doc.string("category")?.ifBlank { null },
      tags = (doc.data["tags"] as? List<*>)?.filterIsInstance<String>().orEmpty(),
      authorId = doc.string("authorId")?.ifBlank { null },
      authorName = doc.string("authorName").orEmpty(),
      coverImage = doc.string("coverImage").orEmpty(),
      coverImageAlt = doc.string("coverImageAlt").orEmpty(),
      coverVideo = doc.string("coverVideo").orEmpty(),
      coverVideoDuration = doc.long("coverVideoDuration"),
      seoTitle = doc.string("seoTitle").orEmpty(),
      seoDescription = doc.string("seoDescription").orEmpty(),
      publishedAt = doc.data["publishedAt"] as? FirestoreTimestamp,
      publishAt = doc.data["publishAt"] as? FirestoreTimestamp,
      publishSortAt = doc.data["publishSortAt"] as? FirestoreTimestamp,
      updatedAt = doc.data["updatedAt"] as? FirestoreTimestamp,
    )
  }
}

/** The status chip's words for a stored status. */
fun entryStatusLabel(status: String): String = Contracts.entryStatusOptions.firstOrNull { it.value == status }?.label ?: status.replaceFirstChar { it.uppercase() }

/** The list's order: last edited first, which every entry can be ordered by. */
val ENTRY_LIST_ORDER = ListQuerySort(column = "updatedAt", direction = ListQuerySortDirection.DESC, path = "updatedAt")

/** One entries view: the status clause and the title search, last edited first. */
fun entryRequest(status: String?, search: String): ListQueryRequest = ListQueryRequest(
  clauses = listOfNotNull(status?.let { ListFilterRequest("status", "equals", it) }),
  search = search.trim().ifEmpty { null }?.let { listOf(it) },
  sort = ENTRY_LIST_ORDER,
)

fun entryQuery(hostId: String, collectionId: String, status: String?, search: String, startAfter: List<Any?>? = null): FirestoreQuery =
  planListQuery(Contracts.entryListQuery, entryRequest(status, search))
    .toFirestoreQuery("hosts/$hostId/collections/$collectionId/entries", ENTRY_PAGE_SIZE, startAfter)

/** One collection's entries: the search, the status chip, the rows read so far and whether more are left. */
class EntryListModel(
  private val hostId: String,
  private val collectionId: String,
  private val firestore: FirestoreReader,
  private val scope: CoroutineScope,
) {
  var search by mutableStateOf("")
    private set
  var status by mutableStateOf<String?>(null)
    private set
  var rows by mutableStateOf<Load<List<ContentEntry>>>(Load.Loading)
    private set
  var hasMore by mutableStateOf(false)
    private set
  var refreshing by mutableStateOf(false)
    private set
  private var cursor: List<Any?>? = null
  private var job: Job? = null

  fun type(next: String) {
    if (next == search) return
    search = next
    reload(debounce = true)
  }

  fun pick(next: String?) {
    if (next == status) return
    status = next
    reload()
  }

  fun refresh() {
    refreshing = true
    reload(keep = true)
  }

  fun reload(debounce: Boolean = false, keep: Boolean = false) {
    job?.cancel()
    if (!debounce && !keep) rows = Load.Loading
    job = scope.launch {
      if (debounce) delay(300)
      if (!keep) rows = Load.Loading
      rows = try {
        val page = firestore.page(entryQuery(hostId, collectionId, status, search))
        cursor = page.nextCursor
        hasMore = page.nextCursor != null
        Load.Ready(page.docs.map(ContentEntry::from))
      } catch (error: Throwable) {
        if (error is CancellationException) throw error
        hasMore = false
        Load.Failed("Entries could not be loaded. Check the connection and try again.")
      } finally {
        refreshing = false
      }
    }
  }

  fun loadMore() {
    val after = cursor ?: return
    val shown = (rows as? Load.Ready)?.value ?: return
    if (job?.isActive == true) return
    job = scope.launch {
      runCatching { firestore.page(entryQuery(hostId, collectionId, status, search, after)) }.onSuccess { page ->
        cursor = page.nextCursor
        hasMore = page.nextCursor != null
        rows = Load.Ready(shown + page.docs.map(ContentEntry::from).filter { row -> shown.none { it.id == row.id } })
      }
    }
  }

  fun drop(id: String) {
    (rows as? Load.Ready)?.let { rows = Load.Ready(it.value.filterNot { entry -> entry.id == id }) }
  }
}

/** The editor's fields, as text, and what a save writes from them. */
data class EntryDraft(
  val title: String,
  val slug: String,
  val excerpt: String,
  val body: String,
  val categoryId: String?,
  val tags: List<String>,
  val authorId: String?,
  val authorName: String,
  val coverImage: String,
  val coverImageAlt: String,
  val coverVideo: String,
  val coverVideoDuration: String,
  val seoTitle: String,
  val seoDescription: String,
) {
  /** The slug a save stores: the typed one as a slug, else the title's. */
  val effectiveSlug: String get() = contentSlug(slug).ifEmpty { contentSlug(title) }

  /** The entry editor's save (`setDoc(entry, …, {merge: true})`), field for field. */
  fun payload(): Map<String, Any?> {
    val cover = coverImage.trim()
    val alt = coverImageAlt.trim()
    val video = coverVideo.trim()
    val duration = coverVideoDuration.trim().toDoubleOrNull()?.takeIf { it > 0 }?.let { kotlin.math.round(it).toLong() }
    return buildMap {
      put("title", title.trim())
      put("titleTokens", nameSearchTokens(title.trim()))
      put("slug", effectiveSlug)
      put("excerpt", excerpt.trim())
      put("body", body)
      put("coverImage", cover)
      put("coverImageAlt", if (cover.isNotEmpty() && alt.isNotEmpty()) alt else FirestoreDelete)
      put("coverVideo", video.ifEmpty { FirestoreDelete })
      put("coverVideoDuration", if (video.isNotEmpty() && duration != null) duration else FirestoreDelete)
      put("seoTitle", seoTitle.trim())
      put("seoDescription", seoDescription.trim())
      put("authorId", authorId?.ifBlank { null } ?: FirestoreDelete)
      put("authorName", authorName.trim())
      if (categoryId != null) {
        put("categoryId", categoryId)
        put("category", FirestoreDelete)
      } else {
        put("categoryId", FirestoreDelete)
      }
      put("tags", tags.map { it.trim() }.filter { it.isNotEmpty() })
      put("updatedAt", firestoreNow())
    }
  }

  companion object {
    fun of(entry: ContentEntry) = EntryDraft(
      title = entry.title.takeIf { it != "Untitled" }.orEmpty(),
      slug = entry.slug,
      excerpt = entry.excerpt,
      body = entry.body,
      categoryId = entry.categoryId,
      tags = entry.tags,
      authorId = entry.authorId,
      authorName = entry.authorName,
      coverImage = entry.coverImage,
      coverImageAlt = entry.coverImageAlt,
      coverVideo = entry.coverVideo,
      coverVideoDuration = entry.coverVideoDuration?.toString().orEmpty(),
      seoTitle = entry.seoTitle,
      seoDescription = entry.seoDescription,
    )
  }
}

/** A custom author of the site (`hosts/{hostId}/authors`). */
data class ContentAuthor(val id: String, val name: String)

fun contentAuthorOf(doc: FirestoreDoc) = ContentAuthor(doc.id, doc.string("name")?.ifBlank { null } ?: "Unnamed author")

/** A page an entry or the list can render through. */
data class TemplateScreen(val id: String, val name: String, val kind: String?)

fun templateScreensOf(docs: List<FirestoreDoc>): List<TemplateScreen> = docs
  .filter { it.data["deletedAt"] == null && it.string("kind") != "group" && it.string("kind") != "email" }
  .map { TemplateScreen(it.id, it.string("displayName")?.ifBlank { null } ?: "Untitled page", it.string("kind")) }
  .sortedBy { it.name.lowercase() }

/** The content writes, each the console's own. */
class ContentApi(private val api: ConsoleApiClient, private val writer: FirestoreWriter, private val firestore: FirestoreReader, private val hostId: String) {
  private fun collectionPath(id: String) = "hosts/$hostId/collections/$id"
  private fun entryPath(collectionId: String, id: String) = "${collectionPath(collectionId)}/entries/$id"

  private suspend fun collections(body: Map<String, Any?>) = api.request("/api/hosts/collections", ApiMethod.POST, jsonValue(mapOf("hostId" to hostId) + body))

  /** A new collection, then the pages it was given; answers its id. */
  suspend fun createCollection(name: String, slug: String, listScreenId: String?, entryScreenId: String?): String {
    val id = collections(mapOf("action" to "create", "kind" to "content", "data" to mapOf("displayName" to name.trim(), "slug" to slug))).field("id")
      ?: error("The collection could not be created.")
    if (listScreenId != null) collections(mapOf("action" to "templates", "id" to id, "data" to mapOf("listScreenId" to listScreenId)))
    if (entryScreenId != null) collections(mapOf("action" to "templates", "id" to id, "data" to mapOf("entryScreenId" to entryScreenId, "templateScreenId" to null)))
    return id
  }

  suspend fun renameCollection(id: String, name: String, slug: String) {
    collections(mapOf("action" to "update", "id" to id, "kind" to "content", "data" to mapOf("displayName" to name.trim(), "slug" to slug)))
  }

  /** The list page and the entry page (null clears one). */
  suspend fun setListScreen(id: String, screenId: String?) {
    collections(mapOf("action" to "templates", "id" to id, "data" to mapOf("listScreenId" to screenId)))
  }

  suspend fun setEntryScreen(id: String, screenId: String?) {
    collections(mapOf("action" to "templates", "id" to id, "data" to mapOf("entryScreenId" to screenId, "templateScreenId" to null)))
  }

  suspend fun setSchemaType(id: String, schemaType: String) {
    writer.update(collectionPath(id), mapOf("schemaType" to schemaType, "updatedAt" to firestoreNow()))
  }

  suspend fun setExcludeFromSearch(id: String, exclude: Boolean) {
    writer.update(collectionPath(id), mapOf("excludeEntriesFromSearch" to if (exclude) true else FirestoreDelete, "updatedAt" to firestoreNow()))
  }

  suspend fun setCategories(id: String, categories: List<ContentCategory>) {
    writer.update(
      collectionPath(id),
      mapOf("categories" to categories.map { buildMap { put("id", it.id); put("name", it.name); it.description?.let { d -> put("description", d) } } }),
    )
  }

  /** Erases a collection (admins only; refused while it holds entries or a live page binding). */
  suspend fun deleteCollection(id: String) {
    api.request("/api/resources/erase", ApiMethod.POST, jsonValue(mapOf("scope" to "hosts", "scopeId" to hostId, "kind" to "collections", "id" to id, "collectionKind" to "content")))
  }

  /** Whether another entry of the collection already has [slug]. */
  suspend fun slugTaken(collectionId: String, slug: String, exceptId: String?): Boolean =
    firestore.page(FirestoreQuery("${collectionPath(collectionId)}/entries", filters = listOf(FirestoreFilter("slug", FilterOp.EQ, slug)), limit = 2))
      .docs.any { it.id != exceptId }

  /** A new draft entry through the counted create; answers its id. */
  suspend fun createEntry(collectionId: String, title: String, slug: String): String {
    val id = newDocumentId()
    api.request(
      "/api/hosts/resources",
      ApiMethod.POST,
      jsonValue(mapOf("hostId" to hostId, "resource" to "entry", "parentId" to collectionId, "id" to id, "data" to mapOf("title" to title.trim(), "slug" to slug))),
    )
    return id
  }

  suspend fun saveEntry(collectionId: String, id: String, draft: EntryDraft) {
    writer.merge(entryPath(collectionId, id), draft.payload())
  }

  /** Publishes (keeping a first published date) or takes back to a draft. */
  suspend fun setPublished(collectionId: String, entry: ContentEntry, publish: Boolean) {
    if (publish) {
      val at = entry.publishedAt ?: firestoreNow()
      writer.update(entryPath(collectionId, entry.id), mapOf("status" to "published", "publishedAt" to at, "publishSortAt" to at))
    } else {
      writer.update(entryPath(collectionId, entry.id), mapOf("status" to "draft", "publishedAt" to FirestoreDelete, "publishSortAt" to FirestoreDelete))
    }
  }

  suspend fun schedule(collectionId: String, entry: ContentEntry, atMillis: Long) {
    val at = FirestoreTimestamp(atMillis.floorDiv(1000L), (atMillis.mod(1000L) * 1_000_000).toInt())
    writer.update(entryPath(collectionId, entry.id), mapOf("status" to "scheduled", "publishAt" to at, "publishSortAt" to at))
  }

  /** Re-dates a published entry (never into the future); a scheduled one keeps sorting by its schedule. */
  suspend fun setPublishedDate(collectionId: String, entry: ContentEntry, atMillis: Long) {
    val at = FirestoreTimestamp(atMillis.floorDiv(1000L), (atMillis.mod(1000L) * 1_000_000).toInt())
    val sort = if (entry.status == "scheduled" && entry.publishAt != null) entry.publishAt else at
    writer.update(entryPath(collectionId, entry.id), mapOf("publishedAt" to at, "publishSortAt" to sort))
  }

  suspend fun deleteEntry(collectionId: String, id: String) {
    writer.delete(entryPath(collectionId, id))
  }

  /** Tells the live site a collection's entries changed; never fails the write before it. */
  suspend fun announce(collectionId: String, slugs: List<String>) {
    runCatching {
      api.request(
        "/api/screens/revalidate",
        ApiMethod.POST,
        jsonValue(mapOf("hostId" to hostId, "collectionId" to collectionId, "entrySlugs" to slugs.filter { it.isNotBlank() })),
      )
    }
  }
}

/** Whether [atMillis] may be a schedule (in the future) or a published date (not). */
fun isFuture(atMillis: Long, now: Long = nowMillis()): Boolean = atMillis > now
