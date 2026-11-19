// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.site

import com.aglyn.core.fontPreviewFileUrls
import com.aglyn.core.fontPreviewLetters
import com.aglyn.core.fontPreviewSheetUrl
import com.aglyn.site.setup.FontCost
import com.aglyn.site.setup.FontFamilyCost
import com.aglyn.site.setup.FontPickerRole
import com.aglyn.site.setup.GoogleFontFamily
import com.aglyn.site.setup.ThemeEdit
import com.aglyn.site.setup.ThemeFontChoice
import com.aglyn.site.setup.ThemeFontSelection
import com.aglyn.site.setup.defaultFontChoice
import com.aglyn.site.setup.expandCatalogRow
import com.aglyn.site.setup.fontCategoryLabel
import com.aglyn.site.setup.fontChoiceStylesLabel
import com.aglyn.site.setup.fontCostLabel
import com.aglyn.site.setup.fontWeightLabel
import com.aglyn.site.setup.nearestWeights
import com.aglyn.site.setup.searchFontFamilies
import com.aglyn.site.setup.siteSampleFrom
import com.aglyn.site.setup.suggestFontPairings
import com.aglyn.site.setup.themeValuesOf
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

/** Replays the console's own answers for the fonts plugin's picker and its preview addresses (AGL-3668). */
class FontPickerCasesTest {
  private val functions = Json.parseToJsonElement(
    File(System.getProperty("aglyn.contractsDir"), "function-cases.generated.json").readText(),
  ).jsonObject.getValue("functions").jsonObject

  private fun cases(name: String): List<Pair<JsonArray, JsonElement>> =
    functions.getValue(name).jsonObject.getValue("cases").jsonArray.map { it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result") }

  private fun ints(json: JsonElement?) = (json as? JsonArray).orEmpty().map { it.jsonPrimitive.int }
  private fun text(json: JsonElement) = json.jsonPrimitive.content

  /** A family the cases spell out in full (`GoogleFontFamily`). */
  private fun family(json: JsonElement): GoogleFontFamily {
    val obj = json.jsonObject
    return GoogleFontFamily(
      family = text(obj.getValue("family")),
      category = text(obj.getValue("category")),
      weights = ints(obj["weights"]),
      italics = ints(obj["italics"]),
      subsets = (obj["subsets"] as? JsonArray).orEmpty().map { text(it) },
      popularity = obj["popularity"]?.jsonPrimitive?.int ?: 0,
    )
  }

  private fun choice(json: JsonElement) = ThemeFontChoice.of(json)!!
  private fun role(json: JsonElement) = if (text(json) == "body") FontPickerRole.BODY else FontPickerRole.HEADING

  @Test
  fun previewAddressesAsTheConsoleMakesThem() {
    cases("previewLetters").forEach { (args, result) -> assertEquals(text(result), fontPreviewLetters(text(args[0])), args.toString()) }
    cases("previewSheetUrl").forEach { (args, result) ->
      assertEquals(text(result), fontPreviewSheetUrl(text(args[0]), args[1].jsonPrimitive.int, text(args[2]) == "italic", text(args[3])), args.toString())
    }
    cases("previewFileUrls").forEach { (args, result) -> assertEquals(result.jsonArray.map { text(it) }, fontPreviewFileUrls(text(args[0])), args.toString()) }
  }

  @Test
  fun choicesAndLabelsAsTheConsoleMakesThem() {
    cases("weightLabel").forEach { (args, result) -> assertEquals(text(result), fontWeightLabel(args[0].jsonPrimitive.int)) }
    cases("categoryLabel").forEach { (args, result) -> assertEquals(text(result), fontCategoryLabel(text(args[0]))) }
    cases("nearestWeights").forEach { (args, result) -> assertEquals(ints(result), nearestWeights(ints(args[0]), ints(args[1])), args.toString()) }
    cases("defaultFontChoice").forEach { (args, result) -> assertEquals(choice(result), defaultFontChoice(family(args[0]), role(args[1])), args.toString()) }
    cases("choiceStylesLabel").forEach { (args, result) -> assertEquals(text(result), fontChoiceStylesLabel(choice(args[0])), args.toString()) }
    cases("expandCatalogRow").forEach { (args, result) ->
      val got = expandCatalogRow(args[0])!!
      val want = result.jsonObject
      assertEquals(text(want.getValue("family")), got.family)
      assertEquals(ints(want["weights"]), got.weights)
      assertEquals(ints(want["italics"]), got.italics)
      assertEquals((want["axes"] as JsonArray).map { text(it.jsonObject.getValue("tag")) }, got.axes.map { it.tag }, args.toString())
      assertEquals(want.getValue("popularity").jsonPrimitive.int, got.popularity)
    }
  }

  @Test
  fun searchAndPairingsAsTheConsoleFindsThem() {
    cases("searchFontFamilies").forEach { (args, result) ->
      val catalog = args[0].jsonArray.map(::family)
      assertEquals(result.jsonArray.map { text(it.jsonObject.getValue("family")) }, searchFontFamilies(catalog, text(args[1]), text(args[2])).map { it.family }, args.toString())
    }
    cases("suggestFontPairings").forEach { (args, result) ->
      val catalog = args[2].jsonArray.map(::family)
      val limit = args.getOrNull(3)?.jsonPrimitive?.int ?: 4
      val got = suggestFontPairings(family(args[0]), role(args[1]), catalog, limit).map { it.family.family to it.reason }
      val want = result.jsonArray.map { text(it.jsonObject.getValue("family").jsonObject.getValue("family")) to text(it.jsonObject.getValue("reason")) }
      assertEquals(want, got, args.toString())
    }
  }

  @Test
  fun theEditorCarriesTheFontsBothWays() {
    val values = themeValuesOf(
      Json.parseToJsonElement(
        """{"fonts":{"body":{"family":"Inter","category":"sans-serif","weights":[400,700],"italics":[400],"source":"google"},"heading":null}}""",
      ),
    )
    assertEquals(ThemeFontSelection(ThemeFontChoice("Inter", "sans-serif", listOf(400, 700), listOf(400))), values.fonts)
    assertEquals(
      mapOf("control" to "fonts", "value" to mapOf("body" to mapOf("family" to "Inter", "category" to "sans-serif", "weights" to listOf(400, 700), "source" to "google", "italics" to listOf(400)), "heading" to null)),
      ThemeEdit.Fonts(values.fonts).body(),
    )
    assertEquals("38 KB · 2 files", fontCostLabel(FontCost(38_912, 2, true)))
    assertEquals("≈ 1.2 MB · 1 file", fontCostLabel(FontCost(1_258_291, 1, false)))
    assertEquals("0 KB", fontCostLabel(FontCost(0, 0, true)))
    assertEquals(JsonNull, JsonNull)
    assertEquals(true, JsonObject(emptyMap()).isEmpty())
  }

  @Test
  fun siteSampleAsTheConsoleMakesIt() {
    cases("siteSampleFrom").forEach { (args, result) ->
      val got = siteSampleFrom(args[0])
      val want = result.jsonObject
      assertEquals(text(want.getValue("title")), got.title, args.toString())
      assertEquals(text(want.getValue("heading")), got.heading, args.toString())
      assertEquals(text(want.getValue("paragraph")), got.paragraph, args.toString())
    }
  }

  @Test
  fun theCostAnswerReadsEachFamilysShare() {
    val cost = FontCost.of(
      Json.parseToJsonElement(
        """{"bytes":51200,"files":3,"complete":false,"families":[{"family":"Inter","source":"google","bytes":30720,"complete":true,"files":[{"style":"normal","weight":"400","bytes":15360},{"style":"normal","weight":"700","bytes":15360}]},{"family":"Lora","source":"google","bytes":20480,"complete":false,"files":[{"style":"normal","weight":"600","bytes":null}]}]}""",
      ),
    )
    assertEquals(FontFamilyCost("Inter", 30720, 2, true), cost.share(" inter "))
    assertEquals(false, cost.share("Lora")?.complete)
    assertEquals(null, cost.share("Roboto"))
    assertEquals("≈ 50 KB · 3 files", fontCostLabel(cost))
  }
}
