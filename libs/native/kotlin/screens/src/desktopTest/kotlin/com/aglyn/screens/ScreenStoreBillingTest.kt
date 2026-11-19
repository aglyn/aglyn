package com.aglyn.screens

import com.aglyn.core.AglynAppId
import com.aglyn.core.AglynConfig
import com.aglyn.core.AglynEnv
import com.aglyn.core.StoreBilling
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import java.io.File

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

  /** Every control in Billing that takes or starts a payment to Aglyn holds `app.billing`, on itself or its block. */
  @Test
  fun everyBuyingControlInBillingNeedsTheBuild() {
    val root = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "libs/native/screens").isDirectory }
    val file = Json.parseToJsonElement(File(root, "libs/native/screens/billing.screens.json").readText()) as JsonObject
    val buying = mapOf(
      "core.billing" to listOf("portal", "card", "resume", "plans"),
      "core.billing.plans" to listOf("switch", "monthly", "yearly"),
      "core.billing.invoices" to listOf("pay"),
      "core.billing.settings" to listOf("default", "addCard"),
      "core.billing.addons" to listOf("set", "on", "blocks"),
      "core.billing.cancel.offers" to listOf("downsell"),
    )
    fun JsonElement?.text(key: String) = ((this as? JsonObject)?.get(key) as? JsonPrimitive)?.content.orEmpty()
    for (screen in (file["screens"] as JsonArray).map { it as JsonObject }) {
      val ids = buying[screen.text("id")] ?: continue
      val found = mutableSetOf<String>()
      for (block in (screen["blocks"] as JsonArray).map { it as JsonObject }) {
        val held = "app.billing" in block.text("when") && "!app.billing" !in block.text("when")
        for (key in listOf("items", "actions")) {
          for (action in (block[key] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }) {
            val id = action.text("id")
            if (id !in ids) continue
            val own = action.text("when")
            if (held || ("app.billing" in own && !own.startsWith("!app.billing"))) found += id
          }
        }
      }
      assertEquals(ids.toSet(), found, screen.text("id"))
    }
  }

  /** A store build's line is one block per screen at most. */
  @Test
  fun theStoreLineIsOncePerScreen() {
    val root = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "libs/native/screens").isDirectory }
    val file = Json.parseToJsonElement(File(root, "libs/native/screens/billing.screens.json").readText()) as JsonObject
    for (screen in (file["screens"] as JsonArray).map { it as JsonObject }) {
      val lines = (screen["blocks"] as JsonArray).count { ((it as JsonObject)["type"] as? JsonPrimitive)?.content == "billingOnWeb" }
      assertTrue(lines <= 1, ((screen["id"] as JsonPrimitive).content))
    }
  }
}
