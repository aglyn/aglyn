package com.aglyn.plugins.commerce.products

import com.aglyn.contracts.mediaRefFromCdnPath
import com.aglyn.contracts.mediaRefFromStorageUrl
import com.aglyn.contracts.parseMediaRef

/*
 * Paid media, as the console's product editor has it (AGL-2814, AGL-2847): a product's members videos and paid downloads
 * are PRIVATE files, so adding one makes it private first, and the editor says what that costs. The words, the places that
 * count and the library a media route is asked of are the console's (`model/paid-media.ts`), replayed from
 * function-cases.generated.json. PaidMedia.swift, line for line.
 */

enum class PaidMediaKind(
  val title: String,
  val lead: String,
  val notAdded: String,
  val unusable: String,
  val choose: String,
) {
  VIDEO(
    "Make this video private?",
    "Members videos are private: buyers play them through a link that expires, and nobody else can open them.",
    "The video was not added.",
    "Members cannot play it until it is private.",
    "Choose the video from the media library, so its links can expire.",
  ),
  DOWNLOAD(
    "Make this file private?",
    "Paid downloads are private: buyers get a link that expires, and nobody else can open the file.",
    "The file was not added.",
    "Buyers cannot download it until it is private.",
    "Choose the file from the media library, so its links can expire.",
  ),
}

/** A where-used row, reduced to what the confirmation reads. */
data class PaidMediaReference(val kind: String, val id: String, val name: String, val hostId: String, val collectionId: String?)

/** How far the where-used scan got before the author was asked. */
enum class PaidMediaUsageCheck { FULL, PARTIAL, FAILED }

/** The request body that names an asset's library to the media routes: a workspace library by its org, a site's by itself. */
fun paidMediaScopeBody(scope: String): Map<String, String> =
  if (scope.startsWith("org:")) mapOf("orgId" to scope.removePrefix("org:").split(":").first()) else mapOf("hostId" to scope)

/**
 * Where an asset is used, apart from the product it is being added to: that product's own row is not a place making it
 * private could break.
 */
fun usesBesideProduct(references: List<PaidMediaReference>, hostId: String, productId: String?): List<PaidMediaReference> =
  references.filter { reference ->
    productId.isNullOrEmpty() || !(reference.kind == "plugin" && reference.collectionId == "products" && reference.hostId == hostId && reference.id == productId)
  }

/** What the author reads before a file becomes private. */
fun paidMediaConfirmation(others: List<PaidMediaReference>, checked: PaidMediaUsageCheck, kind: PaidMediaKind): String {
  val usage = when {
    others.isNotEmpty() -> {
      val names = others.take(3).joinToString(", ") { "“${it.name}”" }
      val more = if (others.size > 3) " and ${others.size - 3} more" else ""
      "It is also used on $names$more, and it stops showing there."
    }
    checked == PaidMediaUsageCheck.FULL -> "Nothing else uses it."
    checked == PaidMediaUsageCheck.PARTIAL -> "We could not check everywhere it might be used, so something else could still rely on it."
    else -> "We could not check where else it is used."
  }
  return "${kind.lead} $usage Any public link to it that was already shared stops working too."
}

/**
 * What a stored paid-media value names. A reference (`media:`), a CDN path or a Storage download URL of the library names an
 * asset, any other address is somebody else's server, and anything else cannot be delivered. (The console also reads a Cloud
 * Storage object URL and this site's absolute CDN address as an asset; they only come from an import, and show here as hosted
 * elsewhere.)
 */
sealed interface PaidMediaSource {
  data class Asset(val scope: String, val mediaId: String) : PaidMediaSource
  data object External : PaidMediaSource
  data object Malformed : PaidMediaSource
}

fun paidMediaSource(stored: String?): PaidMediaSource {
  val value = stored?.trim().orEmpty()
  if (value.isEmpty()) return PaidMediaSource.Malformed
  fun asset(reference: String?): PaidMediaSource =
    parseMediaRef(reference)?.let { PaidMediaSource.Asset(it.scope, it.mediaId) } ?: PaidMediaSource.Malformed
  if (value.startsWith("media:")) return asset(value)
  if (value.startsWith("/api/media/cdn/")) return asset(mediaRefFromCdnPath(value))
  val lower = value.lowercase()
  if (!lower.startsWith("https://") && !lower.startsWith("http://")) return PaidMediaSource.Malformed
  mediaRefFromStorageUrl(value)?.let { return asset(it) }
  return PaidMediaSource.External
}

/** The document an asset's reference names, as the path the library keeps it at: `hosts/{host}/media/{id}` or `orgs/{org}/media/{id}`. */
fun paidMediaDocumentPath(scope: String, mediaId: String): String =
  if (scope.startsWith("org:")) "orgs/${paidMediaScopeBody(scope)["orgId"].orEmpty()}/media/$mediaId" else "hosts/$scope/media/$mediaId"
