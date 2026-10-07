package com.aglyn.plugins.commerce.pos

import com.aglyn.contracts.ModifierSelection
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put

/*
 * THE REGISTER'S BASKET.
 *
 * What the cashier has rung up, before it is a sale. Pure and immutable, so
 * the screens, the copy persisted on the device (it survives a restart) and
 * the specs all read the same arithmetic.
 *
 * The figures are a PREVIEW. The server prices the sale when it opens
 * (`commerce/pos-order`, `payment: 'open'`): it re-reads every product,
 * prices each modifier from the product, applies the discount ceiling and
 * the store's tax, and the total it answers is the one the customer pays. The
 * basket sends only what was picked, never a price.
 */

/** The most of one line the server rings up (`pos-order` clamps to 1..99). */
const val POS_LINE_MAX_QUANTITY = 99

/** The most lines one sale carries, so a stuck key cannot build a basket the route refuses. */
const val POS_CART_MAX_LINES = 100

@Serializable
data class CartLine(
  /** Product, variant and modifier choices: the same item with the same choices is one line. */
  val key: String,
  val productId: String,
  /** Null for a product's only (default) variant. */
  val variantId: String?,
  val name: String,
  /** "Large / Oat milk, Extra shot"; null for neither. */
  val variantLabel: String?,
  val modifiers: List<ModifierSelection>,
  /** One unit as the grid priced it, modifiers included: the preview only. */
  val unitCents: Long,
  val quantity: Int,
)

@Serializable
data class Cart(
  val lines: List<CartLine> = emptyList(),
  /** A whole-sale discount, in percent. */
  val discountPct: Int = 0,
  /** Who the receipt goes to, when the cashier asked. */
  val customerEmail: String = "",
) {
  val count: Int get() = lines.sumOf { it.quantity }
  val subtotalCents: Long get() = lines.sumOf { it.unitCents * it.quantity }

  /** The discount as the server takes it off each line, summed: a preview. */
  val discountCents: Long
    get() = if (discountPct <= 0) 0 else lines.sumOf { jsRound(it.unitCents * it.quantity * discountPct / 100.0) }

  val isEmpty: Boolean get() = lines.isEmpty()

  companion object {
    val EMPTY = Cart()
  }
}

/** What one tap or one item sheet puts in the basket. */
data class CartPick(
  val productId: String,
  val variantId: String?,
  val name: String,
  val variantLabel: String?,
  val modifiers: List<ModifierSelection> = emptyList(),
  val unitCents: Long,
)

fun cartLineKey(productId: String, variantId: String?, modifiers: List<ModifierSelection> = emptyList()) =
  "$productId:${variantId ?: ""}:${modifierSelectionKey(modifiers)}"

private fun clampQuantity(quantity: Int) = quantity.coerceIn(0, POS_LINE_MAX_QUANTITY)

/** Adds [quantity] of a pick: the same item with the same choices grows its line. */
fun Cart.add(pick: CartPick, quantity: Int = 1): Cart {
  val modifiers = pick.modifiers.map { ModifierSelection(it.groupId, it.optionId) }
  val key = cartLineKey(pick.productId, pick.variantId, modifiers)
  lines.firstOrNull { it.key == key }?.let { return setQuantity(key, it.quantity + quantity) }
  if (lines.size >= POS_CART_MAX_LINES) return this
  val added = clampQuantity(quantity)
  if (added == 0) return this
  return copy(
    lines = lines + CartLine(
      key = key,
      productId = pick.productId,
      variantId = pick.variantId,
      name = pick.name,
      variantLabel = pick.variantLabel,
      modifiers = modifiers,
      unitCents = maxOf(0, pick.unitCents),
      quantity = added,
    ),
  )
}

/** Sets a line's quantity; zero removes it. */
fun Cart.setQuantity(key: String, quantity: Int): Cart {
  val next = clampQuantity(quantity)
  return copy(
    lines = if (next > 0) lines.map { if (it.key == key) it.copy(quantity = next) else it } else lines.filter { it.key != key },
  )
}

fun Cart.remove(key: String): Cart = setQuantity(key, 0)

fun Cart.withDiscount(pct: Double): Cart =
  copy(discountPct = if (pct.isFinite()) jsRound(pct).coerceIn(0, 100).toInt() else 0)

fun Cart.withCustomerEmail(email: String): Cart = copy(customerEmail = email.trim().take(200))

/** What `commerce/pos-order` takes for `lines`: picks and counts, never prices. */
fun Cart.saleLines(): JsonArray = buildJsonArray {
  for (line in lines) {
    add(
      buildJsonObject {
        put("productId", line.productId)
        line.variantId?.let { put("variantId", it) }
        if (line.modifiers.isNotEmpty()) {
          put(
            "modifiers",
            buildJsonArray {
              for (modifier in line.modifiers) add(buildJsonObject { put("groupId", modifier.groupId); put("optionId", modifier.optionId) })
            },
          )
        }
        put("quantity", line.quantity)
      },
    )
  }
}

private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

fun Cart.encode(): String = json.encodeToString(Cart.serializer(), this)

private fun JsonElement?.text(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
private fun JsonElement?.number(): Double? = (this as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
    ?: (this as? JsonPrimitive)?.contentOrNull?.toDoubleOrNull()

/**
 * A persisted basket read back defensively: every line goes through [add]
 * again, so a hand-edited or older copy can never hold a line the till could
 * not have built. Anything unreadable is an empty basket.
 */
fun readStoredCart(raw: String?): Cart {
  val record = runCatching { Json.parseToJsonElement(raw ?: "") }.getOrNull() as? JsonObject ?: return Cart.EMPTY
  var cart = Cart.EMPTY
  for (entry in (record["lines"] as? JsonArray ?: JsonArray(emptyList())).take(POS_CART_MAX_LINES)) {
    val line = entry as? JsonObject ?: continue
    val productId = line["productId"].text()?.ifEmpty { null } ?: continue
    val modifiers = (line["modifiers"] as? JsonArray ?: JsonArray(emptyList())).mapNotNull { item ->
      val modifier = item as? JsonObject ?: return@mapNotNull null
      val groupId = modifier["groupId"].text() ?: return@mapNotNull null
      val optionId = modifier["optionId"].text() ?: return@mapNotNull null
      ModifierSelection(groupId, optionId)
    }
    cart = cart.add(
      CartPick(
        productId = productId,
        variantId = line["variantId"].text()?.ifEmpty { null },
        name = line["name"].text() ?: "Item",
        variantLabel = line["variantLabel"].text(),
        modifiers = modifiers,
        unitCents = line["unitCents"].number()?.let(::jsRound) ?: 0,
      ),
      line["quantity"].number()?.let { jsRound(it).coerceIn(0, POS_LINE_MAX_QUANTITY.toLong()).toInt() } ?: 0,
    )
  }
  cart = cart.withDiscount(record["discountPct"].number() ?: 0.0)
  return cart.withCustomerEmail(record["customerEmail"].text() ?: "")
}
