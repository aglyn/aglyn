package com.aglyn.plugins.marketplace

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.InstallTarget
import com.aglyn.contracts.ListFilterRequest
import com.aglyn.contracts.ListQueryFilter
import com.aglyn.contracts.ListQueryOp
import com.aglyn.contracts.ListQueryRequest
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreReader
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.boolField
import com.aglyn.core.field
import com.aglyn.core.jsonBody
import com.aglyn.core.listquery.planListQuery
import com.aglyn.core.listquery.toFirestoreQuery
import com.aglyn.core.longField
import com.aglyn.core.numberField
import com.aglyn.pluginhost.jsString
import com.aglyn.ui.Load
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/*
 * The marketplace as a workspace member meets it on the console's
 * Marketplace page: browse (a category, the search and three orders, every
 * one on the query, over what the member's workspace may see), a listing's
 * details, versions and reviews, installing it (each artifact type through
 * its own route; a plugin on this site or the whole workspace), updating and
 * removing a plugin, the installed plugins, and the workspace's licenses.
 */

const val BROWSE_PAGE_SIZE = 24

const val LISTINGS = "marketplaceListings"

/* ---- Ports of the console's pure rules (MarketplaceCasesTest replays their answers). ---- */

/** Everyone, as a browse audience scope (`BROWSE_EVERYONE`). */
private const val EVERYONE = "*"

/** What a reader may see on browse (`browseBase`). */
fun browseBase(viewerOrgId: String?, publisherId: String? = null): List<ListQueryFilter> {
  val scopes = listOf(EVERYONE) + listOfNotNull(viewerOrgId?.ifEmpty { null })
  val value = if (publisherId != null) scopes.map { "$it|$publisherId" } else scopes
  return listOf(ListQueryFilter(op = ListQueryOp.ARRAY_CONTAINS_ANY, path = "browseAudience", value = JsonArray(value.map(::JsonPrimitive))))
}

/** A listing's artifact type, tolerating the legacy `type`/`kind` (`listingArtifactType`). */
fun listingArtifactType(artifactType: String?, type: String?, kind: String?): String = when {
  !artifactType.isNullOrEmpty() -> artifactType
  kind == "template" -> "template"
  type == "plugin" -> "plugin"
  else -> "component"
}

/** Whether browse shows a listing to everyone (`isListingBrowsable`). */
fun isListingBrowsable(listing: ListingRow): Boolean {
  if (listing.hiddenAt || listing.workspaceLocked || listing.visibility == "private") return false
  if (listing.artifactType != "plugin") return true
  return listing.reviewStatus == null || listing.reviewStatus == "listed" || listing.reviewStatus == "verified"
}

/** A plugin's install state for a site from its two pins (`resolvePluginInstallState`). */
data class PluginInstallState(val scope: InstallTarget?, val installedVersion: String?, val shadowed: Boolean, val updateAvailable: Boolean)

fun resolvePluginInstallState(latestVersion: String?, hostPinVersion: String?, hostPinned: Boolean, orgPinVersion: String?, orgPinned: Boolean): PluginInstallState {
  val installedVersion = if (hostPinned) hostPinVersion else if (orgPinned) orgPinVersion else null
  return PluginInstallState(
    scope = if (hostPinned) InstallTarget.HOST else if (orgPinned) InstallTarget.ORG else null,
    installedVersion = installedVersion,
    shadowed = hostPinned && orgPinned,
    updateAvailable = installedVersion != null && latestVersion != null && latestVersion != installedVersion,
  )
}

/** The route that installs an artifact type (`marketplaceInstallEndpoint`). */
fun marketplaceInstallEndpoint(artifactType: String): String = when (artifactType) {
  "template" -> "marketplace/install-template"
  "layout" -> "marketplace/install-layout"
  "plugin" -> "marketplace/install-plugin"
  "datasetSchema" -> "marketplace/install-dataset-schema"
  "emailTemplate" -> "marketplace/install-email-template"
  "emailStarter" -> "marketplace/install-email-starter"
  "theme" -> "marketplace/install-theme"
  else -> "marketplace/install"
}

/** What an install says it did, for the types that do not change the running site (`marketplaceLandingMessage`). */
fun marketplaceLandingMessage(artifactType: String, displayName: String): String? = when (artifactType) {
  "template", "layout" -> "Saved \"$displayName\" to your Templates — nothing is live until you use it."
  "emailTemplate" -> "Saved \"$displayName\" as a draft version — activate it in the email designer to start sending it."
  "emailStarter" -> "Added \"$displayName\" to your Email templates as your own copy — edit it freely, nothing is sent until you send a campaign."
  "datasetSchema" -> "Created \"$displayName\" as a new, empty dataset."
  "theme" -> "Applied \"$displayName\" to this site. Setup → Theme has a way back to your previous theme."
  else -> null
}

/** The type's label (`ARTIFACT_TYPE_LABELS`). */
fun artifactLabel(type: String): String = Contracts.artifactTypeLabels[type] ?: "Component"

/** Where a type installs (`INSTALL_TARGETS`), host-only by default. */
fun installTargets(type: String): List<InstallTarget> = Contracts.installTargets[type] ?: listOf(InstallTarget.HOST)

/* ---- Rows. ---- */

private fun FirestoreDoc.text(key: String) = (data[key] as? String)?.trim()?.ifEmpty { null }

private fun FirestoreDoc.version(key: String) = data[key]?.let { if (it is String) it.ifEmpty { null } else jsString(it) }

/** A listing as browse and its page read it. */
data class ListingRow(
  val id: String,
  val name: String,
  val description: String,
  val artifactType: String,
  val category: String?,
  val categories: List<String>,
  val priceUsd: Double,
  val latestVersion: String?,
  val latestApprovedVersion: String?,
  val reviewStatus: String?,
  val latestVersionReviewState: String?,
  val installCount: Long,
  val activeInstalls: Long?,
  val ratingAverage: Double?,
  val ratingCount: Long,
  val profileId: String?,
  val imageUrl: String?,
  val readme: String?,
  val homepageUrl: String?,
  val repositoryUrl: String?,
  val license: String?,
  val visibility: String?,
  val hiddenAt: Boolean,
  val workspaceLocked: Boolean,
  val deleted: Boolean,
  val createdAt: FirestoreTimestamp?,
) {
  val verified: Boolean get() = reviewStatus == "verified"
  val reviewed: Boolean get() = latestVersionReviewState == "approved"
  val paid: Boolean get() = priceUsd > 0
  /** The version an install gets: a plugin's newest reviewed one, anything else's newest. */
  val offeredVersion: String? get() = if (artifactType == "plugin") latestApprovedVersion else latestVersion

  companion object {
    fun from(doc: FirestoreDoc): ListingRow {
      fun image(key: String) = doc.text(key)?.takeIf { it.startsWith("https://") || it.startsWith("http://") }
      return ListingRow(
        id = doc.id,
        name = doc.text("displayName") ?: doc.id,
        description = doc.text("description").orEmpty(),
        artifactType = listingArtifactType(doc.text("artifactType"), doc.text("type"), doc.text("kind")),
        category = doc.text("category"),
        categories = (doc.data["categories"] as? List<*>)?.filterIsInstance<String>().orEmpty(),
        priceUsd = (doc.data["priceUsd"] as? Number)?.toDouble() ?: 0.0,
        latestVersion = doc.version("latestVersion"),
        latestApprovedVersion = doc.version("latestApprovedVersion"),
        reviewStatus = doc.text("reviewStatus"),
        latestVersionReviewState = doc.text("latestVersionReviewState"),
        installCount = (doc.data["installCount"] as? Number)?.toLong() ?: 0,
        activeInstalls = (doc.data["activeInstalls"] as? Number)?.toLong(),
        ratingAverage = (doc.data["ratingAverage"] as? Number)?.toDouble(),
        ratingCount = (doc.data["ratingCount"] as? Number)?.toLong() ?: 0,
        profileId = doc.text("profileId"),
        imageUrl = image("previewImageUrl") ?: image("logoUrl"),
        readme = doc.text("readme"),
        homepageUrl = doc.text("homepageUrl"),
        repositoryUrl = doc.text("repositoryUrl"),
        license = doc.text("license"),
        visibility = doc.text("visibility"),
        hiddenAt = doc.data["hiddenAt"] != null,
        workspaceLocked = doc.data["workspaceLockedAt"] != null,
        deleted = doc.data["deletedAt"] != null,
        createdAt = doc.data["createdAt"] as? FirestoreTimestamp,
      )
    }
  }
}

/** "Free" or "$12". */
fun priceLabel(priceUsd: Double): String = if (priceUsd <= 0) "Free" else "$" + com.aglyn.pluginhost.jsNumber(priceUsd)

/** "4.5 ★ (12)" or "Not yet rated". */
fun ratingLabel(listing: ListingRow): String =
  if (listing.ratingCount <= 0 || listing.ratingAverage == null) "Not yet rated" else "${com.aglyn.pluginhost.jsNumber(listing.ratingAverage)} ★ (${listing.ratingCount})"

/** One of the three browse orders (`BROWSE_SORTS`). */
enum class BrowseSort(val key: String, val label: String) { NEWEST("newest", "Newest"), INSTALLED("installed", "Most installed"), RATED("rated", "Highest rated") }

fun browseRequest(viewerOrgId: String?, category: String?, search: String, sort: BrowseSort): ListQueryRequest = ListQueryRequest(
  base = browseBase(viewerOrgId),
  clauses = listOfNotNull(category?.let { ListFilterRequest("category", "equals", it) }),
  search = search.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.ifEmpty { null },
  sort = Contracts.browseSorts[sort.key],
)

fun browseQuery(viewerOrgId: String?, category: String?, search: String, sort: BrowseSort, after: List<Any?>? = null) =
  planListQuery(Contracts.marketplaceBrowseQuery, browseRequest(viewerOrgId, category, search, sort)).toFirestoreQuery(LISTINGS, BROWSE_PAGE_SIZE, after)

/** Browse's shelf, a page at a time. */
class BrowseModel(private val viewerOrgId: String?, private val firestore: FirestoreReader, private val scope: CoroutineScope) {
  var search by mutableStateOf("")
    private set
  var category by mutableStateOf<String?>(null)
    private set
  var sort by mutableStateOf(BrowseSort.NEWEST)
    private set
  var rows by mutableStateOf<Load<List<ListingRow>>>(Load.Loading)
    private set
  var hasMore by mutableStateOf(false)
    private set
  var refreshing by mutableStateOf(false)
    private set
  private var cursor: List<Any?>? = null
  private var job: Job? = null

  fun type(next: String) { if (next != search) { search = next; reload(debounce = true) } }
  fun pick(next: String?) { if (next != category) { category = next; reload() } }
  fun order(next: BrowseSort) { if (next != sort) { sort = next; reload() } }
  fun refresh() { refreshing = true; reload(keep = true) }

  fun reload(debounce: Boolean = false, keep: Boolean = false) {
    job?.cancel()
    if (!keep && !debounce) rows = Load.Loading
    job = scope.launch {
      if (debounce) delay(300)
      if (!keep) rows = Load.Loading
      rows = try {
        val page = firestore.page(browseQuery(viewerOrgId, category, search, sort))
        cursor = page.nextCursor
        hasMore = page.nextCursor != null
        Load.Ready(page.docs.map(ListingRow::from))
      } catch (error: Throwable) {
        if (error is CancellationException) throw error
        hasMore = false
        Load.Failed("The marketplace could not be loaded. Check the connection and try again.")
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
      runCatching { firestore.page(browseQuery(viewerOrgId, category, search, sort, after)) }.onSuccess { page ->
        cursor = page.nextCursor
        hasMore = page.nextCursor != null
        rows = Load.Ready(shown + page.docs.map(ListingRow::from).filter { row -> shown.none { it.id == row.id } })
      }
    }
  }
}

/** One published version, as the listing's version history reads it. */
data class ListingVersion(val version: String, val changelog: String?, val publishedAtMs: Long?, val activeInstalls: Long?)

/** One review: who, the stars and the words. */
data class ReviewRow(val uid: String, val name: String, val rating: Long?, val comment: String?, val verifiedInstaller: Boolean, val updatedAtMs: Long?) {
  companion object {
    fun from(doc: FirestoreDoc): ReviewRow? {
      if (doc.data["hidden"] == true) return null
      return ReviewRow(
        uid = doc.string("uid") ?: doc.id,
        name = doc.string("displayName")?.ifBlank { null } ?: "A member",
        rating = (doc.data["rating"] as? Number)?.toLong(),
        comment = doc.string("comment")?.ifBlank { null },
        verifiedInstaller = doc.data["verifiedInstaller"] == true,
        updatedAtMs = (doc.data["updatedAtMs"] as? Number)?.toLong(),
      )
    }
  }
}

/** A plugin pin (`hosts/{h}/installs/{id}` or `orgs/{o}/installs/{id}`). */
data class InstallPinRow(val listingId: String, val name: String, val version: String?, val scope: InstallTarget) {
  companion object {
    fun from(doc: FirestoreDoc, scope: InstallTarget) = InstallPinRow(
      listingId = doc.string("listingId") ?: doc.id,
      name = doc.string("displayName")?.ifBlank { null } ?: (doc.data["manifest"] as? Map<*, *>)?.get("name") as? String ?: doc.id,
      version = doc.data["version"]?.let { jsString(it) },
      scope = scope,
    )
  }
}

/** A purchase the workspace holds (`marketplacePurchases`). */
data class LicenceRow(val id: String, val listingId: String, val buyerUid: String?, val paidCents: Long, val createdAt: FirestoreTimestamp?) {
  companion object {
    fun from(doc: FirestoreDoc) = LicenceRow(
      id = doc.id,
      listingId = doc.string("listingId").orEmpty(),
      buyerUid = doc.string("buyerUid"),
      paidCents = ((doc.data["amountCents"] as? Number)?.toLong() ?: 0) - ((doc.data["taxCents"] as? Number)?.toLong() ?: 0),
      createdAt = doc.data["createdAt"] as? FirestoreTimestamp,
    )
  }
}

/** What an install answered, in a person's words. */
data class InstallOutcome(val message: String, val warning: String?)

class MarketplaceApi(private val api: ConsoleApiClient) {
  /** Installs [listing] on [hostId] (or, for a plugin with [scope] org, every site of the workspace). */
  suspend fun install(listing: ListingRow, hostId: String, scope: InstallTarget?): InstallOutcome {
    val answer = api.request(
      "/api/" + marketplaceInstallEndpoint(listing.artifactType),
      ApiMethod.POST,
      jsonBody(
        "listingId" to listing.id,
        "hostId" to hostId,
        "scope" to if (scope == InstallTarget.ORG) "org" else null,
        "version" to if (listing.artifactType == "plugin") listing.latestApprovedVersion else null,
      ),
    )
    val upgraded = answer.boolField("upgraded") == true || answer.boolField("updated") == true
    val version = answer.field("version") ?: answer.numberField("version")?.let { com.aglyn.pluginhost.jsNumber(it) }
    val message = marketplaceLandingMessage(listing.artifactType, listing.name)
      ?: (if (upgraded) "Updated \"${listing.name}\"" else "Installed \"${listing.name}\"") + (version?.let { " (v$it)" } ?: "") + "."
    return InstallOutcome(message, answer.field("hostAbiWarning"))
  }

  /** Removes a plugin's pin from [hostId], or from the workspace with [scope] org. */
  suspend fun uninstall(listingId: String, hostId: String, scope: InstallTarget) {
    api.request(
      "/api/marketplace/install-plugin",
      ApiMethod.POST,
      jsonBody("listingId" to listingId, "hostId" to hostId, "action" to "uninstall", "scope" to if (scope == InstallTarget.ORG) "org" else null),
    )
  }

  /** The listing's published versions, newest first (`/api/marketplace/listing-versions`). */
  suspend fun versions(listingId: String): List<ListingVersion> {
    val answer = api.request("/api/marketplace/listing-versions", ApiMethod.GET, query = mapOf("listingId" to listingId)) as? JsonObject
    return (answer?.get("versions") as? JsonArray)?.mapNotNull { entry ->
      val row = entry as? JsonObject ?: return@mapNotNull null
      val version = (row["version"] as? JsonPrimitive)?.contentOrNull ?: return@mapNotNull null
      ListingVersion(version, (row["changelog"] as? JsonPrimitive)?.contentOrNull?.ifBlank { null }, row.longField("publishedAtMs"), row.longField("activeInstalls"))
    }.orEmpty()
  }

  /** Rates and reviews a listing (1–5, or only words). */
  suspend fun review(listingId: String, rating: Int?, comment: String) {
    api.request("/api/marketplace/reviews", ApiMethod.POST, jsonBody("listingId" to listingId, "rating" to rating, "comment" to comment.trim().ifEmpty { null }))
  }

  suspend fun deleteReview(listingId: String) {
    api.request("/api/marketplace/reviews", ApiMethod.DELETE, jsonBody("listingId" to listingId))
  }

  /** Reports a listing to staff. */
  suspend fun report(listingId: String, reason: String) {
    api.request("/api/marketplace/report", ApiMethod.POST, jsonBody("listingId" to listingId, "reason" to reason.trim()))
  }
}

/** "This workspace": its live purchases, by document id (`HELD_LICENCE_QUERY` over `licenceBase`). */
fun licencesQuery(orgId: String) = planListQuery(
  Contracts.heldLicenceQuery,
  ListQueryRequest(
    base = listOf(
      ListQueryFilter(op = ListQueryOp.EQUAL, path = "buyerOrgId", value = JsonPrimitive(orgId)),
      ListQueryFilter(op = ListQueryOp.EQUAL, path = "refundedAt", value = JsonNull),
    ),
    clauses = emptyList(),
  ),
).toFirestoreQuery("marketplacePurchases", 100)
