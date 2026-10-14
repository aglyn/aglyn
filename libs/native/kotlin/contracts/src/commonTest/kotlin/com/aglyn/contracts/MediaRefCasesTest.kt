package com.aglyn.contracts

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Replays the media reference cases in function-cases.generated.json: the TypeScript's own answers. */
class MediaRefCasesTest {
  private val functions = ContractJsonFormat.parseToJsonElement(ContractCaseJson.functionCases).jsonObject.getValue("functions").jsonObject

  private fun cases(name: String): List<Pair<JsonArray, JsonElement>> =
    functions.getValue(name).jsonObject.getValue("cases").jsonArray.map { it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result") }

  private fun text(element: JsonElement?): String? = (element as? JsonPrimitive)?.takeIf { it !is JsonNull && it.isString }?.content

  @Test
  fun pickedFilesAreStoredAsTheConsoleStoresThem() {
    val all = cases("mediaNodeSrc")
    assertTrue(all.size >= 10)
    for ((args, result) in all) {
      val media = args[0].jsonObject
      val actual = mediaNodeSrc(text(media["url"]), text(media["cdnPath"]), (media["private"] as? JsonPrimitive)?.booleanOrNull)
      assertEquals(text(result), actual, args.toString())
    }
  }

  @Test
  fun storedValuesAreServedAsTheConsoleServesThem() {
    val all = cases("resolveMediaSrc")
    assertTrue(all.size >= 10)
    for ((args, result) in all) {
      val hostId = (args.getOrNull(1) as? JsonObject)?.get("hostId")?.let(::text)
      assertEquals(text(result), resolveMediaSrc(text(args[0]), hostId), args.toString())
    }
  }

  @Test
  fun aPickedFileGivesItsAltOnlyToAPlacementWithNone() {
    val all = cases("inheritedMediaAlt")
    assertTrue(all.size >= 8)
    for ((args, result) in all) {
      val given = args[0].jsonObject
      val actual = inheritedMediaAlt(text(given["placementAlt"]), text(given["assetAlt"]), (given["decorative"] as? JsonPrimitive)?.booleanOrNull == true)
      assertEquals(text(result), actual, args.toString())
    }
  }

  @Test
  fun aRestrictedAssetIsRequestedThroughTheFormThatNamesTheSite() {
    val all = cases("hostQualifiedCdnPath")
    assertTrue(all.size >= 10)
    for ((args, result) in all) {
      val visibleTo = (args[1] as? JsonArray)?.map { it.jsonPrimitive.content }
      assertEquals(text(result), hostQualifiedCdnPath(text(args[0]), visibleTo, text(args[2])), args.toString())
    }
  }

  @Test
  fun aLibraryFilmsLengthIsItsMeasuredRecordRoundedUp() {
    val all = cases("videoMediaProps")
    assertTrue(all.size >= 10)
    for ((args, result) in all) {
      val expected = (result.jsonObject["durationSeconds"] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content?.toLong()
      assertEquals(expected, libraryVideoSeconds(plainOf(args[0].jsonObject["assetVideo"])), args.toString())
    }
  }
}
