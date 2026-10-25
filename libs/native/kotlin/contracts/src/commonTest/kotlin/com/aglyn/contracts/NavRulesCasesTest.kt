package com.aglyn.contracts

import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/** Replays navcore's cases (AGL-3943) for the account preferences, the nav lists and the one box's screens. */
class NavRulesCasesTest {
  // navcore's cases record their args without the manifest, which the functions now take first: it is prepended here.
  private val functions = ContractJsonFormat.parseToJsonElement(ContractCaseJson.functionCases).jsonObject.getValue("functions").jsonObject

  private fun cases(name: String): List<Pair<JsonArray, JsonElement>> {
    val list = functions.getValue(name).jsonObject.getValue("cases").jsonArray
    assertNotNull(list.firstOrNull(), "no cases for $name")
    return list.map { it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result") }
  }

  private fun <T> same(expected: JsonElement, actual: T, serializer: KSerializer<T>, label: String) =
    assertEquals(withoutNulls(expected(expected)), withoutNulls(expected(ContractJsonFormat.encodeToJsonElement(serializer, actual))), label)

  /** An absent key and a null are the same answer. */
  private fun withoutNulls(value: Any?): Any? = when (value) {
    is Map<*, *> -> value.filterValues { it != null }.mapValues { withoutNulls(it.value) }
    is List<*> -> value.map(::withoutNulls)
    else -> value
  }

  private fun ids(json: JsonElement): List<String> = json.jsonArray.map { it.jsonPrimitive.content }
  private fun text(json: JsonElement): String = json.jsonPrimitive.content
  private fun <T> decode(serializer: KSerializer<T>, json: JsonElement): T = ContractJsonFormat.decodeFromJsonElement(serializer, json)
  private val strings = ListSerializer(String.serializer())
  private fun nullableString(json: JsonElement): String? = (json as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

  @Test
  fun pins() {
    cases("readPinnedOrgs").forEach { (args, result) -> same(result, readPinnedOrgs(plainOf(args[0])), strings, args.toString()) }
    cases("effectivePinnedOrgs").forEach { (args, result) -> same(result, effectivePinnedOrgs(ids(args[0])), strings, args.toString()) }
    cases("pinnedOrgsOverCap").forEach { (args, result) -> assertEquals(result.jsonPrimitive.booleanOrNull, pinnedOrgsOverCap(ids(args[0])), args.toString()) }
    cases("pinOrg").forEach { (args, result) -> same(result, pinOrg(ids(args[0]), text(args[1])), PinOrgResult.serializer(), args.toString()) }
    cases("unpinOrg").forEach { (args, result) -> same(result, unpinOrg(ids(args[0]), text(args[1])), strings, args.toString()) }
    cases("replacePinnedOrg").forEach { (args, result) -> same(result, replacePinnedOrg(ids(args[0]), text(args[1]), text(args[2])), strings, args.toString()) }
    cases("keepPinnedOrgs").forEach { (args, result) -> same(result, keepPinnedOrgs(ids(args[0]), ids(args[1])), strings, args.toString()) }
    cases("movePinnedOrg").forEach { (args, result) ->
      same(result, movePinnedOrg(ids(args[0]), text(args[1]), args[2].jsonPrimitive.content.toDouble().toInt()), strings, args.toString())
    }
  }

  @Test
  fun recentWorkspacesAndTheRail() {
    cases("readRecentOrgs").forEach { (args, result) -> same(result, readRecentOrgs(plainOf(args[0])), strings, args.toString()) }
    cases("recordRecentOrg").forEach { (args, result) -> same(result, recordRecentOrg(ids(args[0]), text(args[1])), strings, args.toString()) }
    cases("railWorkspaces").forEach { (args, result) ->
      same(result, railWorkspaces(ids(args[0]), ids(args[1]), ids(args[2])), RailWorkspaces.serializer(), args.toString())
    }
    cases("workspaceInitial").forEach { (args, result) -> assertEquals(text(result), workspaceInitial(text(args[0])), args.toString()) }
  }

  @Test
  fun starredAndRecents() {
    cases("accountItemKey").forEach { (args, result) ->
      val item = args[0].jsonObject
      assertEquals(text(result), accountItemKey(text(item.getValue("kind")), text(item.getValue("id")), text(item.getValue("orgId")), item["hostId"]?.let(::nullableString)), args.toString())
    }
    val starredList = ListSerializer(StarredItem.serializer())
    cases("readStarred").forEach { (args, result) -> same(result, readStarred(plainOf(args[0])), starredList, args.toString()) }
    cases("toggleStarred").forEach { (args, result) ->
      same(result, toggleStarredPlain(decode(starredList, args[0]), plainOf(args[1]), args[2].jsonPrimitive.content.toDouble().toLong()), StarResult.serializer(), args.toString())
    }
    cases("setStarColor").forEach { (args, result) ->
      val color = nullableString(args[2])?.let { raw -> StarColor.entries.firstOrNull { it.raw == raw } ?: StarColor.UNKNOWN }
      same(result, setStarColor(decode(starredList, args[0]), text(args[1]), color), starredList, args.toString())
    }
    val recentList = ListSerializer(RecentItem.serializer())
    cases("readRecents").forEach { (args, result) -> same(result, readRecents(plainOf(args[0])), recentList, args.toString()) }
    cases("recordRecent").forEach { (args, result) ->
      same(result, recordRecentPlain(decode(recentList, args[0]), plainOf(args[1]), args[2].jsonPrimitive.content.toDouble().toLong()), recentList, args.toString())
    }
  }

  @Test
  fun colorsAndTheme() {
    cases("isAccountColor").forEach { (args, result) -> assertEquals(result.jsonPrimitive.booleanOrNull, isAccountColor(plainOf(args[0])), args.toString()) }
    cases("readWorkspaceColors").forEach { (args, result) ->
      same(result, readWorkspaceColors(plainOf(args[0])), MapSerializer(String.serializer(), String.serializer()), args.toString())
    }
    cases("resolveWorkspaceColor").forEach { (args, result) ->
      val orgId = if (args.size > 4) plainOf(args[4]) else null
      same(result, resolveWorkspaceColor(plainOf(args[0]), plainOf(args[1]), plainOf(args[2]), args[3].jsonPrimitive.booleanOrNull == true, orgId), WorkspaceColor.serializer(), args.toString())
    }
    cases("workspaceStableColor").forEach { (args, result) ->
      assertEquals(nullableString(result), workspaceStableColor(plainOf(args[0])), args.toString())
    }
    cases("readAppTheme").forEach { (args, result) -> same(result, readAppTheme(plainOf(args[0])), AppThemePrefs.serializer(), args.toString()) }
    // What is written back reads the same.
    val theme = readAppTheme(mapOf("appTheme" to mapOf("theme" to "ocean", "accent" to "#7A5CF0")))
    assertEquals(theme, readAppTheme(mapOf("appTheme" to theme.toPlain())))
  }

  @Test
  fun navLists() = cases("resolveNavList").forEach { (args, result) ->
    val listId = NativeNavListId.entries.first { it.raw == text(args[0]) }
    same(result, resolveNavList(Contracts.nativeNavManifest, listId, ids(args[1]), args[2].jsonPrimitive.booleanOrNull == true), ResolvedNavList.serializer(), args.toString())
  }

  @Test
  fun createMenus() = cases("resolveCreateList").forEach { (args, result) ->
    val scope = NativeNavCreateScope.entries.first { it.raw == text(args[0]) }
    val flags = MapSerializer(String.serializer(), Boolean.serializer())
    val actual = resolveCreateList(Contracts.nativeNavManifest, scope, ids(args[1]), decode(flags, args[2]), decode(flags, args[3]), nullableString(args[4]))
    same(result, actual, ListSerializer(ResolvedCreateItem.serializer()), args.toString())
  }

  @Test
  fun screensInTheOneBox() = cases("searchNavScreens").forEach { (args, result) ->
    val scope = OneBoxScope.valueOf(text(args[1]).uppercase())
    val actual = searchNavScreens(Contracts.nativeNavManifest, text(args[0]), scope, ids(args[2]), args[3].jsonPrimitive.booleanOrNull == true)
      .map { mapOf("row" to ContractJsonFormat.encodeToJsonElement(OneBoxRow.serializer(), it.row), "score" to JsonPrimitive(it.score)) }
    assertEquals(withoutNulls(expected(result)), withoutNulls(expected(JsonArray(actual.map { kotlinx.serialization.json.JsonObject(it) }))), args.toString())
  }

  @Test
  fun logicIsCalledLogic() {
    val site = resolveNavList(NativeNavListId.SITE, listOf("logic"), true)
    val logic = site.groups.flatMap { it.rows }.first { it.id == "logic" }
    assertEquals("Logic", logic.label)
    assertTrue(site.groups.flatMap { it.rows }.none { it.label == "Functions & Variables" })
  }
}
