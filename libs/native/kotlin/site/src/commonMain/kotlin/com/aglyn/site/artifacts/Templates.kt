package com.aglyn.site.artifacts

import com.aglyn.contracts.Contracts
import com.aglyn.contracts.SCREEN_ROOT_PATH
import com.aglyn.contracts.decodeStoredNodes
import com.aglyn.contracts.detectTemplatePlaceholders
import com.aglyn.contracts.normalizeScreenSlug
import com.aglyn.contracts.reservedScreenRouteMessage
import com.aglyn.contracts.reservedScreenRouteSegment
import com.aglyn.contracts.resolveNamedTokens
import com.aglyn.contracts.resolveTemplateSlug
import com.aglyn.contracts.screenSlugHasPathSeparator
import com.aglyn.contracts.templateScreenAddressRefusal
import com.aglyn.contracts.withBundleRootScreen
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreDelete
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.FirestoreWriter
import com.aglyn.core.FilterOp
import com.aglyn.core.field
import com.aglyn.core.jsonValue
import com.aglyn.core.newDocumentId
import com.aglyn.site.pages.PagesApi

/*
 * Starting a page, component or layout from a template, and saving one as a
 * template, as the console's Use template and Save as template do. A stored
 * node tree is msgpack bytes that the apps only read: it is decoded here and
 * sent to the console's routes as JSON, which encode it themselves. Every
 * create rides the quota-enforcing routes, so a refusal reads the way the
 * console's does.
 */

/** A template's version label, as the console's `createPageFromTemplate` names a first version. */
private const val INITIAL_VERSION_LABEL = "Initial version"

/** A placeholder a template asks for when it is used. */
data class TemplatePlaceholder(val name: String, val label: String, val defaultValue: String)

/** A template as Use reads it: what it is, the tree it holds and what a copy carries. */
data class TemplateContent(
  val id: String,
  val name: String,
  /** `page`, `component` or `layout` (missing is `page`). */
  val kind: String,
  val description: String?,
  val nodes: Map<String, Any?>?,
  val rootId: String?,
  val props: List<Any?>?,
  /** `email` for an email block's template. */
  val componentKind: String?,
  val seo: Map<String, Any?>?,
  val slug: String?,
  val placeholders: List<TemplatePlaceholder>,
  val starterId: String?,
  val starterOrder: Long?,
) {
  companion object {
    @Suppress("UNCHECKED_CAST")
    fun from(doc: FirestoreDoc): TemplateContent? {
      if (doc.data["deletedAt"] != null) return null
      val source = doc.data["source"] as? Map<String, Any?>
      return TemplateContent(
        id = doc.id,
        name = doc.string("displayName")?.ifBlank { null } ?: "Untitled",
        kind = doc.string("kind")?.ifBlank { null } ?: "page",
        description = doc.string("description")?.ifBlank { null },
        nodes = decodeStoredNodes(doc.data["nodes"]),
        rootId = doc.string("rootId")?.ifBlank { null },
        props = (doc.data["props"] as? List<*>)?.takeIf { it.isNotEmpty() },
        componentKind = doc.string("componentKind")?.ifBlank { null },
        seo = (doc.data["seo"] as? Map<*, *>)?.takeIf { it.isNotEmpty() } as? Map<String, Any?>,
        slug = doc.string("slug")?.ifBlank { null },
        placeholders = (doc.data["placeholders"] as? List<*>).orEmpty().mapNotNull { entry ->
          val map = entry as? Map<*, *> ?: return@mapNotNull null
          val name = map["name"] as? String ?: return@mapNotNull null
          // A `{{prop.*}}` token binds to a property the template carries, never a placeholder to fill.
          if (name.startsWith(Contracts.componentPropTokenPrefix)) return@mapNotNull null
          TemplatePlaceholder(name, (map["label"] as? String)?.ifBlank { null } ?: name, (map["defaultValue"] as? String).orEmpty())
        },
        starterId = (source?.get("starterId") as? String)?.ifBlank { null },
        starterOrder = (source?.get("starterOrder") as? Number)?.toLong(),
      )
    }
  }
}

/** A page made from a template: its id, and the address it went live at. */
data class UsedPage(val screenId: String, val slug: String, val requestedSlug: String)

/** What Save as template captures from a page, component or layout. */
data class TemplateSource(
  val kind: String,
  val nodes: Map<String, Any?>,
  val rootId: String? = null,
  val slug: String? = null,
  val seo: Map<String, Any?>? = null,
  val props: List<Any?>? = null,
  val componentKind: String? = null,
)

/** A sentence for the person, thrown by a flow that cannot go on; the runner shows it as written. */
fun TemplateProblem(message: String): ConsoleApiError = ConsoleApiError(message, 400, null)

class TemplatesApi(
  private val api: ConsoleApiClient,
  private val reader: FirestoreReader,
  private val writer: FirestoreWriter,
  private val hostId: String,
) {
  private suspend fun resources(body: Map<String, Any?>) = api.request("/api/hosts/resources", ApiMethod.POST, jsonValue(mapOf("hostId" to hostId) + body))

  private suspend fun versions(body: Map<String, Any?>) = api.request("/api/hosts/versions", ApiMethod.POST, jsonValue(mapOf("hostId" to hostId) + body))

  /** One template, or null when it is gone. */
  suspend fun load(templateId: String): TemplateContent? = reader.get("hosts/$hostId/templates/$templateId")?.let(TemplateContent::from)

  /** The pages of a starter bundle, in the bundle's order. */
  suspend fun bundlePages(starterId: String): List<TemplateContent> =
    reader.page(FirestoreQuery("hosts/$hostId/templates", filters = listOf(FirestoreFilter("source.starterId", FilterOp.EQ, starterId)), limit = 100))
      .docs.mapNotNull(TemplateContent::from).sortedBy { it.starterOrder ?: Long.MAX_VALUE }

  private fun filled(template: TemplateContent, values: Map<String, String>): Map<String, Any?> {
    val nodes = template.nodes ?: throw TemplateProblem("This template has no content to start from.")
    return resolveNamedTokens(nodes, values.takeIf { template.placeholders.isNotEmpty() })
  }

  /** A component from the template; answers its id. */
  suspend fun useComponent(template: TemplateContent, name: String, values: Map<String, String>): String =
    resources(
      mapOf(
        "resource" to "reusableComponent",
        "data" to buildMap {
          put("displayName", name.trim())
          template.description?.let { put("description", it) }
          template.rootId?.let { put("rootId", it) }
          put("nodes", filled(template, values))
          template.props?.let { put("props", it) }
          if (template.componentKind == "email") put("kind", "email")
        },
      ),
    ).field("id").orEmpty()

  /** A layout from the template, with its first version; answers its id. */
  suspend fun useLayout(template: TemplateContent, name: String, values: Map<String, String>): String {
    val layoutId = newDocumentId()
    val versionId = newDocumentId()
    val nodes = filled(template, values)
    resources(
      mapOf(
        "resource" to "layout",
        "id" to layoutId,
        "data" to buildMap {
          put("displayName", name.trim())
          template.description?.let { put("description", it) }
          put("versionId", versionId)
        },
      ),
    )
    versions(
      mapOf(
        "kind" to "layout",
        "parentId" to layoutId,
        "id" to versionId,
        "data" to buildMap {
          put("layoutId", layoutId)
          put("hostId", hostId)
          put("displayName", INITIAL_VERSION_LABEL)
          put("nodes", nodes)
          template.props?.let { put("props", it) }
        },
      ),
    )
    return layoutId
  }

  /** The paths already routed on the site (the routing map's values). */
  suspend fun takenAddresses(): MutableSet<String> {
    val screens = reader.get("hosts/$hostId")?.data?.get("screens") as? Map<*, *>
    return screens?.values?.filterIsInstance<String>()?.toMutableSet() ?: mutableSetOf()
  }

  /** One live page from a template, de-conflicted against [taken] (which gains what it claims). */
  suspend fun usePage(template: TemplateContent, name: String, slug: String?, values: Map<String, String>, taken: MutableSet<String>, pages: PagesApi): UsedPage {
    val nodes = filled(template, values)
    val claimed = resolveTemplateSlug(slug, name.trim(), taken)
    val screenId = newDocumentId()
    val versionId = newDocumentId()
    resources(
      mapOf(
        "resource" to "screen",
        "id" to screenId,
        "data" to buildMap {
          put("displayName", name.trim())
          template.description?.let { put("description", it) }
          template.seo?.let { put("seo", it) }
          put("versionId", versionId)
        },
      ),
    )
    versions(
      mapOf(
        "kind" to "screen",
        "parentId" to screenId,
        "id" to versionId,
        "data" to mapOf("screenId" to screenId, "displayName" to INITIAL_VERSION_LABEL, "nodes" to nodes),
      ),
    )
    pages.publish(screenId, claimed.slug)
    return UsedPage(screenId, claimed.slug, claimed.requestedSlug)
  }

  /**
   * Takes the site root back from the placeholder home page (AGL-3408): a
   * starter is a whole site and has to land on the site's address. Only the
   * page the site names as its default home, and only while it still holds
   * `/`. Answers whether `/` was released.
   */
  suspend fun releaseDefaultHome(pages: PagesApi): Boolean {
    val host = reader.get("hosts/$hostId")?.data ?: return false
    val screenId = host["defaultHomeScreenId"] as? String ?: return false
    val routes = host["screens"] as? Map<*, *> ?: return false
    if (routes[screenId] != SCREEN_ROOT_PATH) return false
    pages.unpublish(screenId)
    writer.update("hosts/$hostId", mapOf("defaultHomeScreenId" to FirestoreDelete))
    return true
  }

  /** Every page of a starter bundle; the first takes the root when nothing in the bundle or on the site does. Answers the pages made and those that could not be. */
  suspend fun useBundle(bundle: List<TemplateContent>, pages: PagesApi): Pair<List<UsedPage>, List<String>> {
    val taken = takenAddresses()
    if (bundle.isNotEmpty() && releaseDefaultHome(pages)) taken.remove(SCREEN_ROOT_PATH)
    val made = mutableListOf<UsedPage>()
    val skipped = mutableListOf<String>()
    val ordered = withBundleRootScreen(bundle, taken, { it.slug }, { page, slug -> page.copy(slug = slug) })
    for (page in ordered) {
      val refusal = templateScreenAddressRefusal(page.slug, page.name)
      if (refusal != null) {
        skipped += "\"${page.name}\" — $refusal"
        continue
      }
      made += usePage(page, page.name, page.slug, emptyMap(), taken, pages)
    }
    return made to skipped
  }

  /** Saves a page, component or layout to the templates; answers how many placeholders it declares. */
  suspend fun saveAsTemplate(source: TemplateSource, name: String, description: String): Int {
    if (source.nodes.isEmpty()) throw TemplateProblem("Nothing to save yet — publish this first, then save it as a template.")
    val placeholders = detectTemplatePlaceholders(source.nodes)
    resources(
      mapOf(
        "resource" to "template",
        "data" to buildMap {
          put("kind", source.kind)
          put("displayName", name.trim())
          description.trim().takeIf { it.isNotEmpty() }?.let { put("description", it) }
          if (placeholders.isNotEmpty()) put("placeholders", placeholders.map { mapOf("name" to it) })
          put("nodes", source.nodes)
          source.rootId?.let { put("rootId", it) }
          source.props?.takeIf { it.isNotEmpty() }?.let { put("props", it) }
          if (source.kind == "component" && source.componentKind == "email") put("componentKind", "email")
          source.slug?.let { put("slug", it) }
          source.seo?.let { put("seo", it) }
        },
      ),
    )
    return placeholders.size
  }

  /** A component's tree to save: its own design, the properties it declares and where it is placed. */
  @Suppress("UNCHECKED_CAST")
  suspend fun componentSource(componentId: String): TemplateSource? {
    val doc = reader.get("hosts/$hostId/components/$componentId") ?: return null
    val nodes = decodeStoredNodes(doc.data["nodes"]) ?: return null
    return TemplateSource("component", nodes, rootId = doc.string("rootId"), props = doc.data["props"] as? List<Any?>, componentKind = doc.string("kind"))
  }

  /** A layout's current version to save: the tree (the slot rides in it) and the properties. */
  @Suppress("UNCHECKED_CAST")
  suspend fun layoutSource(layoutId: String, versionId: String?): TemplateSource? {
    if (versionId == null) return null
    val doc = reader.get("hosts/$hostId/layouts/$layoutId/versions/$versionId") ?: return null
    val nodes = decodeStoredNodes(doc.data["nodes"]) ?: return null
    return TemplateSource("layout", nodes, props = doc.data["props"] as? List<Any?>)
  }

  /** A page's current version to save, with the address it is on as a suggestion and its search settings. */
  @Suppress("UNCHECKED_CAST")
  suspend fun pageSource(screenId: String, versionId: String?): TemplateSource? {
    if (versionId == null) return null
    val version = reader.get("hosts/$hostId/screens/$screenId/versions/$versionId") ?: return null
    val nodes = decodeStoredNodes(version.data["nodes"]) ?: return null
    val screen = reader.get("hosts/$hostId/screens/$screenId")
    val slug = (reader.get("hosts/$hostId")?.data?.get("screens") as? Map<*, *>)?.get(screenId) as? String
    return TemplateSource("page", nodes, slug = slug, seo = (screen?.data?.get("seo") as? Map<*, *>)?.takeIf { it.isNotEmpty() } as? Map<String, Any?>)
  }
}

/** What a page address field says about its value: the refusal, or the address it would get. */
fun pageAddressProblem(slug: String, name: String): String? {
  if (screenSlugHasPathSeparator(slug)) return Contracts.screenSlugPathSeparatorMessage
  val composed = normalizeScreenSlug(slug) ?: normalizeScreenSlug(name) ?: "page"
  return reservedScreenRouteSegment(composed)?.let(::reservedScreenRouteMessage)
}
