package com.aglyn.plugins.marketplace

import com.aglyn.core.SiteStarterMode
import com.aglyn.core.SiteStarterSearch
import com.aglyn.core.SiteStarterSummary
import com.aglyn.core.SiteStyles
import com.aglyn.core.mediaPreviewUrl
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlin.math.floor

/**
 * The starter search as a request and an answer (`model/starter-query.ts`), line for line: the same parameters in the same
 * order, the same defensive read of the answer, the same "3 pages". derived-values.generated.json's `siteStarters`
 * holds the console's own answers, which the tests replay on both platforms.
 */
internal object StarterQuery {
  /** The query string for one search, its parameters always in one order. */
  fun params(orgId: String, mode: SiteStarterMode, word: String = "", limit: Int = SiteStarterSearch.MAX): List<Pair<String, String>> {
    val out = mutableListOf("orgId" to orgId.trim(), "mode" to mode.wire)
    val typed = word.trim().take(SiteStarterSearch.WORD_MAX)
    if (typed.isNotEmpty()) out += "q" to typed
    out += "limit" to (if (limit > 0) minOf(limit, SiteStarterSearch.MAX) else SiteStarterSearch.MAX).toString()
    return out
  }

  /**
   * One starter as a row shows it, read field by field, or null for a row with no listing id. Each field falls back the way
   * a row needs it to: a missing price is free, a missing picture is none, a mode is `base` unless it says `ai`, and `owned`
   * is kept only where the answer gave it as a yes or a no.
   */
  fun readSummary(value: JsonElement?): SiteStarterSummary? {
    val row = value as? JsonObject ?: return null
    val listingId = idOrNull(row["listingId"]) ?: return null
    val facets = row["facets"] as? JsonObject
    val price = number(row["priceUsd"]) ?: 0.0
    val pages = number(facets?.get("pages")) ?: 0.0
    return SiteStarterSummary(
      listingId = listingId,
      displayName = text(row["displayName"]).orEmpty(),
      description = text(row["description"]).orEmpty(),
      authorName = text(row["authorName"]).orEmpty(),
      official = (row["official"] as? JsonPrimitive)?.takeUnless { it.isString }?.booleanOrNull == true,
      priceUsd = if (price > 0) price else 0.0,
      previewImageUrl = text(row["previewImageUrl"])?.ifEmpty { null },
      kind = idOrNull(facets?.get("kind")),
      pages = if (pages > 0) floor(pages).toInt() else 0,
      mode = if (text(facets?.get("mode")) == "ai") SiteStarterMode.AI else SiteStarterMode.BASE,
      owned = (row["owned"] as? JsonPrimitive)?.takeUnless { it.isString }?.booleanOrNull,
    )
  }

  /** The route's answer, read defensively: rows that are not starters are dropped, as is a duplicate of one already read. */
  fun parseAnswer(json: JsonElement?): List<SiteStarterSummary> =
    ((json as? JsonObject)?.get("rows") as? JsonArray).orEmpty().mapNotNull(::readSummary).distinctBy { it.listingId }

  /** How many pages a starter creates, or null when it does not say. */
  fun pagesLabel(pages: Double): String? {
    if (!pages.isFinite() || pages < 1) return null
    val whole = floor(pages).toLong()
    return if (whole == 1L) "1 page" else "$whole pages"
  }

  private fun text(value: JsonElement?): String? = (value as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

  private fun idOrNull(value: JsonElement?): String? = text(value)?.trim()?.ifEmpty { null }

  private fun number(value: JsonElement?): Double? =
    (value as? JsonPrimitive)?.let { it.doubleOrNull ?: it.contentOrNull?.trim()?.toDoubleOrNull() }?.takeIf { it.isFinite() }
}

/**
 * A starter's picture as an app can read it. The platform's own starters show the style pictures on a path that answers
 * OkHttp with a challenge, and each has a path an app can read (AGL-4127).
 */
internal fun starterPicture(row: SiteStarterSummary, origin: String, width: Int): String? {
  val stored = row.previewImageUrl?.let { url -> SiteStyles.all.firstOrNull { url.endsWith("/_static/starter/styles/${it.id}.webp") }?.preview ?: url }
  return mediaPreviewUrl(stored, origin, null, width)
}
