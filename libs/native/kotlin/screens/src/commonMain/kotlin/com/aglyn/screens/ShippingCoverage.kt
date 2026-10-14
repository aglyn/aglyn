package com.aglyn.screens

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * What a store's saved shipping zones and rates cover, as the console's Shipping card says it (`summarizeShippingCoverage`
 * in `commerce-shipping.ts`): which of the six destinations checkout collects an address for are reached by at least one
 * rate, which it turns away, and whether the shopper is asked where the parcel is going. A port of the console's resolver
 * (zones, the four priced rate kinds, local pickup, the five-option cap) replayed from `function-cases.generated.json`, so a
 * change to the TypeScript fails there until this follows.
 */
internal object ShippingCoverage {
  /** The destinations a storefront session collects an address for, in the order the console lists them. */
  val countries = listOf("US", "CA", "GB", "AU", "DE", "FR")

  /** Shopper-facing names for those destinations. */
  val names = mapOf(
    "US" to "United States", "CA" to "Canada", "GB" to "United Kingdom", "AU" to "Australia", "DE" to "Germany", "FR" to "France",
  )

  /** Stripe shows a session at most this many shipping options. */
  const val MAX_OPTIONS = 5

  const val PICKUP_ID = "pickup"

  data class Option(val rateId: String, val name: String, val amountCents: Double)

  data class Cart(val subtotalCents: Double, val totalGrams: Double)

  /**
   * A cart picked so every rate a merchant could write resolves if it can at all: a zero subtotal and weight clear every
   * tier, and a free-over rate resolves at any subtotal. The answer is a lower bound on the gaps, never a false warning.
   */
  private val probe = Cart(0.0, 0.0)

  /** `Math.round`: halves go up. */
  private fun jsRound(value: Double): Double = kotlin.math.floor(value + 0.5)

  private fun field(element: JsonElement?, key: String): JsonElement? = (element as? JsonObject)?.get(key)?.takeIf { it !is JsonNull }

  private fun list(element: JsonElement?): List<JsonElement> = (element as? JsonArray)?.toList().orEmpty()

  private fun text(element: JsonElement?): String? = (element as? JsonPrimitive)?.takeIf { it.isString }?.content

  private fun zoneCode(element: JsonElement?): String = when (element) {
    is JsonPrimitive -> if (element is JsonNull) "" else element.content.trim().uppercase()
    else -> ""
  }

  private fun codes(zone: JsonElement): List<JsonElement> = list(field(zone, "countries"))

  /** The zones that cover a destination: those that name it, and only when none does, those that claim everywhere (`*`). */
  private fun matchedZoneIds(zones: List<JsonElement>, country: String): Set<String> {
    val want = country.uppercase()
    val specific = zones.filter { zone -> codes(zone).any { zoneCode(it) == want } }
    val matched = specific.ifEmpty { zones.filter { zone -> codes(zone).any { zoneCode(it) == "*" || zoneCode(it) == want } } }
    return matched.map { text(field(it, "id")).orEmpty() }.toSet()
  }

  /** The first tier whose `upTo` reaches the value, tiers taken smallest first. */
  private fun tierAmount(tiers: List<JsonElement>, value: Double): Double? {
    val sorted = tiers.withIndex().sortedWith(
      compareBy<IndexedValue<JsonElement>>({ ScreenValues.number(field(it.value, "upTo")) ?: 0.0 }, { it.index }),
    )
    for ((_, tier) in sorted) {
      // A tier with no limit reaches nothing, as a comparison against nothing is false in the console.
      val limit = ScreenValues.number(field(tier, "upTo")) ?: continue
      if (value <= limit) return ScreenValues.number(field(tier, "amountCents"))
    }
    return null
  }

  /** Every rate that prices this cart to this destination, with local pickup when it is on, cheapest first. */
  private fun resolveRates(settings: JsonElement, country: String, cart: Cart): List<Option> {
    val zoneIds = matchedZoneIds(list(field(settings, "zones")), country)
    val resolved = mutableListOf<Option>()
    for (rate in list(field(settings, "rates"))) {
      if (text(field(rate, "zoneId")).orEmpty() !in zoneIds) continue
      val amount = maxOf(0.0, jsRound(ScreenValues.number(field(rate, "amountCents")) ?: 0.0))
      val cents: Double? = when (text(field(rate, "kind"))) {
        "flat" -> amount
        "free_over" -> {
          val over = ScreenValues.number(field(rate, "freeOverCents"))
          if (over != null && cart.subtotalCents >= over) 0.0 else amount
        }
        "price_tiers" -> tierAmount(list(field(rate, "tiers")), cart.subtotalCents)
        "weight_tiers" -> tierAmount(list(field(rate, "tiers")), cart.totalGrams)
        else -> null
      }
      if (cents == null) continue
      resolved += Option(text(field(rate, "id")).orEmpty(), text(field(rate, "name")).orEmpty(), cents)
    }
    if (ScreenValues.truthy(field(settings, "localPickup"))) resolved += Option(PICKUP_ID, "Local pickup", 0.0)
    return resolved.withIndex().sortedWith(compareBy<IndexedValue<Option>>({ it.value.amountCents }, { it.index })).map { it.value }
  }

  /** What `String#localeCompare` does for plain ids: letters without regard to case first, a lowercase letter before its capital. */
  private val idOrder = Comparator<String> { a, b ->
    val byLetters = a.lowercase().compareTo(b.lowercase())
    if (byLetters != 0) byLetters else b.compareTo(a)
  }

  /**
   * The options a session offers for these destinations: a rate with no id or name is dropped (Stripe would reject it), a
   * rate that resolves differently for two destinations keeps the dearer price, cheapest first, at most five.
   */
  fun checkoutOptions(settings: JsonElement?, destinations: List<String>, cart: Cart = probe): List<Option> {
    if (settings == null || settings is JsonNull) return emptyList()
    val byId = LinkedHashMap<String, Option>()
    for (country in destinations) {
      for (rate in resolveRates(settings, country, cart)) {
        if (rate.rateId.isEmpty() || rate.name.isEmpty()) continue
        val cents = maxOf(0.0, jsRound(rate.amountCents))
        val existing = byId[rate.rateId]
        if (existing != null && cents <= existing.amountCents) continue
        byId[rate.rateId] = Option(rate.rateId, rate.name, cents)
      }
    }
    return byId.values.sortedWith(compareBy<Option> { it.amountCents }.thenComparator { a, b -> idOrder.compare(a.rateId, b.rateId) })
      .take(MAX_OPTIONS)
  }

  private fun key(options: List<Option>): String = options.joinToString("|") { "${it.rateId}:${ScreenValues.numberText(it.amountCents)}" }

  /** What a store's settings reach (`summarizeShippingCoverage`). */
  data class Coverage(
    val served: List<String>,
    val unserved: List<String>,
    val shipsNowhere: Boolean,
    val asksDestination: Boolean,
    val offersLocalPickup: Boolean,
    val hasRestOfWorldZone: Boolean,
  )

  fun summarize(settings: JsonElement?): Coverage {
    val served = mutableListOf<String>()
    val unserved = mutableListOf<String>()
    val offers = mutableSetOf<String>()
    for (country in countries) {
      val options = checkoutOptions(settings, listOf(country))
      offers += key(options)
      // Asked of the shippable list: local pickup is a collection choice, not a rate, so it never counts as coverage.
      if (options.any { it.rateId != PICKUP_ID }) served += country else unserved += country
    }
    val zones = list(field(settings, "zones"))
    return Coverage(
      served = served,
      unserved = if (served.isEmpty()) emptyList() else unserved,
      shipsNowhere = served.isEmpty(),
      asksDestination = offers.size > 1,
      offersLocalPickup = ScreenValues.truthy(field(settings, "localPickup")),
      hasRestOfWorldZone = zones.any { zone -> codes(zone).any { text(it) == "*" } },
    )
  }

  private fun named(codes: List<String>) = codes.joinToString(", ") { names[it] ?: it }

  data class Words(val headline: String, val detail: String, val note: String, val asks: String)

  /** The console's own sentences (`describeShippingCoverage`), so a store reads the same on every surface. */
  fun words(coverage: Coverage): Words {
    val asks = if (coverage.asksDestination) "Rates differ by destination, so checkout asks the shopper where the parcel is going before it can price one." else ""
    if (coverage.unserved.isNotEmpty()) {
      return Words(
        headline = "Checkout turns away ${coverage.unserved.size} of the ${countries.size} destinations it collects addresses for",
        detail = "No rate reaches ${named(coverage.unserved)}, so an order shipping there is refused rather than posted for free. " +
          (if (coverage.offersLocalPickup) "Local pickup does not cover them: it is a collection choice, not a rate, so it is offered where checkout completes and closes no gap here. " else "") +
          (
            if (coverage.hasRestOfWorldZone) "A rest-of-world zone is already saved, so what those destinations are missing is a rate on the zone that covers them."
            else "Give them a zone with a rate, or add a rest-of-world zone and price one on it."
          ),
        note = "",
        asks = asks,
      )
    }
    val note = when {
      coverage.shipsNowhere && coverage.offersLocalPickup ->
        "No rate reaches any destination, so local pickup is the only delivery choice checkout offers. Nobody is turned away and no shipping is charged."
      coverage.shipsNowhere -> "No rate reaches any destination, so checkout charges no shipping and turns nobody away."
      else -> "Checkout can price shipping to every destination it collects an address for: ${named(coverage.served)}."
    }
    return Words("", "", note, asks)
  }

  /** The summary the Shipping card reads, as the object a screen's `derive` load answers with. */
  fun summary(settings: JsonElement?): JsonElement {
    val coverage = summarize(settings)
    val said = words(coverage)
    return buildJsonObject {
      put("headline", said.headline)
      put("detail", said.detail)
      put("note", said.note)
      put("asks", said.asks)
      put("served", buildJsonArray { coverage.served.forEach { add(JsonPrimitive(it)) } })
      put("unserved", buildJsonArray { coverage.unserved.forEach { add(JsonPrimitive(it)) } })
      put("servedNames", named(coverage.served))
      put("unservedNames", named(coverage.unserved))
      put("unservedCount", coverage.unserved.size)
      put("countryCount", countries.size)
      put("shipsNowhere", coverage.shipsNowhere)
      put("asksDestination", coverage.asksDestination)
      put("offersLocalPickup", coverage.offersLocalPickup)
      put("hasRestOfWorldZone", coverage.hasRestOfWorldZone)
    }
  }
}
