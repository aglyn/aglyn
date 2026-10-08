package com.aglyn.core.listquery

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

/** Replays the console's own answers for the media library's search and type helpers. */
class MediaSearchTest {
  private val functions = Json.parseToJsonElement(
    File(System.getProperty("aglyn.contractsDir"), "function-cases.generated.json").readText(),
  ).jsonObject.getValue("functions").jsonObject

  private fun cases(name: String) = functions.getValue(name).jsonObject.getValue("cases").jsonArray.map {
    it.jsonObject.getValue("args").jsonArray[0].jsonPrimitive.content to it.jsonObject.getValue("result").jsonPrimitive.content
  }

  @Test
  fun mediaSearchTokenCases() = cases("mediaSearchToken").forEach { (arg, result) -> assertEquals(result, mediaSearchToken(arg), arg) }

  @Test
  fun mediaKindOfCases() = cases("mediaKindOf").forEach { (arg, result) -> assertEquals(result, mediaKindOf(arg), arg) }
}
