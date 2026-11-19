package com.aglyn.screens

import com.aglyn.core.AglynAppId
import com.aglyn.core.AglynConfig
import com.aglyn.core.AglynEnv
import com.aglyn.core.StoreBilling
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * `app.billing` and `app.billingLink`: what a spec screen hides in a store build (the owner's decision of 2026-11-19).
 * Apple replays the same (ScreenStoreBillingTests).
 */
class ScreenStoreBillingTest {
  private fun build(inAppBilling: String) =
    StoreBilling.configure(AglynConfig.read(AglynEnv(consoleUrl = "https://app.example.com", inAppBilling = inAppBilling), AglynAppId.AGLYN))

  @AfterTest
  fun reset() = build("off")

  private fun app(context: JsonElement) = (context as JsonObject)["app"] as JsonObject

  private fun flag(context: JsonElement, key: String) = (app(context)[key] as JsonPrimitive).booleanOrNull

  @Test
  fun theContextCarriesTheBuildsAnswers() {
    build("on")
    val context = ScreenSession().context(null, emptyMap())
    assertEquals(true, flag(context, "billing"))
    assertEquals(false, flag(context, "billingLink"))
    build("off")
    assertEquals(false, flag(ScreenSession().context(null, emptyMap()), "billing"))
  }

  @Test
  fun aBuyingConditionHoldsOnlyWhereTheBuildMayBuy() {
    val condition = "app.billing && org.can[billing.manage]"
    build("off")
    assertFalse(ScreenValues.condition(condition, ScreenSession(orgPermissions = mapOf("billing.manage" to true)).context(null, emptyMap())))
    build("on")
    assertTrue(ScreenValues.condition(condition, ScreenSession(orgPermissions = mapOf("billing.manage" to true)).context(null, emptyMap())))
  }

  /** Billing's Outstanding card: Pay now and View (Stripe's invoice page, which takes a payment) are absent in a store build. */
  @Test
  fun payNowAndTheInvoicePageAreAbsentWhereTheBuildMayNotBuy() {
    val root = generateSequence(java.io.File("").absoluteFile) { it.parentFile }.first { java.io.File(it, "libs/native/screens").isDirectory }
    val spec = ScreenSpec.parseFile(java.io.File(root, "libs/native/screens/billing.screens.json").readText()).first { it.id == "core.billing" }
    val list = spec.blocks.first { it.type == "list" && it.raw.str("title") == "Outstanding" }
    val actions = list.raw.arr("actions").mapNotNull { ActionSpec.parse(it) }
    fun shown(): List<String?> {
      val context = ScreenContext.withItem(
        ScreenSession(orgPermissions = mapOf("billing.manage" to true)).context(null, emptyMap()),
        kotlinx.serialization.json.Json.parseToJsonElement("""{"id":"in_1","hostedInvoiceUrl":"https://invoice.test/i"}"""),
      )
      return actions.filter { ScreenValues.condition(it.whenCondition, context) }.map { it.id }
    }
    build("off")
    assertEquals(emptyList(), shown())
    build("on")
    assertEquals(listOf("payNow", "view"), shown())
  }
}
