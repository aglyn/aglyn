package com.aglyn.plugins.marketplace

import com.aglyn.core.SiteStarterMode
import com.aglyn.core.SiteStarterSummary
import com.aglyn.core.siteStarterPriceLabel
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Replays derived-values.generated.json's `siteStarters`: the search as the console asks it and reads it. */
class StarterQueryTest {
  private val starters =
    Json.parseToJsonElement(File(System.getProperty("aglyn.contractsDir"), "derived-values.generated.json").readText()).jsonObject.getValue("siteStarters").jsonObject

  private fun JsonObject.text(key: String) = (this[key] as? JsonPrimitive)?.contentOrNull

  @Test
  fun asksInTheConsolesOrder() {
    starters.getValue("paramCases").jsonArray.forEach { entry ->
      val input = entry.jsonObject.getValue("input").jsonObject
      // The apps name no facet and restore no pick, so their search is the console's with neither.
      if ("filter" in input || "include" in input) return@forEach
      val params = StarterQuery.params(
        input.text("orgId").orEmpty(),
        if (input.text("mode") == "ai") SiteStarterMode.AI else SiteStarterMode.BASE,
        input.text("word").orEmpty(),
        (input["limit"] as? JsonPrimitive)?.int ?: 50,
      )
      val expected = entry.jsonObject.getValue("params").jsonArray.map { pair -> pair.jsonArray.map { it.jsonPrimitive.content } }
      assertEquals(expected, params.map { listOf(it.first, it.second) }, "$input")
    }
  }

  @Test
  fun readsAStarterAsTheConsole() {
    val cases = starters.getValue("summaryCases").jsonArray
    assertTrue(cases.isNotEmpty())
    cases.forEach { entry ->
      val read = StarterQuery.readSummary(entry.jsonObject["value"])
      val expected = entry.jsonObject["summary"] as? JsonObject
      if (expected == null) {
        assertEquals(null, read)
        return@forEach
      }
      val facets = expected.getValue("facets").jsonObject
      assertEquals(
        SiteStarterSummary(
          listingId = expected.getValue("listingId").jsonPrimitive.content,
          displayName = expected.text("displayName").orEmpty(),
          description = expected.text("description").orEmpty(),
          authorName = expected.text("authorName").orEmpty(),
          official = expected.text("official") == "true",
          priceUsd = expected.getValue("priceUsd").jsonPrimitive.doubleOrNull ?: 0.0,
          previewImageUrl = expected.text("previewImageUrl"),
          kind = facets.text("kind"),
          pages = facets.getValue("pages").jsonPrimitive.int,
          mode = if (facets.text("mode") == "ai") SiteStarterMode.AI else SiteStarterMode.BASE,
          owned = expected.text("owned")?.toBooleanStrictOrNull(),
        ),
        read,
      )
    }
  }

  @Test
  fun readsAnAnswerAsTheConsole() {
    starters.getValue("answerCases").jsonArray.forEach { entry ->
      val expected = entry.jsonObject.getValue("rows").jsonArray.map { it.jsonPrimitive.content }
      assertEquals(expected, StarterQuery.parseAnswer(entry.jsonObject["json"]).map { it.listingId })
    }
  }

  @Test
  fun wordsAPriceAndAPageCountAsTheConsole() {
    starters.getValue("priceCases").jsonArray.forEach { entry ->
      val usd = (entry.jsonObject["usd"] as? JsonPrimitive)?.doubleOrNull ?: Double.NaN
      assertEquals(entry.jsonObject.text("label"), siteStarterPriceLabel(usd))
    }
    starters.getValue("pagesCases").jsonArray.forEach { entry ->
      val pages = entry.jsonObject.getValue("pages").jsonPrimitive.doubleOrNull ?: 0.0
      assertEquals(entry.jsonObject["label"].takeUnless { it == JsonNull }?.jsonPrimitive?.content, StarterQuery.pagesLabel(pages))
    }
  }

  @Test
  fun aStylePictureComesFromThePathAnAppCanRead() {
    val row = SiteStarterSummary("l", "Trades", previewImageUrl = "https://app.aglyn.com/_static/starter/styles/trades.webp")
    // `/_static` answers OkHttp with a challenge (AGL-4127).
    assertEquals("https://app.aglyn.com/api/media/cdn/site-styles/trades.webp?w=240", starterPicture(row, "https://app.aglyn.com", 240))
    val own = SiteStarterSummary("l", "Mine", previewImageUrl = "https://cdn.test/mine.png")
    assertEquals("https://cdn.test/mine.png", starterPicture(own, "https://app.aglyn.com", 240))
    assertEquals(null, starterPicture(SiteStarterSummary("l", "None"), "https://app.aglyn.com", 240))
  }
}
