package com.aglyn.site.pages

import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.FirestoreWriter
import com.aglyn.core.firestoreNow
import com.aglyn.core.listquery.displayNameSearchFields
import com.aglyn.core.newDocumentId
import com.aglyn.core.field
import com.aglyn.core.jsonValue
import kotlinx.serialization.json.JsonElement

/*
 * A site's pages as the console's Pages hub reads and changes them
 * (`hosts/[host]/screens`): the whole collection by document id with one
 * probe row, deleted pages and email screens left out, built into the tree
 * the hub draws (groups are folders; a page's parent is `parentId`), each
 * page live when the host's routing map holds it.
 */

/** The hub's own window: the site's screens by document id, plus one probe row. */
const val PAGES_WINDOW = 200

const val SCREEN_KIND_GROUP = "group"
const val SCREEN_KIND_TEMPLATE = "template"
const val SCREEN_KIND_ERROR = "error"
private const val SCREEN_KIND_EMAIL = "email"

/** The canvas root id the Besigner opens into (`CANVAS_ROOT_ELEMENT_ID`). */
const val CANVAS_ROOT_ELEMENT_ID = "_@_"

/** The limits of the hub's New page form. */
const val PAGE_NAME_MAX = 25
const val PAGE_DESCRIPTION_MAX = 80

const val HOST_RESOURCES_ROUTE = "/api/hosts/resources"
const val HOST_VERSIONS_ROUTE = "/api/hosts/versions"
const val HOST_PAGES_ROUTE = "/api/hosts/pages"

/** One screen of the site, as the hub reads it. */
data class PageNode(
  val id: String,
  val name: String,
  val description: String?,
  val slug: String?,
  val parentId: String?,
  val kind: String?,
  val order: Double?,
  val createdSeconds: Long?,
  val versionId: String?,
  val publishedAt: FirestoreTimestamp?,
  val updatedAt: FirestoreTimestamp?,
) {
  val isGroup: Boolean get() = kind == SCREEN_KIND_GROUP

  companion object {
    /** Null for a deleted page or an email screen (the Emails page's). */
    fun from(doc: FirestoreDoc): PageNode? {
      if (doc.data["deletedAt"] != null || doc.string("kind") == SCREEN_KIND_EMAIL) return null
      return PageNode(
        id = doc.id,
        name = doc.string("displayName")?.ifBlank { null } ?: if (doc.string("kind") == SCREEN_KIND_GROUP) "Untitled group" else "Untitled page",
        description = doc.string("description")?.ifBlank { null },
        slug = doc.string("slug")?.ifBlank { null },
        parentId = doc.string("parentId")?.ifBlank { null },
        kind = doc.string("kind"),
        order = (doc.data["order"] as? Number)?.toDouble(),
        createdSeconds = (doc.data["createdAt"] as? FirestoreTimestamp)?.seconds,
        versionId = doc.string("versionId")?.ifBlank { null },
        publishedAt = doc.data["publishedAt"] as? FirestoreTimestamp,
        updatedAt = doc.data["updatedAt"] as? FirestoreTimestamp,
      )
    }
  }
}

/** The host fields the hub reads beside the pages: the routing map and the placeholder home page. */
data class SiteRouting(
  val routes: Map<String, String> = emptyMap(),
  val defaultHomeScreenId: String? = null,
  val subdomain: String? = null,
  val cname: String? = null,
) {
  companion object {
    fun from(host: FirestoreDoc?): SiteRouting = SiteRouting(
      routes = (host?.data?.get("screens") as? Map<*, *>)?.entries
        ?.mapNotNull { (key, value) -> (value as? String)?.takeIf { it.isNotEmpty() }?.let { key.toString() to it } }
        ?.toMap()
        .orEmpty(),
      defaultHomeScreenId = host?.string("defaultHomeScreenId"),
      subdomain = host?.string("subdomain"),
      cname = host?.string("cname")?.ifBlank { null },
    )
  }
}

/** A routing-map path as a site address: `/` stays `/`, `about` is `/about`. */
fun routeUrl(path: String): String = if (path == "/") "/" else "/$path"

/** One row of the drawn tree. */
data class PageTreeRow(
  val page: PageNode,
  val depth: Int,
  /** The address it answers, when live. */
  val livePath: String?,
  val home: Boolean,
  val childCount: Int,
)

/** Siblings in the hub's order: `order`, then created, then id. */
val PAGE_SIBLING_ORDER: Comparator<PageNode> =
  compareBy<PageNode>({ it.order ?: Double.MAX_VALUE }, { it.createdSeconds ?: 0L }, { it.id })

/**
 * The tree the hub draws, flattened depth first. A page whose parent is not
 * in the window shows at the top level, as the hub shows it; a cycle is cut
 * where it would repeat.
 */
fun pageTree(pages: List<PageNode>, routing: SiteRouting): List<PageTreeRow> {
  val ids = pages.map { it.id }.toSet()
  val children = pages.groupBy { page -> page.parentId?.takeIf { it in ids && it != page.id } }
  val out = mutableListOf<PageTreeRow>()
  val seen = mutableSetOf<String>()
  fun walk(parent: String?, depth: Int) {
    for (page in (children[parent] ?: emptyList()).sortedWith(PAGE_SIBLING_ORDER)) {
      if (!seen.add(page.id)) continue
      val live = routing.routes[page.id]
      out += PageTreeRow(page, depth, live?.let(::routeUrl), live == "/", children[page.id]?.size ?: 0)
      walk(page.id, depth + 1)
    }
  }
  walk(null, 0)
  // Anything only reachable through a cycle still shows, at the top level.
  for (page in pages.sortedWith(PAGE_SIBLING_ORDER)) if (page.id !in seen) {
    seen += page.id
    val live = routing.routes[page.id]
    out += PageTreeRow(page, 0, live?.let(::routeUrl), live == "/", 0)
  }
  return out
}

/** How a row reads: what it is and whether a visitor can reach it. */
data class PageStatus(val label: String, val live: Boolean)

fun pageStatus(row: PageTreeRow): PageStatus = when {
  row.page.isGroup -> PageStatus("Group", false)
  row.page.kind == SCREEN_KIND_TEMPLATE -> PageStatus("Entry template", false)
  row.page.kind == SCREEN_KIND_ERROR -> PageStatus("Error page", false)
  row.livePath != null -> PageStatus("Published", true)
  else -> PageStatus("Draft", false)
}

/** The ids a page may move under: groups and pages, never itself or its own descendants. */
fun movableParents(pages: List<PageNode>, pageId: String): List<PageNode> {
  val byParent = pages.groupBy { it.parentId }
  val blocked = mutableSetOf(pageId)
  val queue = ArrayDeque(listOf(pageId))
  while (queue.isNotEmpty()) {
    for (child in byParent[queue.removeFirst()].orEmpty()) if (blocked.add(child.id)) queue += child.id
  }
  return pages.filter { it.id !in blocked && it.kind != SCREEN_KIND_TEMPLATE && it.kind != SCREEN_KIND_ERROR }
    .sortedBy { it.name.lowercase() }
}

/** A page's live address on the site's own domain, as the hub's "Open live page" builds it. */
fun livePageUrl(routing: SiteRouting, livePath: String, apex: String = com.aglyn.core.DEFAULT_TENANT_APEX): String? {
  val domain = routing.cname ?: routing.subdomain?.let { "$it.$apex" } ?: return null
  return "https://$domain$livePath"
}

/** One saved version of a page. */
data class PageVersion(val id: String, val name: String?, val createdAt: FirestoreTimestamp?)

fun pageVersionOf(doc: FirestoreDoc) = PageVersion(
  id = doc.id,
  name = doc.string("displayName")?.ifBlank { null },
  createdAt = doc.data["createdAt"] as? FirestoreTimestamp,
)

/**
 * A site's page writes, made the way the console makes them: a new page or
 * group and a duplicate through the quota-enforcing resources route and its
 * first version through the versions route; publishing, unpublishing,
 * moving and deleting through the pages route, which runs the console's own
 * routing code; a rename, a description and the live version as the same
 * document updates the hub and the page details make.
 */
class PagesApi(private val api: ConsoleApiClient, private val writer: FirestoreWriter, private val hostId: String) {
  private fun path(id: String) = "hosts/$hostId/screens/$id"

  /** A new draft page (no address yet) with the empty canvas the Besigner opens into; answers its ids. */
  suspend fun createPage(name: String, description: String): Pair<String, String> {
    val id = newDocumentId()
    val versionId = newDocumentId()
    api.request(
      HOST_RESOURCES_ROUTE,
      ApiMethod.POST,
      jsonValue(
        mapOf(
          "hostId" to hostId,
          "resource" to "screen",
          "id" to id,
          "data" to buildMap {
            put("displayName", name.trim())
            description.trim().takeIf { it.isNotEmpty() }?.let { put("description", it) }
            put("versionId", versionId)
          },
        ),
      ),
    )
    api.request(
      HOST_VERSIONS_ROUTE,
      ApiMethod.POST,
      jsonValue(
        mapOf(
          "hostId" to hostId,
          "kind" to "screen",
          "parentId" to id,
          "id" to versionId,
          "data" to mapOf(
            "screenId" to id,
            "nodes" to mapOf(CANVAS_ROOT_ELEMENT_ID to mapOf("\$id" to CANVAS_ROOT_ELEMENT_ID, "componentId" to "div", "nodes" to emptyList<Any>())),
          ),
        ),
      ),
    )
    return id to versionId
  }

  /** A new group at the top of the list, as the hub's New group adds one. */
  suspend fun createGroup(name: String, topOrder: Double) {
    val id = newDocumentId()
    api.request(
      HOST_RESOURCES_ROUTE,
      ApiMethod.POST,
      jsonValue(mapOf("hostId" to hostId, "resource" to "screen", "id" to id, "data" to mapOf("displayName" to name.trim(), "kind" to SCREEN_KIND_GROUP))),
    )
    writer.update(path(id), mapOf("order" to minOf(0.0, topOrder) - 1))
  }

  /** A draft copy with a unique slug and no address; answers its id. */
  suspend fun duplicate(sourceId: String, name: String): String? {
    val answer = api.request(
      HOST_RESOURCES_ROUTE,
      ApiMethod.POST,
      jsonValue(
        mapOf(
          "hostId" to hostId,
          "resource" to "screen",
          "action" to "duplicate",
          "sourceId" to sourceId,
          "name" to name.trim().ifEmpty { null },
          "attemptKey" to newDocumentId(),
        ),
      ),
    )
    return answer.field("id")
  }

  suspend fun rename(id: String, name: String, description: String?) {
    writer.update(
      path(id),
      buildMap {
        put("displayName", name.trim())
        putAll(displayNameSearchFields(name.trim()))
        if (description != null) put("description", description.trim())
        put("updatedAt", firestoreNow())
      },
    )
  }

  /** Makes [versionId] the one the page serves, as the details page's versions do. */
  suspend fun makeVersionLive(id: String, versionId: String) {
    writer.update(path(id), mapOf("versionId" to versionId, "updatedAt" to firestoreNow()))
  }

  private suspend fun pages(action: String, id: String, extra: Map<String, Any?> = emptyMap()): JsonElement? =
    api.request(HOST_PAGES_ROUTE, ApiMethod.POST, jsonValue(mapOf("hostId" to hostId, "action" to action, "id" to id) + extra))

  /** Publishes the page at [slug] (`/` for the home page); answers the address it went live at. */
  suspend fun publish(id: String, slug: String): String? = pages("publish", id, mapOf("slug" to slug)).field("path")

  suspend fun unpublish(id: String) {
    pages("unpublish", id)
  }

  suspend fun delete(id: String) {
    pages("delete", id)
  }

  suspend fun deleteGroup(id: String) {
    pages("delete-group", id)
  }

  /** Moves the page under [parentId] (null: the top level), at [index] among its new siblings. */
  suspend fun move(id: String, parentId: String?, index: Int) {
    pages("move", id, mapOf("parentId" to parentId, "index" to index))
  }
}

