package com.aglyn.site

import com.aglyn.site.setup.extractVerificationToken
import com.aglyn.site.setup.isVerificationToken
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.boolean
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

/** Replays the console's own answers for the SEO setup's verification paste. */
class SetupCasesTest {
  private val functions = Json.parseToJsonElement(
    File(System.getProperty("aglyn.contractsDir"), "function-cases.generated.json").readText(),
  ).jsonObject.getValue("functions").jsonObject

  private fun cases(name: String) = functions.getValue(name).jsonObject.getValue("cases").jsonArray.map {
    val arg = it.jsonObject.getValue("args").jsonArray[0]
    (if (arg is JsonNull) null else arg.jsonPrimitive.contentOrNull) to it.jsonObject.getValue("result").jsonPrimitive
  }

  @Test
  fun extractsTheTokenAsTheConsoleDoes() = cases("extractSearchEngineVerificationToken").forEach { (arg, result) ->
    assertEquals(result.content, extractVerificationToken(arg), arg.toString())
  }

  @Test
  fun judgesATokenAsTheConsoleDoes() = cases("isSearchEngineVerificationToken").forEach { (arg, result) ->
    assertEquals(result.boolean, isVerificationToken(arg), arg.toString())
  }
}
