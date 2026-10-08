package com.aglyn.contracts

import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Replays buyerNotificationEnabled's cases in function-cases.generated.json: the TypeScript's own answers. */
class BuyerNotificationsCasesTest {
  @Test
  fun onUnlessExplicitlyFalse() {
    val cases = ContractJsonFormat.parseToJsonElement(ContractCaseJson.functionCases).jsonObject.getValue("functions").jsonObject
      .getValue("buyerNotificationEnabled").jsonObject.getValue("cases").jsonArray
    assertTrue(cases.isNotEmpty())
    cases.forEach {
      val args = it.jsonObject.getValue("args").jsonArray
      val expected = it.jsonObject.getValue("result").jsonPrimitive.content == "true"
      assertEquals(expected, buyerNotificationEnabled(plainOf(args[0]), args[1].jsonPrimitive.content), args.toString())
    }
  }
}
