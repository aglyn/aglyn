package com.aglyn.core

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlin.math.floor
import kotlin.math.roundToLong

/** How a site is filled: its pages as they are, or by the AI site start (`SiteStarterMode`). */
enum class SiteStarterMode(val wire: String) { BASE("base"), AI("ai") }

/** One starter as a list shows it (`SiteStarterSummary`). Core names the shape; a plugin supplies the rows. */
data class SiteStarterSummary(
  val listingId: String,
  val displayName: String,
  val description: String = "",
  val authorName: String = "",
  val official: Boolean = false,
  val priceUsd: Double = 0.0,
  val previewImageUrl: String? = null,
  val kind: String? = null,
  val pages: Int = 0,
  val mode: SiteStarterMode = SiteStarterMode.BASE,
  /** Null is "the search does not know", as on a free starter, which needs no purchase. */
  val owned: Boolean? = null,
)

/** What stands between a pick and Create site (`SiteStarterPickBlock`): nothing picked, or a price not paid. */
enum class SiteStarterPickBlock { NONE, PURCHASE }

/**
 * `siteStarterPickBlock`: null when a site can be created from the pick. [owned] is what the surface knows better than the
 * search's own answer.
 */
fun siteStarterPickBlock(pick: SiteStarterSummary?, owned: Boolean? = null): SiteStarterPickBlock? = when {
  pick == null -> SiteStarterPickBlock.NONE
  pick.priceUsd > 0 && !(owned ?: (pick.owned == true)) -> SiteStarterPickBlock.PURCHASE
  else -> null
}

/** A starter's price as a list shows it (`starterPriceLabel`): "Free" at zero, whole dollars as "$12", and cents only where there are some. */
fun siteStarterPriceLabel(usd: Double): String {
  if (!usd.isFinite() || usd <= 0) return "Free"
  if (usd == floor(usd)) return "$" + usd.toLong()
  val cents = (usd * 100).roundToLong()
  return "$" + (cents / 100) + "." + (cents % 100).toString().padStart(2, '0')
}

/**
 * What a pick needs next, said where it stays in view: a price to pay or an AI starter's questions, both on the web, or a
 * purchase already made. The apps do not take payment for a starter yet, and do not ask an AI starter's questions.
 */
data class SiteStarterPickNote(
  val message: String,
  /** The button that opens the console's Create site on the pick; null when nothing is left to do there. */
  val webAction: String?,
)

/** Null for a pick that needs saying nothing: a free base starter creates at once. */
fun siteStarterPickNote(pick: SiteStarterSummary?): SiteStarterPickNote? {
  if (pick == null) return null
  val name = pick.displayName.ifEmpty { "This starter" }
  return when {
    siteStarterPickBlock(pick) == SiteStarterPickBlock.PURCHASE ->
      SiteStarterPickNote("$name costs ${siteStarterPriceLabel(pick.priceUsd)}. Buy it on the web, then create your site from it.", "Buy on the web")
    pick.mode == SiteStarterMode.AI -> SiteStarterPickNote("An AI starter asks a few questions, on the web.", "Continue on the web")
    pick.priceUsd > 0 -> SiteStarterPickNote("You own this starter. Create your site from it whenever you are ready.", null)
    else -> null
  }
}

/** What Create site does with a create that refused the starter it was asked for (`SiteStarterPickRefused`). */
data class SiteStarterPickRefused(
  /** The pick stays: it can still be created from, once bought. */
  val keep: Boolean,
  /** It is the price that stands in the way. */
  val purchase: Boolean,
  /** The create's own words for why. */
  val message: String,
)

/**
 * `readSiteStarterPickRefusal`: the create's refusal of THIS pick, which names its listing, or null for a refusal about
 * anything else (the name, the address, the plan's site count). A 402 keeps the pick; anything else clears it.
 */
fun readSiteStarterPickRefusal(status: Int, payload: JsonElement?, listingId: String): SiteStarterPickRefused? {
  val body = payload as? JsonObject ?: return null
  if (listingId.isEmpty() || (body["listingId"] as? JsonPrimitive)?.contentOrNull != listingId) return null
  val message = (body["error"] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty().ifEmpty { "That starter cannot be used." }
  return SiteStarterPickRefused(keep = status == 402, purchase = status == 402, message = message)
}

private val LISTING_ID = Regex("^[A-Za-z0-9_-]{1,128}$")

/**
 * `siteCreateReturnQuery`: the query that reopens the console's Create site on a starter, in one order; null for an id no
 * listing can have, so a malformed one is never written into an address.
 */
fun siteCreateReturnQuery(listingId: String): List<Pair<String, String>>? {
  val id = listingId.trim()
  if (!LISTING_ID.matches(id)) return null
  return listOf("create" to "site", "starter" to id)
}

/**
 * The console's Sites page with Create site open on a starter: where a person buys one, or answers an AI starter's
 * questions, which the apps do not do themselves. Null without a workspace address.
 */
fun siteCreateWebUrl(origin: String, orgSlug: String?, listingId: String): String? {
  if (orgSlug.isNullOrEmpty()) return null
  val query = siteCreateReturnQuery(listingId) ?: return null
  return "${origin.trimEnd('/')}/$orgSlug/hosts?" + query.joinToString("&") { (name, value) -> "$name=$value" }
}
