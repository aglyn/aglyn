package com.aglyn.site.sites

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.ListFilterRequest
import com.aglyn.contracts.ListQueryRequest
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.SiteStarterMode
import com.aglyn.core.SiteStarterPickRefused
import com.aglyn.core.SiteStarterSummary
import com.aglyn.core.SiteStyles
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreReader
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.field
import com.aglyn.core.jsonBody
import com.aglyn.core.listquery.planListQuery
import com.aglyn.core.listquery.toFirestoreQuery
import com.aglyn.core.readSiteStarterPickRefusal
import com.aglyn.core.siteStarterPickBlock
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
 * The workspace's sites, as the console's Sites cards list them: one query
 * on the member's own `users/{uid}/hostMemberships` rows (SITE_LIST_DECLARATION,
 * the workspace as its base, the search and the custom-domain filter as
 * clauses on it), each row joined to its site document for the status pill.
 */

const val SITES_PAGE_SIZE = 30

/** The chips above the list: every site, or only those with or without a custom domain. */
enum class SiteDomainFilter(val label: String, val value: String?) {
  ALL("All", null),
  CONNECTED("Custom domain", "true"),
  NONE("No custom domain", "false"),
}

fun sitesRequest(orgId: String, search: String, domain: SiteDomainFilter): ListQueryRequest = ListQueryRequest(
  base = listOf(com.aglyn.contracts.ListQueryFilter(op = com.aglyn.contracts.ListQueryOp.EQUAL, path = "orgId", value = JsonPrimitive(orgId))),
  clauses = buildList { domain.value?.let { add(ListFilterRequest("hasCustomDomain", "is", it)) } },
  search = search.trim().ifEmpty { null }?.let { listOf(it) },
)

/** One row of the list: the membership row's own fields. */
data class SiteRow(
  val id: String,
  val name: String,
  val subdomain: String?,
  val role: String?,
  val hasCustomDomain: Boolean,
  val favicon: String?,
  val createdAt: FirestoreTimestamp?,
  /** The site's custom domain as its membership row mirrors it (`cname`); absent on rows older than the mirror. */
  val cname: String? = null,
)

fun siteRowOf(doc: FirestoreDoc): SiteRow {
  val subdomain = doc.string("subdomain")?.ifBlank { null }
  return SiteRow(
    id = doc.id,
    name = doc.string("displayName")?.ifBlank { null } ?: subdomain ?: doc.id,
    subdomain = subdomain,
    role = doc.string("role"),
    hasCustomDomain = doc.bool("hasCustomDomain") == true,
    favicon = doc.string("favicon")?.ifBlank { null },
    createdAt = doc.data["createdAt"] as? FirestoreTimestamp,
    cname = doc.string("cname")?.trim()?.ifBlank { null },
  )
}

/** The workspace's sites: the search, the chip, the rows read so far and whether more are left. */
class SitesListModel(
  private val uid: String,
  private val orgId: String,
  private val firestore: FirestoreReader,
  private val scope: CoroutineScope,
) {
  var search by mutableStateOf("")
    private set
  var domain by mutableStateOf(SiteDomainFilter.ALL)
    private set
  var rows by mutableStateOf<Load<List<SiteRow>>>(Load.Loading)
    private set
  var hasMore by mutableStateOf(false)
    private set
  var refreshing by mutableStateOf(false)
    private set
  private var cursor: List<Any?>? = null
  private var job: Job? = null

  private fun query(startAfter: List<Any?>? = null) =
    planListQuery(Contracts.siteListDeclaration, sitesRequest(orgId, search, domain))
      .toFirestoreQuery("users/$uid/hostMemberships", SITES_PAGE_SIZE, startAfter)

  fun type(next: String) {
    if (next == search) return
    search = next
    reload(debounce = true)
  }

  fun pick(next: SiteDomainFilter) {
    if (next == domain) return
    domain = next
    reload()
  }

  fun refresh() {
    refreshing = true
    reload(keepRows = true)
  }

  fun reload(debounce: Boolean = false, keepRows: Boolean = false) {
    job?.cancel()
    if (!debounce && !keepRows) rows = Load.Loading
    job = scope.launch {
      if (debounce) delay(300)
      if (!keepRows) rows = Load.Loading
      rows = try {
        val page = firestore.page(query())
        cursor = page.nextCursor
        hasMore = page.nextCursor != null
        Load.Ready(page.docs.map(::siteRowOf))
      } catch (error: Throwable) {
        if (error is CancellationException) throw error
        hasMore = false
        Load.Failed("Sites could not be loaded. Check the connection and try again.")
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
      runCatching { firestore.page(query(after)) }.onSuccess { page ->
        cursor = page.nextCursor
        hasMore = page.nextCursor != null
        rows = Load.Ready(shown + page.docs.map(::siteRowOf).filter { row -> shown.none { it.id == row.id } })
      }
    }
  }
}

/**
 * The create-site route's answer, or its refusal with the addresses it suggests instead, or its refusal of the starter
 * picked, which is about the pick and not the name.
 */
sealed interface CreateSiteResult {
  data class Created(val hostId: String, val subdomain: String) : CreateSiteResult
  data class Refused(val message: String, val suggestions: List<String>) : CreateSiteResult
  data class PickRefused(val refused: SiteStarterPickRefused) : CreateSiteResult
}

/**
 * What a site starts from: a style, or a starter from the marketplace. Nothing in Create site is chosen for anyone, so a
 * create names one of the two.
 */
sealed interface SiteStart {
  data class Style(val id: String) : SiteStart
  data class Starter(val listingId: String) : SiteStart
}

/** The site-address rule the create route holds (`SUBDOMAIN_PATTERN`). */
val SUBDOMAIN_PATTERN = Regex("^[a-z0-9][a-z0-9-]{2,29}$")

/**
 * A starting address from a site's name, as the create dialog fills it: lower
 * case, every run of other characters one hyphen, at most 30 characters. The
 * route is the judge; a taken or reserved address comes back with suggestions.
 */
fun suggestSubdomain(name: String): String = name.lowercase()
  .replace(Regex("[^a-z0-9]+"), "-")
  .replace(Regex("-{2,}"), "-")
  .trim('-')
  .take(30)
  .trimEnd('-')

/**
 * Whether Create site can go ahead: a name, an address the route's pattern takes, and a style the person picked. Nothing in
 * Create site is chosen for anyone (AGL-4049), so until a style is picked the button stays off. The starter site has no
 * "Pick for me": that card is the AI start's, and the route refuses it here.
 */
fun canCreateSite(name: String, subdomain: String, style: String?): Boolean =
  name.isNotBlank() && SUBDOMAIN_PATTERN.matches(subdomain) && SiteStyles.all.any { it.id == style }

/**
 * Whether Create site can go ahead from a starter: a name, an address the route's pattern takes, and a starter the site can
 * be created from here. A price not paid waits to be bought, and an AI starter goes on to its questions, which the app does
 * not ask: the console's Create site does both.
 */
fun canCreateSiteFromStarter(name: String, subdomain: String, pick: SiteStarterSummary?, owned: Boolean? = null): Boolean =
  name.isNotBlank() && SUBDOMAIN_PATTERN.matches(subdomain) && siteStarterPickBlock(pick, owned) == null && pick?.mode == SiteStarterMode.BASE

/**
 * What Create site sends. `start: "starter"` is the console's own "Create the
 * starter site" answer: the site is born with the starter website in the same
 * request. Without it the server may create the site empty to offer the guided
 * AI start (`guidedStart` in its answer), and the app has no such start to
 * land on, which would leave an empty site. `style` is the one the person
 * chose: the site starts in its look, and the route records it on the site.
 */
fun createSiteBody(orgId: String, name: String, subdomain: String, style: String): JsonObject =
  jsonBody("displayName" to name.trim(), "subdomain" to subdomain.trim().lowercase(), "orgId" to orgId, "start" to "starter", "style" to style)

/**
 * What Create site sends for a starter from the marketplace, as the console's own "Choose your starter" does: the listing,
 * with no style, since the starter brings its own look.
 */
fun createSiteBody(orgId: String, name: String, subdomain: String, starter: SiteStart.Starter): JsonObject =
  jsonBody(
    "displayName" to name.trim(), "subdomain" to subdomain.trim().lowercase(), "orgId" to orgId, "start" to "starter",
    "starter" to mapOf("listingId" to starter.listingId),
  )

/** `POST /api/hosts/create`, the console's own Create site. */
suspend fun createSite(api: ConsoleApiClient, orgId: String, name: String, subdomain: String, start: SiteStart): CreateSiteResult = try {
  val body = when (start) {
    is SiteStart.Style -> createSiteBody(orgId, name, subdomain, start.id)
    is SiteStart.Starter -> createSiteBody(orgId, name, subdomain, start)
  }
  val answer = api.request("/api/hosts/create", ApiMethod.POST, body)
  CreateSiteResult.Created(answer.field("hostId").orEmpty(), answer.field("subdomain") ?: subdomain)
} catch (error: ConsoleApiError) {
  if (error.status == 0) throw error
  val refused = (start as? SiteStart.Starter)?.let { readSiteStarterPickRefusal(error.status, error.body, it.listingId) }
  if (refused != null) {
    CreateSiteResult.PickRefused(refused)
  } else {
    val suggestions = ((error.body as? JsonObject)?.get("suggestions") as? JsonArray)
      ?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
      .orEmpty()
    CreateSiteResult.Refused(error.message, suggestions)
  }
}

/** `POST /api/hosts/create` in the style the person chose. */
suspend fun createSite(api: ConsoleApiClient, orgId: String, name: String, subdomain: String, style: String): CreateSiteResult =
  createSite(api, orgId, name, subdomain, SiteStart.Style(style))
