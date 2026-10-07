package com.aglyn.plugins.commerce.pos

import com.aglyn.contracts.ModifierSelection
import com.aglyn.core.InMemoryKeyValueStore
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private val latte = CartPick("p-latte", "v-large", "Latte", "Large", unitCents = 450)
private val oat = listOf(ModifierSelection("milk", "oat"))

class CartTest {
  @Test
  fun growsOneLinePerItemAndChoicesAndTotalsInCents() {
    var cart = Cart.EMPTY.add(latte)
    cart = cart.add(latte, 2)
    cart = cart.add(latte.copy(modifiers = oat, unitCents = 525))
    assertEquals(2, cart.lines.size)
    assertEquals(3, cart.lines[0].quantity)
    assertEquals(4, cart.count)
    assertEquals(3L * 450 + 525, cart.subtotalCents)
  }

  @Test
  fun capsALineAtWhatTheServerRingsUpAndZeroRemovesIt() {
    var cart = Cart.EMPTY.add(latte, 500)
    assertEquals(POS_LINE_MAX_QUANTITY, cart.lines[0].quantity)
    cart = cart.setQuantity(cart.lines[0].key, 0)
    assertTrue(cart.lines.isEmpty())
    assertEquals(1, Cart.EMPTY.add(latte).remove("nope").lines.size)
  }

  @Test
  fun previewsTheDiscountAsTheServerTakesItLineByLine() {
    val cart = Cart.EMPTY.add(latte, 3).add(latte.copy(variantId = "v-small", unitCents = 333)).withDiscount(10.0)
    // Each line rounds on its own, halves up: 135 + 33.3 → 33.
    assertEquals(135L + 33L, cart.discountCents)
    assertEquals(100, cart.withDiscount(250.0).discountPct)
    assertEquals(0, cart.withDiscount(Double.NaN).discountPct)
    // JavaScript rounds a half up: 2.5% is 3%.
    assertEquals(3, cart.withDiscount(2.5).discountPct)
  }

  @Test
  fun refusesALineBeyondTheSalesCeiling() {
    var cart = Cart.EMPTY
    repeat(POS_CART_MAX_LINES + 5) { cart = cart.add(latte.copy(productId = "p$it")) }
    assertEquals(POS_CART_MAX_LINES, cart.lines.size)
  }

  @Test
  fun sendsPicksAndCountsNeverAPrice() {
    val cart = Cart.EMPTY.add(latte.copy(modifiers = oat)).add(latte.copy(variantId = null))
    val lines = cart.saleLines()
    assertEquals(
      """[{"productId":"p-latte","variantId":"v-large","modifiers":[{"groupId":"milk","optionId":"oat"}],"quantity":1},{"productId":"p-latte","quantity":1}]""",
      lines.toString(),
    )
    assertFalse(lines.toString().contains("Cents"))
  }

  @Test
  fun readsAStoredBasketBackDefensively() {
    val stored = Cart.EMPTY.add(latte.copy(modifiers = oat), 2).withDiscount(5.0)
    assertEquals(stored, readStoredCart(stored.encode()))
    assertEquals(Cart.EMPTY, readStoredCart(null))
    assertEquals(Cart.EMPTY, readStoredCart("not json"))
    assertEquals(Cart.EMPTY, readStoredCart("""{"lines":[{"name":"no id"},7],"discountPct":"x"}"""))
    // A hand-edited copy cannot smuggle a quantity past the ceiling.
    val edited = JsonObject(mapOf("lines" to Json.parseToJsonElement("""[{"productId":"p","quantity":500,"unitCents":100}]""")))
    assertEquals(POS_LINE_MAX_QUANTITY, readStoredCart(edited.toString()).lines.single().quantity)
    assertEquals("", readStoredCart(JsonObject(mapOf("customerEmail" to JsonPrimitive(3))).toString()).customerEmail)
  }
}

class RegisterStoreTest {
  @Test
  fun keepsTheBasketPerStoreAndRegister() {
    val store = RegisterStore(InMemoryKeyValueStore(), "h1")
    val cart = Cart.EMPTY.add(latte, 2)
    store.saveCart("front", cart)
    assertEquals(cart, store.cart("front"))
    assertEquals(Cart.EMPTY, store.cart("back"))
    assertEquals(Cart.EMPTY, RegisterStore(InMemoryKeyValueStore(), "h2").cart("front"))
    store.saveCart("front", Cart.EMPTY)
    assertEquals(Cart.EMPTY, store.cart("front"))
  }

  @Test
  fun resumesAPendingSaleForADayAndNoLonger() {
    val store = RegisterStore(InMemoryKeyValueStore(), "h1")
    store.savePendingSale("front", PendingSale("o1", 1234, openedAtMs = 1_000))
    assertEquals(PendingSale("o1", 1234, 1_000), store.pendingSale("front", 1_000 + 60_000))
    assertNull(store.pendingSale("front", 1_000 + PENDING_SALE_MAX_AGE_MS + 1))
    store.savePendingSale("front", null)
    assertNull(store.pendingSale("front", 2_000))
  }

  @Test
  fun holdsBasketsOldestFirstAndResumesThemOnce() {
    val store = RegisterStore(InMemoryKeyValueStore(), "h1")
    assertFalse(store.hold("front", Cart.EMPTY, "Empty", 1))
    assertTrue(store.hold("front", Cart.EMPTY.add(latte), "Table 4", 20, id = "b"))
    assertTrue(store.hold("front", Cart.EMPTY.add(latte, 3), holdLabel(Cart.EMPTY.add(latte, 3)), 10, id = "a"))
    assertEquals(listOf("a", "b"), store.holds("front").map { it.id })
    assertEquals("Latte", store.holds("front").first().label)
    assertEquals(3, store.resume("front", "a")?.count)
    assertNull(store.resume("front", "a"))
    store.discard("front", "b")
    assertTrue(store.holds("front").isEmpty())
  }

  @Test
  fun capsHowManyBasketsOneRegisterHolds() {
    val store = RegisterStore(InMemoryKeyValueStore(), "h1")
    repeat(POS_MAX_HELD_BASKETS) { assertTrue(store.hold("front", Cart.EMPTY.add(latte), "#$it", it.toLong(), id = "h$it")) }
    assertFalse(store.hold("front", Cart.EMPTY.add(latte), "one more", 99))
  }

  @Test
  fun namesAHeldBasketByItsFirstItem() {
    assertEquals("Latte + 2 more", holdLabel(Cart.EMPTY.add(latte).add(latte.copy(productId = "x", name = "Muffin"), 2)))
    assertEquals("Held basket", holdLabel(Cart.EMPTY))
  }
}
