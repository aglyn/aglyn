package com.aglyn.screens

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put
import java.io.File
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.round
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The "Past your plan" screen over the console's own answers: each case in `billing-estimate-cases.generated.json`
 * is a month of usage, the quotas the entitlements route answers, and what `estimateMonthlyUsageCost` and the overage
 * helpers say it costs. The screen's arithmetic must agree to the cent. Apple replays the same cases.
 */
class ScreenBillingOverageTest {
  private val root: File = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "libs/native/screens").isDirectory }

  private fun json(text: String): JsonElement = Json.parseToJsonElement(text)

  private fun cases(): JsonObject = json(File(root, "libs/native/contracts/billing-estimate-cases.generated.json").readText()) as JsonObject

  private val spec: ScreenSpec
    get() = ScreenSpec.parseFile(File(root, "libs/native/screens/billing-overage.screens.json").readText()).first()

  private fun seeded(data: JsonElement, month: String): ScreenModel {
    val model = ScreenModel(spec, json("""{"org":{"id":"o1"},"now":{"month":"$month"}}"""), null)
    model.seed(data)
    return model
  }

  private fun dollars(value: Double): String =
    NumberFormat.getCurrencyInstance(Locale.US).apply { minimumFractionDigits = 2; maximumFractionDigits = 2 }.format(round(value * 100) / 100)

  private fun charge(value: Double): String = if (value > 0 && value < 0.005) "<\$0.01" else dollars(value)

  private fun count(value: Double): String = NumberFormat.getIntegerInstance(Locale.US).format(value.toLong())

  private fun JsonElement.num(key: String): Double? = ((this as? JsonObject)?.get(key) as? JsonPrimitive)?.doubleOrNull

  private fun JsonElement.at(key: String): JsonElement = (this as JsonObject).getValue(key)

  private fun estimateData(case: JsonElement): JsonElement {
    val month = (case.at("month") as JsonPrimitive).content
    val sites = case.at("sites") as JsonArray
    return buildJsonObject {
      put("ent", buildJsonObject { put("plan", case.at("plan")); put("quotas", case.at("quotas")) })
      put("org", json("""{"subscription":{"status":"active"}}"""))
      put("collab", buildJsonObject { put("sites", JsonArray(sites.indices.map { json("""{"hostId":"h$it"}""") })) })
      put("siteTraffic", JsonArray(sites.map { buildJsonObject { put("monthPageViews", it.at("pageViews")) } }))
      put("usage", json("""{"monthPageViews":0}"""))
      put("hostMedia", JsonArray(sites.map { buildJsonObject { put("bytes", it.at("storageBytes")) } }))
      put("hostForms", JsonArray(sites.map { buildJsonObject { put(month, it.at("forms")) } }))
      put("orgMedia", buildJsonObject { put("bytes", case.at("orgLibraryBytes")) })
      put("config", buildJsonObject { put("orgLibraryBilledFrom", if (case.at("libraryBilled") == JsonPrimitive(true)) JsonPrimitive("2026-01") else JsonNull) })
    }
  }

  @Test
  fun theEstimateAgreesWithTheConsolesToTheCentForEveryPlanAndUsage() {
    val estimates = cases().getValue("estimates") as JsonArray
    assertTrue(estimates.size > 20)
    for (case in estimates) {
      val name = (case.at("name") as JsonPrimitive).content
      val expect = case.at("expect")
      val model = seeded(estimateData(case), (case.at("month") as JsonPrimitive).content)
      val context = model.context
      val billed = expect.at("billed") == JsonPrimitive(true)
      assertEquals(JsonPrimitive(billed), ScreenValues.lookup("is.billed", context), name)
      val estimate = model.spec.blocks.filter { it.title?.startsWith("Estimated charges") == true && ScreenValues.condition(it.whenCondition, context) }
      if (!billed) {
        assertTrue(estimate.isEmpty(), name)
        assertTrue(model.spec.blocks.any { it.type == "notice" && ScreenValues.condition(it.whenCondition, context) }, name)
        continue
      }
      // Exactly one spelling of the estimate: with the organization library's storage, or without it.
      assertEquals(1, estimate.size, name)
      val rows = estimate[0].raw.arr("rows")
      fun value(label: String) = ScreenValues.render(rows.first { it.str("label") == label }.str("value").orEmpty(), context)
      assertEquals(dollars((expect.num("billedCents") ?: 0.0) / 100), value("Estimated"), name)
      assertTrue(value("Storage past the allowance").endsWith(charge(expect.num("storageUsd") ?: 0.0)), "$name: ${value("Storage past the allowance")}")
      assertTrue(value("Page views past the allowance").endsWith(charge(expect.num("pageViewsUsd") ?: 0.0)), "$name: ${value("Page views past the allowance")}")
      assertTrue(value("Form submissions past the allowance").endsWith(charge(expect.num("formsUsd") ?: 0.0)), "$name: ${value("Form submissions past the allowance")}")
    }
  }

  @Test
  fun theOverageCaptionsSayWhatTheConsoleSaysAndOnlyWherethePlanCanBeCharged() {
    for (case in cases().getValue("captions") as JsonArray) {
      val name = (case.at("name") as JsonPrimitive).content
      val expect = case.at("expect")
      val parts = case.at("records").at("parts")
      val data = buildJsonObject {
        put("ent", buildJsonObject { put("plan", case.at("plan")); put("quotas", case.at("quotas")) })
        put("org", json("""{"subscription":{"status":"active"}}"""))
        put("contacts", buildJsonObject { put("count", parts.at("contacts")) })
        put("companies", buildJsonObject { put("count", parts.at("companies")) })
        put("deals", buildJsonObject { put("count", parts.at("deals")) })
        put("api", buildJsonObject { put("count", case.at("apiRequests")) })
        put("emails", buildJsonObject { put("2026-10", case.at("emails")) })
      }
      val model = seeded(data, "2026-10")
      val context = model.context
      val shown = model.spec.blocks
        .filter { it.type == "notice" && it.raw.str("tone") == "warning" && ScreenValues.condition(it.whenCondition, context) }
        .map { ScreenValues.render(it.raw.str("text").orEmpty(), context) }
      val expected = mutableListOf<String>()
      val recordsRate = expect.num("recordsRate")
      val recordsOver = expect.num("recordsOverage") ?: 0.0
      if (recordsRate != null && recordsOver > 0) {
        expected += "Records overage: ${count(recordsOver)} over the included band at \$${ScreenValues.text(JsonPrimitive(recordsRate))}/1,000 — ≈${dollars(expect.num("recordsUsd") ?: 0.0)} if your CRM ends the month at this size."
      }
      val apiRate = expect.num("apiRate")
      val apiOver = expect.num("apiOverage") ?: 0.0
      if (apiRate != null && apiOver > 0) {
        expected += "API overage: ${count(apiOver)} requests over the included band at ${dollars(apiRate)}/1,000 — ≈${dollars(expect.num("apiUsd") ?: 0.0)} on this month's invoice."
      }
      val emailRate = expect.num("emailRate")
      val emailOver = expect.num("emailOverage") ?: 0.0
      val included = case.at("quotas").num("emailSendsPerMonth") ?: 0.0
      if (emailRate != null && emailOver > 0 && included > 0) {
        expected += "${count(emailOver)} emails over your included ${count(included)} this month at ${dollars(emailRate)}/1,000 — ≈${dollars(expect.num("emailUsd") ?: 0.0)} on this month's invoice. Transactional mail — receipts, invites, password resets — is never refused at the cap, so it is what takes an organization past the band."
      }
      assertEquals(expected, shown, name)
    }
  }

  @Test
  fun aStaffCompBillsNothingAndSoQuotesNothing() {
    val base = """"ent":{"plan":"business","quotas":{"contactsPerHost":10,"apiRequestsPerMonth":10,"emailSendsPerMonth":10,"hostLimit":1}},
      "contacts":{"count":100},"companies":{"count":0},"deals":{"count":0},"api":{"count":100},"emails":{"2026-10":100},"collab":{"sites":[]},"siteTraffic":[]"""
    fun warnings(org: String, sites: String = "[]"): Int {
      val model = seeded(json("""{$base,"org":$org}""".replace(""""collab":{"sites":[]}""", """"collab":{"sites":$sites}""")), "2026-10")
      return model.spec.blocks.count { it.type == "notice" && it.raw.str("tone") == "warning" && ScreenValues.condition(it.whenCondition, model.context) }
    }
    assertEquals(3, warnings("""{"subscription":{"status":"active"}}"""))
    // A comp grants the plan with nothing for sale; a live subscription wins over it.
    assertEquals(0, warnings("""{"entitlements":{"planComp":{"plan":"business"}}}"""))
    assertEquals(0, warnings("""{"entitlements":{"planComp":{"plan":"business"}},"subscription":{"status":"canceled"}}"""))
    assertEquals(3, warnings("""{"entitlements":{"planComp":{"plan":"business"}},"subscription":{"status":"active"}}"""))
    // The metered estimate follows the same rule.
    val comped = seeded(json("""{$base,"org":{"entitlements":{"planComp":{"plan":"business"}}}}""".replace(""""collab":{"sites":[]}""", """"collab":{"sites":[{"hostId":"h0"}]}""")), "2026-10")
    assertEquals(JsonPrimitive(true), ScreenValues.lookup("is.comp", comped.context))
    assertEquals(JsonPrimitive(false), ScreenValues.lookup("is.billed", comped.context))
  }

  @Test
  fun theOrganizationLibraryIsBilledFromTheMonthTheConsolesSwitchNames() {
    fun libraryBilled(from: String?, month: String = "2026-10"): JsonElement? {
      val config = if (from == null) "" else ""","config":{"orgLibraryBilledFrom":$from}"""
      return ScreenValues.lookup("is.libraryBilled", seeded(json("""{"ent":{"plan":"pro","quotas":{}}$config}"""), month).context)
    }
    assertEquals(JsonPrimitive(true), libraryBilled("\"2026-10\""))
    assertEquals(JsonPrimitive(true), libraryBilled("\"2026-09\""))
    assertEquals(JsonPrimitive(false), libraryBilled("\"2026-11\""))
    // Anything that is not a month bills nothing; a route that did not answer includes the library (fails high).
    assertEquals(JsonPrimitive(false), libraryBilled("null"))
    assertEquals(JsonPrimitive(false), libraryBilled("\"true\""))
    assertEquals(JsonPrimitive(false), libraryBilled("\"1\""))
    assertEquals(JsonPrimitive(true), libraryBilled(null))
  }
}
