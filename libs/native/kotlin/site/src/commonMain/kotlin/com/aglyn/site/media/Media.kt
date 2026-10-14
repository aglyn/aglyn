package com.aglyn.site.media

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.ListFilterRequest
import com.aglyn.contracts.ListQueryFilter
import com.aglyn.contracts.ListQueryOp
import com.aglyn.contracts.ListQueryRequest
import com.aglyn.contracts.MediaSort
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.boolField
import com.aglyn.core.field
import com.aglyn.core.jsonValue
import com.aglyn.core.listquery.MediaNameNormalizers
import com.aglyn.core.listquery.planListQuery
import com.aglyn.core.listquery.toFirestoreQuery
import com.aglyn.ui.Load
import com.aglyn.ui.PickedFile
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

/*
 * A media library as the console's library reads and changes it: a site's
 * (`hosts/{hostId}/media`) or the workspace's (`orgs/{orgId}/media`), its
 * folders, and its files through the library's own query (MEDIA_LIST_QUERY,
 * the folder and the reader's scope as its base, the type, the sort and the
 * search on the one Firestore query). Every write is the console's route:
 * upload (direct or through a signed URL), details, folders, moves, privacy,
 * replace, delete and restore.
 */

/** The library's page of files (`MEDIA_PAGE_SIZE`). */
const val MEDIA_PAGE_SIZE = 60

/** Files above this go through the signed-URL upload (`SIGNED_UPLOAD_THRESHOLD_BYTES`). */
const val SIGNED_UPLOAD_THRESHOLD_BYTES = 3L * 1024 * 1024

/** Where a library lives: a site's own, or the workspace's (seen from [forHostId] when a site is picked). */
sealed interface MediaScope {
  val collection: String
  val id: String

  /** The scope's key in every media route's body. */
  val bodyKey: String

  data class Site(val hostId: String) : MediaScope {
    override val collection = "hosts"
    override val id = hostId
    override val bodyKey = "hostId"
  }

  data class Org(val orgId: String, val forHostId: String?) : MediaScope {
    override val collection = "orgs"
    override val id = orgId
    override val bodyKey = "orgId"
  }

  val path: String get() = "$collection/$id"

  /** The CDN segment of a file's public path (`{hostId}` or `org:{orgId}`). */
  val cdnScope: String get() = if (this is Org) "org:$orgId" else id
}

/** Which folder the grid shows. */
sealed interface FolderPick {
  data object All : FolderPick
  data object Root : FolderPick
  data class One(val id: String) : FolderPick
}

data class MediaFolder(val id: String, val name: String, val parentId: String?, val order: Double?)

fun mediaFolderOf(doc: FirestoreDoc) = MediaFolder(
  id = doc.id,
  name = doc.string("name")?.ifBlank { null } ?: "Untitled folder",
  parentId = doc.string("parentId")?.ifBlank { null },
  order = (doc.data["order"] as? Number)?.toDouble(),
)

/** Folders in the rail's order: `order`, then name. */
fun sortedFolders(folders: List<MediaFolder>): List<MediaFolder> =
  folders.sortedWith(compareBy<MediaFolder>({ it.order ?: Double.MAX_VALUE }, { it.name.lowercase() }))

/** A folder's path for a picker: `Blog / Covers`. */
fun folderPath(folder: MediaFolder, byId: Map<String, MediaFolder>): String {
  val names = mutableListOf<String>()
  var current: MediaFolder? = folder
  val seen = mutableSetOf<String>()
  while (current != null && seen.add(current.id)) {
    names.add(0, current.name)
    current = current.parentId?.let(byId::get)
  }
  return names.joinToString(" / ")
}

/** One file, as the grid and its details read it. */
data class MediaItem(
  val id: String,
  val fileName: String,
  val contentType: String,
  val kind: String,
  val sizeBytes: Long?,
  val width: Long?,
  val height: Long?,
  val url: String?,
  val cdnPath: String?,
  val folderId: String?,
  val alt: String,
  val description: String,
  val tags: List<String>,
  val private: Boolean,
  val createdAt: FirestoreTimestamp?,
  val updatedAt: FirestoreTimestamp?,
  val uploadedBy: String?,
  val visibleTo: List<String>,
) {
  /** Where the file is served from: its CDN path on the console origin, else its stored URL. */
  fun src(origin: String): String? = cdnPath?.let { origin.trimEnd('/') + it } ?: url

  /** A thumbnail at [width] pixels (the CDN's own variants), or the file itself. */
  fun thumbnail(origin: String, width: Int = 320): String? = when {
    kind == "image" && cdnPath != null -> "${origin.trimEnd('/')}$cdnPath?w=$width"
    kind == "video" && cdnPath != null -> "${origin.trimEnd('/')}$cdnPath?poster=1&w=$width"
    kind == "image" -> url
    else -> null
  }

  companion object {
    fun from(doc: FirestoreDoc): MediaItem? {
      if (doc.data["deletedAt"] != null) return null
      val type = doc.string("contentType").orEmpty()
      return MediaItem(
        id = doc.id,
        fileName = doc.string("fileName")?.ifBlank { null } ?: doc.id,
        contentType = type,
        kind = doc.string("kind") ?: com.aglyn.core.listquery.mediaKindOf(type),
        sizeBytes = doc.long("sizeBytes"),
        width = doc.long("width"),
        height = doc.long("height"),
        url = doc.string("url")?.ifBlank { null },
        cdnPath = doc.string("cdnPath")?.ifBlank { null },
        folderId = doc.string("folderId")?.ifBlank { null },
        alt = doc.string("alt").orEmpty(),
        description = doc.string("description").orEmpty(),
        tags = (doc.data["tags"] as? List<*>)?.filterIsInstance<String>().orEmpty(),
        private = doc.bool("private") == true,
        createdAt = doc.data["createdAt"] as? FirestoreTimestamp,
        updatedAt = doc.data["updatedAt"] as? FirestoreTimestamp,
        uploadedBy = doc.string("uploadedBy"),
        visibleTo = (doc.data["visibleTo"] as? List<*>)?.filterIsInstance<String>().orEmpty(),
      )
    }
  }
}

/** The kind's icon, for a tile with no preview. */
fun mediaKindIcon(kind: String): String = when (kind) {
  "image" -> "image"
  "video" -> "video_library"
  "audio" -> "audiotrack"
  "pdf" -> "picture_as_pdf"
  else -> "draft"
}

/** Bytes in the units a person reads: `820 KB`, `4.2 MB`. */
fun formatBytes(bytes: Long?): String {
  if (bytes == null) return "—"
  val kb = bytes / 1024.0
  val mb = kb / 1024.0
  fun one(value: Double) = ((value * 10).toLong() / 10.0).let { if (it == it.toLong().toDouble()) it.toLong().toString() else it.toString() }
  return when {
    mb >= 1 -> "${one(mb)} MB"
    kb >= 1 -> "${kb.toLong()} KB"
    else -> "$bytes B"
  }
}

/** The type chips above the grid: every file, then the Type filter's own options (`MEDIA_TYPE_OPTIONS`). */
fun mediaTypeChoices(): List<Pair<String?, String>> = listOf<Pair<String?, String>>(null to "All") + Contracts.mediaTypeOptions.map { it.value to it.label }

/**
 * The library's request for one view, as `mediaQuery` builds it: the folder
 * and the scope as base filters, the type as a clause, and the search on
 * the name tokens, or, for a reader limited to some sites, a "starts with"
 * on the name (the scope already holds the query's one array clause).
 */
fun mediaRequest(folder: FolderPick, scopeTokens: List<String>?, type: String?, sort: MediaSort, search: String): ListQueryRequest {
  val base = buildList {
    when (folder) {
      FolderPick.All -> Unit
      FolderPick.Root -> add(ListQueryFilter(ListQueryOp.EQUAL, "folderId", JsonNull))
      is FolderPick.One -> add(ListQueryFilter(ListQueryOp.EQUAL, "folderId", JsonPrimitive(folder.id)))
    }
    if (scopeTokens != null) add(ListQueryFilter(ListQueryOp.ARRAY_CONTAINS_ANY, "visibleTo", JsonArray(scopeTokens.map(::JsonPrimitive))))
  }
  val typed = search.trim()
  val scopedSearch = if (scopeTokens != null && typed.isNotEmpty()) ListFilterRequest("fileName", "startsWith", typed) else null
  return ListQueryRequest(
    base = base,
    clauses = listOfNotNull(scopedSearch, type?.let { ListFilterRequest("type", "equals", it) }),
    search = if (scopedSearch == null) typed.ifEmpty { null }?.let { listOf(it) } else null,
    sort = Contracts.mediaSortOrder[sort.raw],
  )
}

fun mediaQuery(scope: MediaScope, folder: FolderPick, scopeTokens: List<String>?, type: String?, sort: MediaSort, search: String, startAfter: List<Any?>? = null): FirestoreQuery =
  planListQuery(Contracts.mediaListQuery, mediaRequest(folder, scopeTokens, type, sort, search), MediaNameNormalizers)
    .toFirestoreQuery("${scope.path}/media", MEDIA_PAGE_SIZE, startAfter)

/** One library view: its folder, filters and the files read so far. */
class MediaListModel(
  private val scope: MediaScope,
  private val firestore: FirestoreReader,
  private val coroutines: CoroutineScope,
) {
  var folder by mutableStateOf<FolderPick>(FolderPick.All)
    private set
  var type by mutableStateOf<String?>(null)
    private set
  var sort by mutableStateOf(MediaSort.NEWEST)
    private set
  var search by mutableStateOf("")
    private set
  var rows by mutableStateOf<Load<List<MediaItem>>>(Load.Loading)
    private set
  var hasMore by mutableStateOf(false)
    private set
  var refreshing by mutableStateOf(false)
    private set

  /** The scope clause a limited reader's queries carry; null reads the whole library. */
  var scopeTokens: List<String>? = null
    private set
  private var cursor: List<Any?>? = null
  private var job: Job? = null
  private var started = false

  fun start(tokens: List<String>?) {
    if (started && tokens == scopeTokens) return
    started = true
    scopeTokens = tokens
    reload()
  }

  private fun query(after: List<Any?>? = null) = mediaQuery(scope, folder, scopeTokens, type, sort, search, after)

  fun open(next: FolderPick) { if (next != folder) { folder = next; reload() } }
  fun pick(next: String?) { if (next != type) { type = next; reload() } }
  fun order(next: MediaSort) { if (next != sort) { sort = next; reload() } }
  fun type(next: String) { if (next != search) { search = next; reload(debounce = true) } }

  fun refresh() {
    refreshing = true
    reload(keep = true)
  }

  fun reload(debounce: Boolean = false, keep: Boolean = false) {
    job?.cancel()
    if (!keep && !debounce) rows = Load.Loading
    job = coroutines.launch {
      if (debounce) delay(300)
      if (!keep) rows = Load.Loading
      rows = try {
        val page = firestore.page(query())
        cursor = page.nextCursor
        hasMore = page.nextCursor != null
        Load.Ready(page.docs.mapNotNull(MediaItem::from))
      } catch (error: Throwable) {
        if (error is CancellationException) throw error
        hasMore = false
        Load.Failed("The library could not be loaded. Check the connection and try again.")
      } finally {
        refreshing = false
      }
    }
  }

  fun loadMore() {
    val after = cursor ?: return
    val shown = (rows as? Load.Ready)?.value ?: return
    if (job?.isActive == true) return
    job = coroutines.launch {
      runCatching { firestore.page(query(after)) }.onSuccess { page ->
        cursor = page.nextCursor
        hasMore = page.nextCursor != null
        rows = Load.Ready(shown + page.docs.mapNotNull(MediaItem::from).filter { row -> shown.none { it.id == row.id } })
      }
    }
  }

  /** Drops a file the person just deleted, without waiting for a reload. */
  fun drop(id: String) {
    (rows as? Load.Ready)?.let { rows = Load.Ready(it.value.filterNot { item -> item.id == id }) }
  }
}

/** Who used a file, as the library's "Used on" lists it. */
data class MediaReference(val kind: String, val name: String, val live: Boolean)

/** The org-wide storage band the library header reads (`GET /api/media/storage`). */
data class MediaStorage(val usedBytes: Long, val allowanceMb: Long?, val unlimited: Boolean)

/**
 * The library's writes, each the console's own route with the scope in the
 * body: upload (direct under [SIGNED_UPLOAD_THRESHOLD_BYTES], a signed URL
 * above it), details, privacy, folders, moves, replace, delete, restore.
 */
@OptIn(ExperimentalEncodingApi::class)
class MediaApi(private val api: ConsoleApiClient, private val scope: MediaScope) {
  private fun body(vararg fields: Pair<String, Any?>): JsonElement = jsonValue(
    buildMap {
      put(scope.bodyKey, scope.id)
      (scope as? MediaScope.Org)?.forHostId?.let { put("forHostId", it) }
      putAll(fields)
    },
  )

  /** Uploads one picked file into [folderId]; answers its media id. */
  suspend fun upload(file: PickedFile, folderId: String?): String? {
    val contentType = file.mimeType.ifBlank { "application/octet-stream" }
    if (file.size <= SIGNED_UPLOAD_THRESHOLD_BYTES) {
      val answer = api.request(
        "/api/media/upload",
        ApiMethod.POST,
        body("fileName" to file.name, "contentType" to contentType, "folderId" to folderId, "data" to Base64.encode(file.bytes)),
      )
      return answer.field("mediaId")
    }
    val minted = api.request(
      "/api/media/upload-url",
      ApiMethod.POST,
      body("contentType" to contentType, "fileName" to file.name, "sizeBytes" to file.size, "folderId" to folderId),
    )
    val mediaId = minted.field("mediaId") ?: return null
    api.putSigned(minted.field("uploadUrl") ?: return null, minted.field("contentType") ?: contentType, file.bytes)
    api.request("/api/media/upload-url", ApiMethod.PATCH, body("mediaId" to mediaId, "fileName" to file.name, "folderId" to folderId))
    return mediaId
  }

  /** Replaces the file's bytes in place: the same id and address everywhere it is used. */
  suspend fun replace(item: MediaItem, file: PickedFile) {
    val contentType = file.mimeType.ifBlank { item.contentType }
    val expected = item.updatedAt?.epochMillis
    if (file.size <= SIGNED_UPLOAD_THRESHOLD_BYTES) {
      api.request(
        "/api/media/replace",
        ApiMethod.POST,
        body("mediaId" to item.id, "contentType" to contentType, "data" to Base64.encode(file.bytes), "fileName" to file.name, "expectedUpdatedAtMs" to expected),
      )
      return
    }
    val minted = api.request(
      "/api/media/replace",
      ApiMethod.PUT,
      body("mediaId" to item.id, "contentType" to contentType, "fileName" to file.name, "sizeBytes" to file.size, "expectedUpdatedAtMs" to expected),
    )
    api.putSigned(minted.field("uploadUrl") ?: error("The upload could not start."), minted.field("contentType") ?: contentType, file.bytes)
    api.request("/api/media/replace", ApiMethod.PATCH, body("mediaId" to item.id, "fileName" to file.name, "expectedUpdatedAtMs" to expected))
  }

  suspend fun saveDetails(id: String, fileName: String, alt: String, description: String, tags: List<String>) {
    api.request(
      "/api/media/folders",
      ApiMethod.POST,
      body("action" to "update-details", "mediaId" to id, "fileName" to fileName, "alt" to alt, "description" to description, "tags" to tags),
    )
  }

  suspend fun setPrivate(id: String, private: Boolean) {
    api.request("/api/media/folders", ApiMethod.POST, body("action" to "set-private", "mediaId" to id, "private" to private))
  }

  /** Moves files into [folderId] (null: no folder), asking again until the route says it is done. */
  suspend fun move(ids: List<String>, folderId: String?) {
    var remaining = ids
    var rounds = 0
    while (remaining.isNotEmpty() && rounds < 20) {
      val answer = api.request("/api/media/folders", ApiMethod.POST, body("action" to "move-assets", "mediaIds" to remaining, "folderId" to folderId))
      if (answer.boolField("done") != false) return
      remaining = ((answer as? JsonObject)?.get("remainingIds") as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content }.orEmpty()
      rounds += 1
    }
  }

  suspend fun createFolder(name: String, parentId: String?) {
    api.request("/api/media/folders", ApiMethod.POST, body("action" to "create-folder", "name" to name, "parentId" to parentId))
  }

  suspend fun renameFolder(id: String, name: String) {
    api.request("/api/media/folders", ApiMethod.POST, body("action" to "rename", "folderId" to id, "name" to name))
  }

  suspend fun deleteFolder(id: String) {
    api.request("/api/media/folders", ApiMethod.POST, body("action" to "delete", "folderId" to id))
  }

  /** Deletes the file; answers whether the route kept it restorable. */
  suspend fun delete(id: String): Boolean =
    api.request("/api/media/upload", ApiMethod.DELETE, body("mediaId" to id)).boolField("restorable") == true

  suspend fun restore(id: String) {
    api.request("/api/media/restore", ApiMethod.POST, body("mediaId" to id))
  }

  /** A short-lived link to a private workspace file (`/api/media/sign`), absolute. */
  suspend fun signedLink(id: String): String? = api.request("/api/media/sign", ApiMethod.POST, body("mediaId" to id))
    .field("url")?.let { if (it.startsWith("/")) api.origin + it else it }

  suspend fun references(id: String): List<MediaReference> {
    val answer = api.request("/api/media/references", ApiMethod.POST, body("mediaId" to id))
    return ((answer as? JsonObject)?.get("references") as? JsonArray)?.mapNotNull { entry ->
      val obj = entry as? JsonObject ?: return@mapNotNull null
      MediaReference(
        kind = (obj["kind"] as? JsonPrimitive)?.content ?: "page",
        name = (obj["name"] as? JsonPrimitive)?.content ?: "Untitled",
        live = (obj["live"] as? JsonPrimitive)?.content == "true",
      )
    }.orEmpty()
  }

  suspend fun storage(): MediaStorage? = runCatching {
    val answer = api.request("/api/media/storage", query = mapOf(scope.bodyKey to scope.id))
    MediaStorage(
      usedBytes = (answer.field("usedBytes")?.toLongOrNull()) ?: ((answer as? JsonObject)?.get("usedBytes") as? JsonPrimitive)?.content?.toDoubleOrNull()?.toLong() ?: 0,
      allowanceMb = ((answer as? JsonObject)?.get("allowanceMb") as? JsonPrimitive)?.content?.toDoubleOrNull()?.toLong(),
      unlimited = answer.boolField("unlimited") == true,
    )
  }.getOrNull()
}
