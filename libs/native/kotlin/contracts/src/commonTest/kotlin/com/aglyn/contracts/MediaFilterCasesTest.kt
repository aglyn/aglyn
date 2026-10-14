package com.aglyn.contracts

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Replays the media-filter cases in function-cases.generated.json: the TypeScript's own answers. */
class MediaFilterCasesTest {
  private val cases = ContractJsonFormat.parseToJsonElement(ContractCaseJson.functionCases).jsonObject
    .getValue("functions").jsonObject.getValue("mediaQueryRequest").jsonObject.getValue("cases").jsonArray

  private fun clause(element: JsonElement): ListFilterRequest = element.jsonObject.let {
    ListFilterRequest(it.getValue("field").jsonPrimitive.content, it.getValue("op").jsonPrimitive.content, it.getValue("value").jsonPrimitive.content)
  }

  @Test
  fun everyCaseMatchesTheConsole() {
    assertTrue(cases.size >= 8)
    for (case in cases) {
      val args = case.jsonObject.getValue("args").jsonArray
      assertEquals(clause(case.jsonObject.getValue("result")), mediaQueryRequest(clause(args[0])), args.toString())
    }
  }
}
