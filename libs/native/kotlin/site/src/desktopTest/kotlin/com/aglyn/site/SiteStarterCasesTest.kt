package com.aglyn.site

import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.SiteStarterPickRefused
import com.aglyn.core.SiteStarterSummary
import com.aglyn.core.readSiteStarterPickRefusal
import com.aglyn.core.siteCreateReturnQuery
import com.aglyn.core.siteStarterPickBlock
import com.aglyn.site.sites.CreateSiteResult
import com.aglyn.site.sites.SiteStart
import com.aglyn.site.sites.createSite
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Replays derived-values.generated.json's `siteStarters`: what the console decides about a pick. */
class SiteStarterCasesTest {
  private val starters =
    Json.parseToJsonElement(File(System.getProperty("aglyn.contractsDir"), "derived-values.generated.json").readText()).jsonObject.getValue("siteStarters").jsonObject

  private fun JsonObject.flag(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull

  @Test
  fun decidesAboutAPickAsTheConsole() {
    val cases = starters.getValue("blockCases").jsonArray
    assertTrue(cases.isNotEmpty())
    cases.forEach { entry ->
      val case = entry.jsonObject
      val pick = (case["pick"] as? JsonObject)?.let { row ->
        SiteStarterSummary("l", "", priceUsd = (row["priceUsd"] as? JsonPrimitive)?.doubleOrNull ?: 0.0, owned = row.flag("owned"))
      }
      val expected = (case["block"] as? JsonPrimitive)?.contentOrNull
      assertEquals(expected, siteStarterPickBlock(pick, case.flag("owned"))?.name?.lowercase(), "$case")
    }
  }

  @Test
  fun readsARefusedPickAsTheConsole() {
    val cases = starters.getValue("refusalCases").jsonArray
    assertTrue(cases.isNotEmpty())
    cases.forEach { entry ->
      val case = entry.jsonObject
      val refused = case["refused"] as? JsonObject
      val expected = refused?.let { SiteStarterPickRefused(it.flag("keep") == true, it.flag("purchase") == true, it.getValue("message").jsonPrimitive.content) }
      val status = case.getValue("status").jsonPrimitive.content.toInt()
      assertEquals(expected, readSiteStarterPickRefusal(status, case["payload"], case.getValue("listingId").jsonPrimitive.content), "$case")
    }
  }

  @Test
  fun writesTheAddressThatReopensCreateSiteAsTheConsole() {
    starters.getValue("returnCases").jsonArray.forEach { entry ->
      val case = entry.jsonObject
      val expected = (case["params"]?.takeIf { it != JsonNull })?.jsonArray?.map { pair -> pair.jsonArray.map { it.jsonPrimitive.content } }
      assertEquals(expected, siteCreateReturnQuery(case.getValue("listingId").jsonPrimitive.content)?.map { listOf(it.first, it.second) }, "$case")
    }
  }

  @Test
  fun aCreateThatRefusesThePickSaysSoAndNotTheName() = runTest {
    suspend fun answer(status: Int, body: String): CreateSiteResult {
      val engine = MockEngine { respond(body, HttpStatusCode.fromValue(status), headersOf(HttpHeaders.ContentType, "application/json")) }
      val api = ConsoleApiClient("http://localhost", HttpClient(engine) { expectSuccess = false }, { "t" }, sleep = {})
      return createSite(api, "o1", "Shop", "shop", SiteStart.Starter("l1"))
    }
    assertEquals(
      CreateSiteResult.PickRefused(SiteStarterPickRefused(keep = true, purchase = true, message = "Buy it first")),
      answer(402, """{"error":"Buy it first","code":"purchase_required","listingId":"l1","priceUsd":12}"""),
    )
    assertEquals(
      CreateSiteResult.PickRefused(SiteStarterPickRefused(keep = false, purchase = false, message = "That starter is gone")),
      answer(404, """{"error":"That starter is gone","listingId":"l1"}"""),
    )
    assertEquals(
      CreateSiteResult.Refused("That subdomain is taken", listOf("shop-2")),
      answer(409, """{"error":"That subdomain is taken","suggestions":["shop-2"]}"""),
    )
  }
}
