package com.aglyn.contracts

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

/** Replays the SEO check's cases in function-cases.generated.json: the TypeScript's own answers. */
class SeoAuditCasesTest {
  private val functions = ContractJsonFormat.parseToJsonElement(ContractCaseJson.functionCases).jsonObject.getValue("functions").jsonObject

  private fun cases(name: String): List<Pair<JsonArray, JsonElement>> {
    val list = functions.getValue(name).jsonObject.getValue("cases").jsonArray
    assertNotNull(list.firstOrNull(), "no cases for $name")
    return list.map { it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result") }
  }

  private fun text(json: JsonElement?): String? = (json as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull

  private fun lists(json: JsonElement): Map<String, List<String>> = json.jsonObject.mapValues { (_, v) -> v.jsonArray.map { it.jsonPrimitive.content } }

  @Test
  fun pathsAndKeywords() {
    cases("seoNormalizePath").forEach { (args, result) -> assertEquals(result.jsonPrimitive.content, seoNormalizePath(args[0].jsonPrimitive.content), args.toString()) }
    cases("seoKeywordSplit").forEach { (args, result) ->
      val split = (args[0] as? JsonArray)?.let { list -> seoKeywordSplit(list.map { it.jsonPrimitive.content }) } ?: seoKeywordSplit(text(args[0]))
      assertEquals(result.jsonObject.getValue("keywords").jsonArray.map { it.jsonPrimitive.content }, split.keywords, args.toString())
      assertEquals(result.jsonObject.getValue("unchecked").jsonArray.map { it.jsonPrimitive.content }, split.unchecked, args.toString())
    }
    cases("readSeoKeywordLines").forEach { (args, result) ->
      val read = readSeoKeywordLines(text(args[0]))
      assertEquals(lists(result.jsonObject.getValue("keywords")), read.keywords.toMap(), args.toString())
      assertEquals(lists(result.jsonObject.getValue("unchecked")), read.unchecked.toMap(), args.toString())
    }
  }

  @Test
  fun rowsRoundTripTheLinesInTheirOrder() {
    val rows = seoKeywordRowsFromLines("/b: two, three\n/a: one, two, three, four, five, six")
    assertEquals(listOf("/b", "/a"), rows.map { it.path })
    assertEquals(listOf("one", "two", "three", "four", "five", "six"), rows[1].keywords)
    assertEquals("/b: two, three\n/a: one, two, three, four, five, six", seoKeywordLinesFromRows(rows))
    assertEquals("/a: x", seoKeywordLinesFromRows(listOf(SeoTargetKeywordRow("a", listOf("x")), SeoTargetKeywordRow("", listOf("y")), SeoTargetKeywordRow("/c", emptyList()))))
  }

  @Test
  fun findingCountAndLabels() {
    cases("seoAuditFindingCount").forEach { (args, result) ->
      val pages = args[0].jsonObject.getValue("pages").jsonArray.map { page ->
        SeoPageReport(page.jsonObject.getValue("findings").jsonArray.map { SeoFinding(SeoFindingCode.ORPHAN, message = "", severity = SeoSeverity.LOW) }, emptyList(), "", "", 0, "")
      }
      val site = args[0].jsonObject.getValue("site").jsonArray.map { SeoFinding(SeoFindingCode.SEARCH_DISCOURAGED, message = "", severity = SeoSeverity.HIGH) }
      assertEquals(result.jsonPrimitive.content.toInt(), seoAuditFindingCount(SeoAuditReport(emptyList(), pages, 0.0, site, 0)), args.toString())
    }
    assertEquals("Target keyword not covered: pricing", seoFindingLabel(SeoFinding(SeoFindingCode.KEYWORD_MISSING, keyword = "pricing", message = "", severity = SeoSeverity.LOW)))
    assertEquals("No search title", seoFindingLabel(SeoFinding(SeoFindingCode.TITLE_MISSING, message = "", severity = SeoSeverity.HIGH)))
  }
}
