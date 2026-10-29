package com.aglyn.plugins.marketplace

import com.aglyn.contracts.Contracts
import com.aglyn.contracts.PayoutReadiness
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.boolField
import com.aglyn.core.field
import com.aglyn.core.jsonBody
import kotlin.math.abs
import kotlin.math.roundToLong

/*
 * The seller side of the marketplace as a publisher meets it on the console's Marketplace page: the public profile (a handle, a
 * name, a logo, a bio and the ways to reach the publisher), the listings they sell and what can be done to each, payouts through
 * Stripe Connect, and the sales ledger. A publisher is a workspace, so everything is keyed by the org.
 */

/** The listings a workspace publishes: `marketplaceListings` filtered by `profileId`, which is the org id (not a uid). */
fun sellerListingsQuery(orgId: String): FirestoreQuery = FirestoreQuery(LISTINGS, filters = listOf(FirestoreFilter("profileId", FilterOp.EQ, orgId)))

/** The workspace's sales: `marketplacePurchases` filtered by `sellerOrgId`, which the rules read the query for. */
fun sellerSalesQuery(orgId: String): FirestoreQuery = FirestoreQuery("marketplacePurchases", filters = listOf(FirestoreFilter("sellerOrgId", FilterOp.EQ, orgId)))

/** The entity that holds the sales-tax registration marketplace sales are remitted under (`PLATFORM_BRAND_LEGAL_NAME`'s default). */
const val PLATFORM_LEGAL_NAME = "Aglyn LLC"

/** The publisher profile document: `publisherProfiles/{orgId}`. */
fun publisherProfilePath(orgId: String) = "publisherProfiles/$orgId"

/** One of the workspace's listings, as the Your listings card lists it. */
data class SellerListing(
  val id: String,
  val displayName: String,
  val latestVersion: String?,
  val priceUsd: Double,
  val visibility: String?,
  val unpublished: Boolean,
  val hasPreview: Boolean,
  /** `plugin`, `component`, `layout`, `template`…: a plugin has a bundle and a private audience; the rest do not. */
  val artifactType: String,
  val source: Map<String, Any?>,
) {
  val isPrivate: Boolean get() = visibility == "private"
  val isPlugin: Boolean get() = artifactType == "plugin"

  /** "v3 · $5 · has preview · unpublished". */
  val subtitle: String
    get() = buildString {
      append("v").append(latestVersion ?: "")
      append(if (priceUsd > 0) " · \$" + com.aglyn.pluginhost.jsNumber(priceUsd) else " · free")
      if (hasPreview) append(" · has preview")
      if (unpublished) append(" · unpublished")
    }

  companion object {
    fun from(doc: FirestoreDoc): SellerListing = SellerListing(
      id = doc.id,
      displayName = doc.string("displayName").orEmpty(),
      latestVersion = doc.data["latestVersion"]?.let { com.aglyn.pluginhost.jsString(it) },
      priceUsd = (doc.data["priceUsd"] as? Number)?.toDouble() ?: 0.0,
      visibility = doc.string("visibility"),
      unpublished = doc.data["deletedAt"] != null,
      hasPreview = !doc.string("previewImageUrl").isNullOrEmpty(),
      artifactType = listingArtifactType(doc.string("artifactType"), doc.string("type"), doc.string("kind")),
      source = doc.data,
    )
  }
}

/** The text of a field, or empty: the editors read a stored URL or word the way the console's inputs do. */
fun SellerListing.text(key: String): String = (source[key] as? String).orEmpty()

/** The listing's first category: `categories[0]` of a listing, or the older single `category`. */
val SellerListing.category: String get() = ((source["categories"] as? List<*>)?.firstOrNull() as? String) ?: text("category")

/** The gallery under the listing's body, in order. */
val SellerListing.screenshots: List<String> get() = (source["screenshots"] as? List<*>)?.filterIsInstance<String>().orEmpty()

/** How many screenshots a listing's gallery holds (the console editor's `MAX_SCREENSHOTS`). */
const val MAX_LISTING_SCREENSHOTS = 6

/** What the console says a listing's logo should be (`LISTING_LOGO_HINT`). */
const val LISTING_LOGO_HINT = "Recommended: a square PNG or SVG, at least 256×256 — listings are shown as square tiles."

/**
 * What a picture chosen for a listing stores, as the console's picker hands it back: the path the CDN serves the file
 * from, else its address.
 */
fun listingMediaValue(cdnPath: String?, url: String?): String = cdnPath ?: url.orEmpty()

/** The gallery after adding [picked]: a file already in it, or one past the cap, changes nothing (the console's own rule). */
fun addingScreenshot(picked: String, current: List<String>): List<String> =
  if (current.size >= MAX_LISTING_SCREENSHOTS || picked in current) current else current + picked

/** "$12.34" from cents (`$${(cents / 100).toFixed(2)}`). */
fun dollars(cents: Double): String {
  val whole = (cents.takeIf { it.isFinite() } ?: 0.0).roundToLong()
  val sign = if (whole < 0) "-" else ""
  return "$sign\$${abs(whole) / 100}.${(abs(whole) % 100).toString().padStart(2, '0')}"
}

/** The first line a Payouts card says about the arrangement, per where it stands. */
fun payoutsSentence(readiness: PayoutReadiness): String = when (readiness) {
  PayoutReadiness.READY -> "Payouts are enabled — paid listings transfer to your Stripe account automatically (platform fee 20%, 30% on the Free plan)."
  PayoutReadiness.UNKNOWN ->
    "Your Stripe account is connected. We haven’t checked whether payouts are released yet — recheck to confirm. The platform fee is 20% per sale (30% on the Free plan)."
  PayoutReadiness.BLOCKED, PayoutReadiness.UNVERIFIED -> "The platform fee is 20% per sale (30% on the Free plan)."
  else -> "Connect a Stripe account to sell components. The platform fee is 20% per sale (30% on the Free plan)."
}

/** The button under it. */
fun payoutsButton(readiness: PayoutReadiness): String = when (readiness) {
  PayoutReadiness.READY -> "Payouts enabled — recheck status"
  PayoutReadiness.BLOCKED -> "Finish payout setup in Stripe"
  PayoutReadiness.UNVERIFIED -> "Reconnect Stripe to verify"
  PayoutReadiness.UNKNOWN -> "Recheck payout status"
  else -> "Set up payouts"
}

/**
 * The Marketplace Publisher Agreement a save agrees to (AGL-4105), sent as the console sends it, `{ version, accepted: true }`.
 * A seller screen makes one only once its box is ticked, and each save makes its own.
 */
data class PublisherAgreementConsent(val version: String) {
  val body: Map<String, Any?> get() = mapOf("version" to version, "accepted" to true)

  companion object {
    /** The version in force, as the contracts carry the console's `PUBLISHER_AGREEMENT_VERSION`. */
    val current: PublisherAgreementConsent get() = PublisherAgreementConsent(Contracts.publisherAgreementVersion)
  }
}

/** What `/api/marketplace/connect` answers. */
data class ConnectAnswer(val chargesEnabled: Boolean, val payoutsEnabled: Boolean?, val url: String?, val dashboardUrl: String?)

/** The routes the seller cards call: the console's own, each answering in the sentence the card shows. */
class SellerApi(private val api: ConsoleApiClient, private val orgId: String) {
  /** Saves the public profile; the handle is claimed on the server, so two workspaces cannot both win it. */
  suspend fun saveProfile(fields: Map<String, String>, agreement: PublisherAgreementConsent) {
    api.request(
      "/api/marketplace/publisher-profile",
      ApiMethod.POST,
      jsonBody("orgId" to orgId, *fields.map { it.key to it.value }.toTypedArray(), "agreement" to agreement.body),
    )
  }

  /** Starts, or rechecks, Stripe Connect onboarding; null where the deployment holds no Connect key (a 501). */
  suspend fun connect(): ConnectAnswer? {
    val answer = api.request("/api/marketplace/connect", ApiMethod.POST, jsonBody("orgId" to orgId))
    return ConnectAnswer(
      chargesEnabled = answer.boolField("chargesEnabled") == true,
      payoutsEnabled = answer.boolField("payoutsEnabled"),
      url = answer.field("url"),
      dashboardUrl = answer.field("dashboardUrl"),
    )
  }

  suspend fun setVisibility(listingId: String, visibility: String, agreement: PublisherAgreementConsent) {
    api.request(
      "/api/marketplace/publish-plugin",
      ApiMethod.POST,
      jsonBody("action" to "set-visibility", "listingId" to listingId, "visibility" to visibility, "agreement" to agreement.body),
    )
  }

  /** Unpublishes, or republishes, a listing: server-side, because browse reads each listing's audience, which only the server derives. */
  suspend fun setPublished(listingId: String, published: Boolean, agreement: PublisherAgreementConsent) {
    api.request(
      "/api/marketplace/publish-plugin",
      ApiMethod.POST,
      jsonBody("action" to "set-published", "listingId" to listingId, "published" to published, "agreement" to agreement.body),
    )
  }

  /** The listing's words, links and screenshots; a field left out is left as it is, and so is the preview. */
  suspend fun updateListing(listingId: String, fields: Map<String, String>, category: String, screenshots: List<String>, agreement: PublisherAgreementConsent) {
    api.request(
      "/api/marketplace/publish-plugin",
      ApiMethod.POST,
      jsonBody(
        "action" to "update-listing",
        "listingId" to listingId,
        *fields.map { it.key to it.value }.toTypedArray(),
        "categories" to if (category.isNotEmpty()) listOf(category) else emptyList<String>(),
        "screenshots" to screenshots,
        "agreement" to agreement.body,
      ),
    )
  }

  /**
   * Sets the preview image to a file from the media library, or removes it when [url] is empty: the route of its own the
   * console's editor calls, because the preview is not a content field.
   */
  suspend fun setPreviewImage(listingId: String, url: String, agreement: PublisherAgreementConsent) {
    if (url.isEmpty()) {
      api.request("/api/marketplace/preview-image", ApiMethod.DELETE, jsonBody("listingId" to listingId, "agreement" to agreement.body))
    } else {
      api.request("/api/marketplace/preview-image", ApiMethod.POST, jsonBody("listingId" to listingId, "url" to url, "agreement" to agreement.body))
    }
  }
}
