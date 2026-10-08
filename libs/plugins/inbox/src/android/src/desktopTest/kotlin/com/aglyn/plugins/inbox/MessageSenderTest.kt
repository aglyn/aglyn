package com.aglyn.plugins.inbox

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

/** Replays the console's own `messageSender` answers (function-cases.generated.json). */
class MessageSenderTest {
  @Test
  fun messageSenderCases() {
    val cases = Json.parseToJsonElement(File(System.getProperty("aglyn.contractsDir"), "function-cases.generated.json").readText())
      .jsonObject.getValue("functions").jsonObject.getValue("messageSender").jsonObject.getValue("cases").jsonArray
    for (case in cases) {
      val arg = case.jsonObject.getValue("args").jsonArray[0]
      val fields = (arg as? JsonObject)?.mapValues { (_, value) ->
        when (value) {
          is JsonPrimitive -> value.content
          is JsonNull -> null
          else -> value.jsonArray.map { (it as JsonPrimitive).content }
        }
      }
      val expected = case.jsonObject.getValue("result").jsonObject
      val actual = messageSender(fields)
      assertEquals((expected["name"] as? JsonPrimitive)?.content, actual.name, arg.toString())
      assertEquals((expected["email"] as? JsonPrimitive)?.content, actual.email, arg.toString())
    }
  }
}
