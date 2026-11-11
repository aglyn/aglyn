package com.aglyn.plugins.commerce.products

import com.aglyn.contracts.ProductCheckIn
import com.aglyn.contracts.checkInHeadcount
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.PlanFeatureDefaults
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/*
 * CHECK-IN AT THE WINDOW IN THE PRODUCT EDITOR (AGL-4063), as the console's
 * `ProductCheckInFields` (product-check-in-fields.component.tsx) has it:
 * whether each item sold is somebody to check in on the day it is for, how
 * many people one item admits, whether an online buyer picks the day, and,
 * on a product with options, each variant's own choice. Every change below
 * is the console's own: the same object written for the same press. The
 * Apple kit's ProductCheckIn.swift.
 */

/** The plan feature the console draws these fields behind (`useCommerceEntitlement(hostId, 'pos')`). */
const val PRODUCT_CHECK_IN_FEATURE = "pos"

/** The console's upsell where a plan leaves the point of sale out, in its words. */
fun productCheckInUpsell(): String {
  val base = "Register quick keys, check-in at the window and selling a product in person only come with the point of sale."
  return PlanFeatureDefaults.grantedFrom[PRODUCT_CHECK_IN_FEATURE]?.let { "$base Included from $it." } ?: base
}

/** A variant's own check-in, as the console's per-variant select offers it. */
enum class VariantCheckInChoice { PRODUCT, ON, OFF }

/** The product's setting with one part changed, keeping the others (the console's `productOn`). */
private fun productOn(current: ProductCheckIn?, headcount: Int? = null, askUseDate: Boolean? = null): ProductCheckIn {
  val asks = askUseDate ?: (current?.askUseDate == true)
  return ProductCheckIn(
    askUseDate = if (asks) true else null,
    enabled = true,
    headcount = (headcount ?: current?.headcount?.toInt() ?: 1).toDouble(),
  )
}

/** Whether the product needs check-in, as its switch reads it. */
fun productNeedsCheckIn(current: ProductCheckIn?): Boolean = current?.enabled == true

/** People per item, as the product's field shows it. */
fun productCheckInHeadcount(current: ProductCheckIn?): Int = current?.headcount?.toInt() ?: 1

/** "Needs check-in" switched: on keeps the people per item and the day question; off is only `enabled: false`. */
fun productCheckInSwitched(current: ProductCheckIn?, on: Boolean): ProductCheckIn =
  if (on) productOn(current) else ProductCheckIn(enabled = false)

/** People per item typed: a whole number from 1 to the ceiling; blank or not a number is 1. */
fun productCheckInHeadcountTyped(current: ProductCheckIn?, text: String): ProductCheckIn = productOn(current, headcount = checkInHeadcount(text))

/** "Ask the buyer which day" switched. */
fun productCheckInAskUseDateSwitched(current: ProductCheckIn?, on: Boolean): ProductCheckIn = productOn(current, askUseDate = on)

/** The words under People per item. */
fun productCheckInHeadcountHelp(current: ProductCheckIn?): String {
  val people = productCheckInHeadcount(current)
  return if (people > 1) "Buying 3 makes ${3 * people} check-ins" else "Buying 3 makes 3 check-ins"
}

/** The words under "Ask the buyer which day". */
fun productCheckInUseDayHelp(current: ProductCheckIn?): String =
  if (current?.askUseDate == true) {
    "Buyers online can pick the day they will use it, from today on. If they skip it, it is for the day they buy."
  } else {
    "It is for the day it is bought. Turn this on to sell passes ahead for a day the buyer picks."
  }

/** The words under the "Needs check-in" switch. */
const val PRODUCT_CHECK_IN_HELP =
  "Each one sold, online or at the register, is somebody to check in at the window on the day it is for, " +
    "with an optional wristband number or color."

/** What a variant's select shows: the product's setting, its own on, or its own off. */
fun variantCheckInChoice(own: ProductCheckIn?): VariantCheckInChoice = when {
  own == null -> VariantCheckInChoice.PRODUCT
  own.enabled -> VariantCheckInChoice.ON
  else -> VariantCheckInChoice.OFF
}

/** The words for a variant's choice; the first names what the product's setting is. */
fun variantCheckInChoiceLabel(choice: VariantCheckInChoice, productNeedsCheckIn: Boolean): String = when (choice) {
  VariantCheckInChoice.PRODUCT -> if (productNeedsCheckIn) "Same as the product (needs check-in)" else "Same as the product (no check-in)"
  VariantCheckInChoice.ON -> "Needs check-in"
  VariantCheckInChoice.OFF -> "No check-in"
}

/**
 * A variant's own setting after a pick: null follows the product; on starts from its own people per item, else the
 * product's, and asks the day when the product does.
 */
fun variantCheckInPicked(choice: VariantCheckInChoice, own: ProductCheckIn?, product: ProductCheckIn?): ProductCheckIn? = when (choice) {
  VariantCheckInChoice.PRODUCT -> null
  VariantCheckInChoice.OFF -> ProductCheckIn(enabled = false)
  VariantCheckInChoice.ON -> ProductCheckIn(
    askUseDate = if (product?.askUseDate == true) true else null,
    enabled = true,
    headcount = (own?.headcount?.toInt() ?: productCheckInHeadcount(product)).toDouble(),
  )
}

/** People per item, as a variant's own field shows it. */
fun variantCheckInHeadcount(own: ProductCheckIn?): Int = own?.headcount?.toInt() ?: 1

/** A variant's people per item typed, keeping its own day question. */
fun variantCheckInHeadcountTyped(own: ProductCheckIn?, text: String): ProductCheckIn =
  ProductCheckIn(askUseDate = if (own?.askUseDate == true) true else null, enabled = true, headcount = checkInHeadcount(text).toDouble())

/** A variant's "Ask which day" switched, keeping its own people per item. */
fun variantCheckInAskUseDateSwitched(own: ProductCheckIn?, on: Boolean): ProductCheckIn =
  ProductCheckIn(askUseDate = if (on) true else null, enabled = true, headcount = variantCheckInHeadcount(own).toDouble())

/** The setting as a save writes it: `{enabled: false}`, or on with its people per item and, when asked, the day. */
fun productCheckInJson(value: ProductCheckIn): JsonObject = JsonObject(
  buildMap {
    put("enabled", JsonPrimitive(value.enabled))
    value.headcount?.let { put("headcount", JsonPrimitive(it.toLong())) }
    if (value.askUseDate == true) put("askUseDate", JsonPrimitive(true))
  },
)

/**
 * Whether the workspace's plan carries the point of sale, as the console answers it for the site; null when it could not
 * be asked (the fields stay hidden, as the console's do while its plan read is in flight).
 */
suspend fun productCheckInCarried(api: ConsoleApiClient, hostId: String): Boolean? =
  try {
    val body: JsonElement? = api.request("/api/orgs/entitlements", query = mapOf("hostId" to hostId))
    ((body as? JsonObject)?.get("features") as? JsonObject)?.let { features ->
      (features[PRODUCT_CHECK_IN_FEATURE] as? JsonPrimitive)?.booleanOrNull == true
    }
  } catch (failure: Throwable) {
    if (failure is CancellationException) throw failure
    null
  }
