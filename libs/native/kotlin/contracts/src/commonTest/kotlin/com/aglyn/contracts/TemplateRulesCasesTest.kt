package com.aglyn.contracts

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Replays the page-address and template-token cases in function-cases.generated.json: the TypeScript's own answers. */
class TemplateRulesCasesTest {
  private val functions = ContractJsonFormat.parseToJsonElement(ContractCaseJson.functionCases).jsonObject.getValue("functions").jsonObject

  private fun cases(name: String): List<Pair<JsonArray, JsonElement>> =
    functions.getValue(name).jsonObject.getValue("cases").jsonArray.map { it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result") }

  private fun text(element: JsonElement?): String? = (element as? JsonPrimitive)?.takeIf { it !is JsonNull && it.isString }?.content

  @Test
  fun slugsAreNormalizedAndCheckedAsTheConsoleDoes() {
    for ((args, result) in cases("normalizeScreenSlug")) assertEquals(text(result), normalizeScreenSlug(text(args[0])), args.toString())
    for ((args, result) in cases("reservedScreenRouteSegment")) assertEquals(text(result), reservedScreenRouteSegment(text(args[0])), args.toString())
    for ((args, result) in cases("reservedScreenRouteMessage")) assertEquals(text(result), reservedScreenRouteMessage(text(args[0])!!), args.toString())
    for ((args, result) in cases("screenSlugHasPathSeparator")) assertEquals((result as JsonPrimitive).content == "true", screenSlugHasPathSeparator(text(args[0])), args.toString())
    assertEquals("/", SCREEN_ROOT_PATH)
  }

  @Test
  fun aTemplatePageLandsWhereTheConsolePutsIt() {
    val refusals = cases("templateScreenAddressRefusal")
    assertTrue(refusals.size >= 6)
    for ((args, result) in refusals) {
      val input = args[0].jsonObject
      assertEquals(text(result), templateScreenAddressRefusal(text(input["slug"]), text(input["displayName"])), args.toString())
    }
    val among = cases("resolveTemplateSlugAmong")
    assertTrue(among.size >= 8)
    for ((args, result) in among) {
      val input = args[0].jsonObject
      val taken = input.getValue("taken").jsonArray.map { it.jsonPrimitive.content }.toMutableSet()
      val answer = resolveTemplateSlug(text(input["slug"]), text(input["displayName"]) ?: "", taken)
      val expected = result.jsonObject
      assertEquals(text(expected["slug"]), answer.slug, args.toString())
      assertEquals(text(expected["requestedSlug"]), answer.requestedSlug, args.toString())
      assertEquals(expected.getValue("taken").jsonArray.map { it.jsonPrimitive.content }.toSet(), taken, args.toString())
    }
  }

  @Test
  fun aBundleWithoutAHomePageGivesItsFirstPageTheRoot() {
    val all = cases("withBundleRootScreen")
    assertTrue(all.size >= 5)
    for ((args, result) in all) {
      val screens = args[0].jsonArray.map { it.jsonObject.let { page -> text(page["displayName"]) to text(page["slug"]) } }
      val taken = args[1].jsonArray.map { it.jsonPrimitive.content }
      val actual = withBundleRootScreen(screens, taken, { it.second }, { page, slug -> page.first to slug })
      val expected = result.jsonArray.map { it.jsonObject.let { page -> text(page["displayName"]) to text(page["slug"]) } }
      assertEquals(expected, actual, args.toString())
    }
  }

  @Test
  fun placeholdersAreFilledInEveryNodesProps() {
    val all = cases("resolveNamedTokens")
    assertTrue(all.size >= 8)
    for ((args, result) in all) {
      @Suppress("UNCHECKED_CAST")
      val nodes = plainOf(args[0]) as Map<String, Any?>
      val tokens = (args[1] as? JsonObject)?.mapValues { it.value.jsonPrimitive.content }
      assertEquals(comparable(plainOf(result)), comparable(resolveNamedTokens(nodes, tokens)), args.toString())
    }
  }

  @Test
  fun aSavedTemplateAsksForTheBareNamesItsContentUses() {
    val all = cases("detectTemplatePlaceholders")
    assertTrue(all.size >= 6)
    for ((args, result) in all) {
      @Suppress("UNCHECKED_CAST")
      val nodes = plainOf(args[0]) as Map<String, Any?>
      assertEquals(result.jsonArray.map { it.jsonPrimitive.content }, detectTemplatePlaceholders(nodes), args.toString())
    }
  }
}
