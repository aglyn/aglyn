package com.aglyn.plugins.commerce.pos

import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.KeyValueStore
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/*
 * WHICH REGISTER THIS DEVICE IS, AND WHAT IT HOLDS.
 *
 * A sale runs through a named register: the plan's register seats are
 * counted by them and the takings attributed to one. The device remembers
 * its register per store, as the console register defaults to the first; a
 * register that pins a stock location sells from it.
 *
 * Kept on the device, per store and register, so a restart loses nothing:
 * - the basket being rung up;
 * - the sale in progress: an app closed between "Charge" and the receipt
 *   opens back on that sale rather than leaving a pending order behind;
 * - held baskets: a basket set aside (the customer stepped away, or the
 *   connection is down) and resumed later, oldest first.
 */

data class PosRegister(val id: String, val name: String, val locationId: String?)

/** The console register's own window (`pos-page`: registers, limit 25). */
const val POS_REGISTER_WINDOW = 25

fun posRegisterFrom(doc: FirestoreDoc) = PosRegister(
  id = doc.id,
  name = (doc.data["name"] as? String)?.trim()?.ifEmpty { null } ?: "Register",
  locationId = (doc.data["locationId"] as? String)?.ifEmpty { null },
)

fun sortRegisters(registers: List<PosRegister>) = registers.sortedWith(compareBy<PosRegister> { it.name.lowercase() }.thenBy { it.id })

fun registersQuery(hostId: String) = FirestoreQuery("hosts/$hostId/registers", limit = POS_REGISTER_WINDOW)

/** The sale this register has open, as remembered across a restart. */
@Serializable
data class PendingSale(val orderId: String, val totalCents: Long, val openedAtMs: Long)

/** A pending sale older than a day is the console's to clean up, not the till's to resume. */
const val PENDING_SALE_MAX_AGE_MS = 24L * 60 * 60 * 1000

/** A basket set aside, to resume later. */
@Serializable
data class HeldBasket(val id: String, val label: String, val cart: Cart, val heldAtMs: Long)

/** The most baskets one register holds at once. */
const val POS_MAX_HELD_BASKETS = 20

private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

/** A register's device state, under the plugin's own keys in the device store. */
class RegisterStore(private val store: KeyValueStore, private val hostId: String) {
  private fun registerKey() = "commerce.pos.register.$hostId"
  private fun cartKey(registerId: String) = "commerce.pos.cart.$hostId.$registerId"
  private fun saleKey(registerId: String) = "commerce.pos.sale.$hostId.$registerId"
  private fun holdsKey(registerId: String) = "commerce.pos.holds.$hostId.$registerId"

  var registerId: String?
    get() = store.get(registerKey())
    set(value) = store.set(registerKey(), value)

  fun cart(registerId: String): Cart = readStoredCart(store.get(cartKey(registerId)))

  fun saveCart(registerId: String, cart: Cart) = store.set(cartKey(registerId), if (cart.isEmpty && cart.discountPct == 0 && cart.customerEmail.isEmpty()) null else cart.encode())

  fun pendingSale(registerId: String, nowMs: Long): PendingSale? {
    val sale = runCatching { json.decodeFromString(PendingSale.serializer(), store.get(saleKey(registerId)) ?: return null) }.getOrNull()
    return sale?.takeIf { it.orderId.isNotEmpty() && nowMs - it.openedAtMs in 0..PENDING_SALE_MAX_AGE_MS }
  }

  fun savePendingSale(registerId: String, sale: PendingSale?) =
    store.set(saleKey(registerId), sale?.let { json.encodeToString(PendingSale.serializer(), it) })

  fun holds(registerId: String): List<HeldBasket> = runCatching {
    json.decodeFromString(ListSerializer(HeldBasket.serializer()), store.get(holdsKey(registerId)) ?: return emptyList())
  }.getOrDefault(emptyList())
    // Each held basket is re-read like a stored one, so it can only hold lines the till could build.
    .map { it.copy(cart = readStoredCart(it.cart.encode())) }
    .filter { !it.cart.isEmpty }
    .sortedBy { it.heldAtMs }

  private fun saveHolds(registerId: String, holds: List<HeldBasket>) =
    store.set(holdsKey(registerId), if (holds.isEmpty()) null else json.encodeToString(ListSerializer(HeldBasket.serializer()), holds))

  /** Sets [cart] aside. False when the basket is empty or the register already holds the most it may. */
  fun hold(registerId: String, cart: Cart, label: String, nowMs: Long, id: String = newAttemptKey("hold")): Boolean {
    val holds = holds(registerId)
    if (cart.isEmpty || holds.size >= POS_MAX_HELD_BASKETS) return false
    saveHolds(registerId, holds + HeldBasket(id, label.trim().take(60).ifEmpty { "Held basket" }, cart, nowMs))
    return true
  }

  /** Takes a held basket back out; null when it is gone. */
  fun resume(registerId: String, holdId: String): Cart? {
    val holds = holds(registerId)
    val held = holds.firstOrNull { it.id == holdId } ?: return null
    saveHolds(registerId, holds.filter { it.id != holdId })
    return held.cart
  }

  fun discard(registerId: String, holdId: String) = saveHolds(registerId, holds(registerId).filter { it.id != holdId })
}

/** A held basket's default name: its first item and how many more. */
fun holdLabel(cart: Cart): String {
  val first = cart.lines.firstOrNull()?.name ?: return "Held basket"
  val more = cart.count - (cart.lines.firstOrNull()?.quantity ?: 0)
  return if (more > 0) "$first + $more more" else first
}
