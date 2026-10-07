package com.aglyn.contracts

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Replays every case in function-cases.generated.json: the TypeScript's own answers. */
class FunctionCasesTest {
  private val root = ContractJsonFormat.parseToJsonElement(ContractCaseJson.functionCases).jsonObject
  private val functions = root.getValue("functions").jsonObject

  private fun cases(name: String): List<Pair<JsonArray, JsonElement>> =
    functions.getValue(name).jsonObject.getValue("cases").jsonArray.map {
      it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result")
    }

  /** A partial order as the TypeScript functions take it; every HostOrder field is optional. */
  private fun order(json: JsonElement): HostOrder = ContractJsonFormat.decodeFromJsonElement(HostOrder.serializer(), json)

  private fun str(element: JsonElement?): String? = (element as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

  @Test
  fun everyFunctionHasCases() {
    assertEquals("UTC", root.getValue("timeZone").jsonPrimitive.content)
    assertTrue(functions.keys.containsAll(listOf("formatOrderNumber", "formatOrderMoney", "formatReceiptMoney", "formatReceiptTime", "orderChannelLabel", "canTransitionOrder", "orderRefundState", "orderRefundSummary", "orderNetCents", "orderPaidCents", "apportionCents", "accountPushSwitch", "orderLineFulfillmentStates", "orderDisputeBlocksRefund")))
  }

  @Test
  fun formatOrderNumberCases() = cases("formatOrderNumber").forEach { (args, result) ->
    assertEquals(result.jsonPrimitive.content, formatOrderNumber(order(args[0]), str(args.getOrNull(1))), args.toString())
  }

  @Test
  fun formatOrderMoneyCases() = cases("formatOrderMoney").forEach { (args, result) ->
    val money = if (args.size > 1) formatOrderMoney(args[0].jsonPrimitive.double, str(args[1])!!) else formatOrderMoney(args[0].jsonPrimitive.double)
    assertEquals(result.jsonPrimitive.content, money, args.toString())
  }

  @Test
  fun formatReceiptMoneyCases() = cases("formatReceiptMoney").forEach { (args, result) ->
    assertEquals(result.jsonPrimitive.content, formatReceiptMoney(args[0].jsonPrimitive.double, str(args[1])!!), args.toString())
  }

  @Test
  fun formatReceiptTimeCases() = cases("formatReceiptTime").forEach { (args, result) ->
    assertEquals(result.jsonPrimitive.content, formatReceiptTime(args[0].jsonPrimitive.long, str(args.getOrNull(1))), args.toString())
  }

  @Test
  fun orderChannelLabelCases() = cases("orderChannelLabel").forEach { (args, result) ->
    assertEquals(result.jsonPrimitive.content, orderChannelLabel(str(args[0])), args.toString())
  }

  @Test
  fun canTransitionOrderCases() = cases("canTransitionOrder").forEach { (args, result) ->
    val status = { e: JsonElement -> OrderStatus.entries.first { it.raw == e.jsonPrimitive.content } }
    assertEquals(result.jsonPrimitive.booleanOrNull, canTransitionOrder(status(args[0]), status(args[1])), args.toString())
  }

  @Test
  fun orderRefundCases() {
    cases("orderRefundState").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.content, orderRefundState(order(args[0])).raw, args.toString())
    }
    cases("orderRefundSummary").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.content, orderRefundSummary(order(args[0])), args.toString())
    }
  }

  @Test
  fun orderFigureCases() {
    cases("orderNetCents").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.double, orderNetCents(order(args[0])), args.toString())
    }
    cases("orderPaidCents").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.double, orderPaidCents(order(args[0])), args.toString())
    }
  }

  @Test
  fun apportionCentsCases() = cases("apportionCents").forEach { (args, result) ->
    val weights = args[0].jsonArray.map { it.jsonPrimitive.double }
    assertEquals(result.jsonArray.map { it.jsonPrimitive.long }, apportionCents(weights, args[1].jsonPrimitive.double), args.toString())
  }

  @Test
  fun orderLineFulfillmentStatesCases() = cases("orderLineFulfillmentStates").forEach { (args, result) ->
    val expected = result.jsonArray.map {
      val row = it.jsonObject
      OrderLineFulfillmentState(
        lineItemId = row.getValue("lineItemId").jsonPrimitive.long.toInt(),
        quantity = row.getValue("quantity").jsonPrimitive.long,
        fulfilledQuantity = row.getValue("fulfilledQuantity").jsonPrimitive.long,
        remainingQuantity = row.getValue("remainingQuantity").jsonPrimitive.long,
        requiresShipping = row.getValue("requiresShipping").jsonPrimitive.boolean,
      )
    }
    assertEquals(expected, orderLineFulfillmentStates(order(args[0])), args.toString())
  }

  @Test
  fun orderDisputeBlocksRefundCases() = cases("orderDisputeBlocksRefund").forEach { (args, result) ->
    assertEquals(result.jsonPrimitive.boolean, orderDisputeBlocksRefund(order(args[0])), args.toString())
  }

  @Test
  fun contractValuesDecode() {
    assertEquals("Online", Contracts.orderChannelLabels["online"])
    assertTrue(Contracts.orderListQuery.fields.isNotEmpty())
    assertEquals(ListFilterClause(field = "disputeKey", op = "equals", value = "open"), Contracts.openDisputeClause)
  }

  @Test
  fun accountPushSwitchCases() = cases("accountPushSwitch").forEach { (args, result) ->
    val settings = (args[0] as? JsonObject)?.let { ContractJsonFormat.decodeFromJsonElement(AccountPushSettings.serializer(), it) }
    val legacy = (args.getOrNull(4) as? JsonObject)?.mapValues { it.value.jsonPrimitive.boolean }
    assertEquals(
      result.jsonPrimitive.boolean,
      accountPushSwitch(settings, args[1].jsonPrimitive.content, args[2].jsonPrimitive.content, args[3].jsonPrimitive.boolean, legacy),
      args.toString(),
    )
  }
}
