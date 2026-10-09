package com.aglyn.site.artifacts

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.ListFilterRequest
import com.aglyn.contracts.ListQueryDeclaration
import com.aglyn.contracts.ListQueryRequest
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.FirestoreWriter
import com.aglyn.core.field
import com.aglyn.core.firestoreNow
import com.aglyn.core.jsonValue
import com.aglyn.core.listquery.displayNameSearchFields
import com.aglyn.core.listquery.planListQuery
import com.aglyn.core.listquery.toFirestoreQuery
import com.aglyn.core.newDocumentId
import com.aglyn.pluginhost.BesignerPaths
import com.aglyn.ui.Load
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/*
 * A site's reusable components, shared layouts and templates, as the
 * console's three lists read and change them (`hosts/[host]/components`,
 * `layouts`, `templates`): one query per view through the list's own
 * declaration (COMPONENT_LIST_QUERY, LAYOUT_LIST_QUERY, TEMPLATE_LIST_QUERY
 * with `libraryRow == true` as its base), ordered by document id, the
 * quick search on `nameTokens` and the kind filter as a clause. Creates and
 * duplicates go through `/api/hosts/resources` (and a layout's first version
 * through `/api/hosts/versions`), the quota-enforcing routes the console
 * uses; a rename, a description, a layout's parent and a delete are the same
 * document updates the console's pages make, under the same rules.
 */

/** The lists' page (the console's footer offers 10, 25 and 50). */
const val ARTIFACT_PAGE_SIZE = 25

/** The create drawer's limits (`create-artifact-drawer`). */
const val ARTIFACT_NAME_MAX = 25
const val ARTIFACT_DESCRIPTION_MAX = 80

/** The duplicate dialog's name limit and default (`DUPLICATE_NAME_MAX`, `DUPLICATE_NAME_PREFIX`). */
const val DUPLICATE_NAME_MAX = 200
const val DUPLICATE_NAME_PREFIX = "Copy of "

/** How deep a chain of layouts may go (`MAX_LAYOUT_CHAIN_DEPTH`). */
const val MAX_LAYOUT_CHAIN_DEPTH = 5

private const val CANVAS_ROOT = "_@_"
private const val LAYOUT_SLOT_COMPONENT_ID = "layoutSlot"
private const val MUI_BUNDLE_ID = "mui"

/** The three lists, each its collection, its routes' words and its declaration. */
enum class ArtifactKind(
  val screen: String,
  val collection: String,
  val title: String,
  val singular: String,
  val icon: String,
  /** The `resource` a create sends to `/api/hosts/resources`. */
  val createResource: String,
  /** The `resource` a duplicate sends (`DUPLICABLE_HOST_RESOURCE_KINDS`). */
  val duplicateResource: String,
  /** The `kind` `/api/hosts/versions` and `/api/hosts/where-used` know it by; null for templates, which have no versions. */
  val versionKind: String?,
) {
  COMPONENT("site.components", "components", "Components", "component", "widgets", "reusableComponent", "component", "component"),
  LAYOUT("site.layouts", "layouts", "Layouts", "layout", "view_quilt", "layout", "layout", "layout"),
  TEMPLATE("site.templates", "templates", "Templates", "template", "dashboard_customize", "template", "template", null),
  ;

  val declaration: ListQueryDeclaration
    get() = when (this) {
      COMPONENT -> Contracts.componentListQuery
      LAYOUT -> Contracts.layoutListQuery
      TEMPLATE -> Contracts.templateListQuery
    }

  /** The filter chips above the list: the kind clause's values and their labels. */
  val kindChoices: List<Pair<String?, String>>
    get() = when (this) {
      COMPONENT -> listOf(null to "All", "site" to "Page", "email" to "Email")
      LAYOUT -> emptyList()
      TEMPLATE -> listOf<Pair<String?, String>>(null to "All") + Contracts.templateKindOptions.map { it.value to it.label }
    }
}

/** Where a component is placed, as the list's "Used in" column reads it (missing is `site`). */
fun componentPlacementLabel(kind: String?): String = if (kind == "email") "Email" else "Page"

/** A template's kind label (missing is `page`). */
fun templateKindLabel(kind: String?): String =
  Contracts.templateKindOptions.firstOrNull { it.value == (kind ?: "page") }?.label ?: (kind ?: "Page").replaceFirstChar { it.uppercase() }

/** A template's source badge: saved on this site, a starter, or a plugin's. */
fun templateSourceLabel(type: String?): String = when (type) {
  null, "", "authored" -> "Saved here"
  "starter" -> "Starter"
  else -> type.replaceFirstChar { it.uppercase() }
}

/** One row of a list, and the detail pane's subject. */
data class ArtifactRow(
  val id: String,
  val name: String,
  val description: String?,
  /** A component's placement or a template's kind. */
  val kind: String?,
  val versionId: String?,
  /** A layout's parent layout (`layoutId`, "Renders inside"). */
  val parentLayoutId: String?,
  val sourceType: String?,
  val starterId: String?,
  val starterName: String?,
  val starterOrder: Long?,
  /** The row the template library lists (one per starter bundle). */
  val libraryRow: Boolean,
  val updatedAt: FirestoreTimestamp?,
  val createdAt: FirestoreTimestamp?,
) {
  val isStarterBundle: Boolean get() = starterId != null

  companion object {
    /** Null for a deleted row, which the console's lists hide. */
    fun from(doc: FirestoreDoc): ArtifactRow? {
      if (doc.data["deletedAt"] != null) return null
      val source = doc.data["source"] as? Map<*, *>
      return ArtifactRow(
        id = doc.id,
        name = doc.string("displayName")?.ifBlank { null } ?: "Untitled",
        description = doc.string("description")?.ifBlank { null },
        kind = doc.string("kind")?.ifBlank { null },
        versionId = doc.string("versionId")?.ifBlank { null },
        parentLayoutId = doc.string("layoutId")?.ifBlank { null },
        sourceType = source?.get("type") as? String,
        starterId = (source?.get("starterId") as? String)?.ifBlank { null },
        starterName = (source?.get("starterName") as? String)?.ifBlank { null },
        starterOrder = (source?.get("starterOrder") as? Number)?.toLong(),
        libraryRow = doc.bool("libraryRow") == true,
        updatedAt = doc.data["updatedAt"] as? FirestoreTimestamp,
        createdAt = doc.data["createdAt"] as? FirestoreTimestamp,
      )
    }
  }
}

/** One saved version of a component or layout. */
data class ArtifactVersion(val id: String, val name: String?, val createdAt: FirestoreTimestamp?, val updatedAt: FirestoreTimestamp?)

fun artifactVersionOf(doc: FirestoreDoc) = ArtifactVersion(
  id = doc.id,
  name = doc.string("displayName")?.ifBlank { null },
  createdAt = doc.data["createdAt"] as? FirestoreTimestamp,
  updatedAt = doc.data["updatedAt"] as? FirestoreTimestamp,
)

/** Versions newest first, as the detail pages sort the 100 they read. */
fun sortedVersions(versions: List<ArtifactVersion>): List<ArtifactVersion> =
  versions.sortedByDescending { it.createdAt?.epochMillis ?: 0L }

/**
 * The version "Edit in the Besigner" opens: the one asked for, else the
 * current one, else the newest. Null when there is none yet.
 */
fun versionToOpen(row: ArtifactRow, versions: List<ArtifactVersion>, asked: String? = null): String? =
  asked ?: row.versionId ?: sortedVersions(versions).firstOrNull()?.id

/** One list view's request: the kind clause and the quick search, on the declaration's base. */
fun artifactRequest(kind: ArtifactKind, search: String, kindFilter: String?): ListQueryRequest = ListQueryRequest(
  base = if (kind == ArtifactKind.TEMPLATE) Contracts.templateListBase else null,
  clauses = listOfNotNull(kindFilter?.let { ListFilterRequest("kind", "equals", it) }),
  search = search.trim().ifEmpty { null }?.let { listOf(it) },
)

fun artifactQuery(kind: ArtifactKind, hostId: String, search: String, kindFilter: String?, startAfter: List<Any?>? = null): FirestoreQuery =
  planListQuery(kind.declaration, artifactRequest(kind, search, kindFilter))
    .toFirestoreQuery("hosts/$hostId/${kind.collection}", ARTIFACT_PAGE_SIZE, startAfter)

/**
 * The layouts a layout may render inside (`canNestLayout`): never itself,
 * never one that already has it somewhere above, sorted by name.
 */
fun nestableParents(layoutId: String, layouts: List<ArtifactRow>): List<ArtifactRow> {
  val parentOf = layouts.associate { it.id to it.parentLayoutId }
  fun chain(start: String): List<String> {
    val out = mutableListOf<String>()
    var current: String? = start
    while (current != null && current !in out && out.size < MAX_LAYOUT_CHAIN_DEPTH) {
      out += current
      current = parentOf[current]
    }
    return out
  }
  return layouts.filter { it.id != layoutId && layoutId !in chain(it.id) }.sortedBy { it.name.lowercase() }
}

/** One list: the search, the kind chip, the rows read so far and whether more are left. */
class ArtifactListModel(
  private val kind: ArtifactKind,
  private val hostId: String,
  private val firestore: FirestoreReader,
  private val scope: CoroutineScope,
) {
  var search by mutableStateOf("")
    private set
  var kindFilter by mutableStateOf<String?>(null)
    private set
  var rows by mutableStateOf<Load<List<ArtifactRow>>>(Load.Loading)
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
    if (next == kindFilter) return
    kindFilter = next
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
        val page = firestore.page(artifactQuery(kind, hostId, search, kindFilter))
        cursor = page.nextCursor
        hasMore = page.nextCursor != null
        Load.Ready(page.docs.mapNotNull(ArtifactRow::from))
      } catch (error: Throwable) {
        if (error is CancellationException) throw error
        hasMore = false
        Load.Failed("${kind.title} could not be loaded. Check the connection and try again.")
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
      runCatching { firestore.page(artifactQuery(kind, hostId, search, kindFilter, after)) }.onSuccess { page ->
        cursor = page.nextCursor
        hasMore = page.nextCursor != null
        rows = Load.Ready(shown + page.docs.mapNotNull(ArtifactRow::from).filter { row -> shown.none { it.id == row.id } })
      }
    }
  }

  /** Drops a row the person just deleted, without waiting for a reload. */
  fun drop(id: String) {
    (rows as? Load.Ready)?.let { rows = Load.Ready(it.value.filterNot { row -> row.id == id }) }
  }
}

/** Something that uses a component or layout, as the "Used by" card lists it. */
data class ArtifactDependent(val type: String, val id: String, val name: String)

/** The "Used by" scan's answer: who, and whether it read everything. */
data class ArtifactUsage(val dependents: List<ArtifactDependent>, val complete: Boolean)

/** A canvas holding only its root, as a new component or template starts. */
fun blankCanvas(): Map<String, Any?> = mapOf(CANVAS_ROOT to mapOf("\$id" to CANVAS_ROOT, "componentId" to "div", "nodes" to emptyList<Any>()))

/** A new layout's canvas: the root and the one slot pages graft into. */
fun layoutCanvas(slotId: String): Map<String, Any?> = mapOf(
  CANVAS_ROOT to mapOf("\$id" to CANVAS_ROOT, "componentId" to "div", "nodes" to listOf(slotId)),
  slotId to mapOf("\$id" to slotId, "componentId" to LAYOUT_SLOT_COMPONENT_ID, "pluginId" to MUI_BUNDLE_ID, "parentId" to CANVAS_ROOT, "props" to emptyMap<String, Any?>()),
)

/** The Besigner page an artifact opens on (a template has no version). */
fun artifactBesignerPath(kind: ArtifactKind, id: String, versionId: String?, preview: Boolean = false): String? = when (kind) {
  ArtifactKind.COMPONENT -> versionId?.let { BesignerPaths.component(id, it, preview) }
  ArtifactKind.LAYOUT -> versionId?.let { BesignerPaths.layout(id, it, preview) }
  ArtifactKind.TEMPLATE -> BesignerPaths.template(id, preview)
}

/** The writes of one list, each made the way the console's page makes it. */
class ArtifactsApi(private val api: ConsoleApiClient, private val writer: FirestoreWriter, private val hostId: String, private val kind: ArtifactKind) {
  private fun path(id: String) = "hosts/$hostId/${kind.collection}/$id"

  private suspend fun resources(body: Map<String, Any?>) = api.request("/api/hosts/resources", ApiMethod.POST, jsonValue(mapOf("hostId" to hostId) + body))

  /**
   * A new component, layout or template; answers its id. A component carries
   * its blank design and no version (the first opens it); a layout gets its
   * first version with the slot; a template is born through the route, never
   * a client create.
   */
  suspend fun create(name: String, description: String, subKind: String?): String {
    val id = newDocumentId()
    val base = buildMap<String, Any?> {
      put("displayName", name.trim())
      put("description", description.trim())
    }
    when (kind) {
      ArtifactKind.COMPONENT -> resources(
        mapOf(
          "resource" to kind.createResource,
          "id" to id,
          "data" to base + mapOf("rootId" to CANVAS_ROOT, "nodes" to blankCanvas()) + (if (subKind == "email") mapOf("kind" to "email") else emptyMap()),
        ),
      )
      ArtifactKind.LAYOUT -> {
        val versionId = newDocumentId()
        resources(mapOf("resource" to kind.createResource, "id" to id, "data" to base + mapOf("versionId" to versionId)))
        api.request(
          "/api/hosts/versions",
          ApiMethod.POST,
          jsonValue(mapOf("hostId" to hostId, "kind" to "layout", "parentId" to id, "id" to versionId, "data" to mapOf("layoutId" to id, "nodes" to layoutCanvas(newDocumentId())))),
        )
      }
      ArtifactKind.TEMPLATE -> resources(
        mapOf(
          "resource" to kind.createResource,
          "id" to id,
          "data" to base + mapOf("kind" to (subKind ?: "page"), "rootId" to CANVAS_ROOT, "nodes" to blankCanvas()),
        ),
      )
    }
    return id
  }

  /** A draft copy under a new name; answers its id. */
  suspend fun duplicate(sourceId: String, name: String): String? = resources(
    mapOf(
      "resource" to kind.duplicateResource,
      "action" to "duplicate",
      "sourceId" to sourceId,
      "name" to name.trim().take(DUPLICATE_NAME_MAX).ifEmpty { null },
      "attemptKey" to newDocumentId(),
    ),
  ).field("id")

  /** The details form's save: the name with its search keys, the description, and a layout's parent. */
  suspend fun saveDetails(id: String, name: String, description: String, parentLayoutId: String? = null, setParent: Boolean = false) {
    writer.update(
      path(id),
      buildMap {
        put("displayName", name.trim())
        putAll(displayNameSearchFields(name.trim()))
        put("description", description.trim())
        if (setParent) put("layoutId", parentLayoutId ?: com.aglyn.core.FirestoreDelete)
        put("updatedAt", firestoreNow())
      },
    )
  }

  /** Deletes softly, as every list does; a template also leaves the library. */
  suspend fun delete(id: String) {
    writer.update(
      path(id),
      buildMap {
        put("deletedAt", firestoreNow())
        if (kind == ArtifactKind.TEMPLATE) put("libraryRow", false)
      },
    )
  }

  /** Deletes a whole starter bundle: every page leaves the library, as the list's Delete does. */
  suspend fun deleteBundle(pages: List<ArtifactRow>) {
    for (page in pages) delete(page.id)
  }

  /**
   * Deletes one page of a starter bundle; when it was the bundle's library
   * row, the next page (by its starter order) takes the row, as the template
   * page's batch does.
   */
  suspend fun deleteBundlePage(page: ArtifactRow, siblings: List<ArtifactRow>, wasLead: Boolean) {
    delete(page.id)
    if (wasLead) {
      siblings.filter { it.id != page.id }.minByOrNull { it.starterOrder ?: Long.MAX_VALUE }?.let { next ->
        writer.update(path(next.id), mapOf("libraryRow" to true))
      }
    }
  }

  /**
   * The version the Besigner opens on, making the first one when there is
   * none (a component is created without one): the versions route seeds it
   * from the component's own design on the server, then the component points
   * at it, as the console's Open Besigner does.
   */
  suspend fun ensureVersion(row: ArtifactRow, versions: List<ArtifactVersion>, asked: String? = null): String {
    versionToOpen(row, versions, asked)?.let { return it }
    val versionKind = kind.versionKind ?: error("Templates have no versions")
    val versionId = newDocumentId()
    api.request(
      "/api/hosts/versions",
      ApiMethod.POST,
      jsonValue(mapOf("hostId" to hostId, "kind" to versionKind, "parentId" to row.id, "id" to versionId, "seedFromParent" to true)),
    )
    writer.update(path(row.id), mapOf("versionId" to versionId, "updatedAt" to firestoreNow()))
    return versionId
  }

  /** What uses a component or layout (`POST /api/hosts/where-used`). */
  suspend fun usage(row: ArtifactRow): ArtifactUsage? {
    val versionKind = kind.versionKind ?: return null
    val answer = api.request("/api/hosts/where-used", ApiMethod.POST, jsonValue(mapOf("hostId" to hostId, "kind" to versionKind, "id" to row.id, "name" to row.name)))
    val list = ((answer as? JsonObject)?.get("dependents") as? JsonArray)?.mapNotNull { entry ->
      val obj = entry as? JsonObject ?: return@mapNotNull null
      ArtifactDependent(
        type = (obj["type"] as? JsonPrimitive)?.contentOrNull ?: "screen",
        id = (obj["id"] as? JsonPrimitive)?.contentOrNull ?: return@mapNotNull null,
        name = (obj["name"] as? JsonPrimitive)?.contentOrNull ?: "Untitled",
      )
    }.orEmpty()
    return ArtifactUsage(list, (answer as? JsonObject)?.get("complete")?.let { (it as? JsonPrimitive)?.contentOrNull == "true" } ?: false)
  }
}

/** A dependent's kind, as the "Used by" card names it. */
fun dependentLabel(type: String): String = when (type) {
  "screen" -> "Page"
  "layout" -> "Layout"
  "component" -> "Component"
  "collection" -> "Collection"
  "emailTemplate", "emailDesign", "systemEmail" -> "Email"
  else -> type.replaceFirstChar { it.uppercase() }
}
