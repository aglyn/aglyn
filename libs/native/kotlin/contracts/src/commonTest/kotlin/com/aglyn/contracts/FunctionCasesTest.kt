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
import kotlinx.serialization.json.contentOrNull
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
    assertTrue(functions.keys.containsAll(listOf("formatOrderNumber", "formatOrderMoney", "formatReceiptMoney", "formatReceiptTime", "orderChannelLabel", "canTransitionOrder", "orderRefundState", "orderRefundSummary", "orderNetCents", "orderPaidCents", "apportionCents", "accountPushSwitch", "orderLineFulfillmentStates", "orderDisputeBlocksRefund", "liftLegacyOrder", "orderIsTestMode", "orderCountsAsSale", "orderWindowFigures", "productSales", "productPriceRange", "productInventory", "isLowStock", "liftLegacyProduct", "describeRestockCheck", "posPinProblem", "posCashVarianceCents", "expandVariantMatrix", "renameProductOptions", "currencyFractionDigits", "currencyMinorToMajor", "parseCurrencyInput", "customFieldCurrency")))
  }

  /** The plan card's meters (AGL-3992): which leads for the screen in front, the order of the rest, and whether it shows. */
  @Test
  fun thePlanCardPicksItsMetersAsTheConsoleDoes() {
    fun readings(json: JsonElement) = json.jsonArray.map {
      val o = it.jsonObject
      fun num(key: String) = (o[key] as? JsonPrimitive)?.takeIf { p -> p !is JsonNull }?.double
      PlanCardReading(o.getValue("meter").jsonPrimitive.content, num("used"), num("limit"))
    }
    cases("planCardMeterOrder").forEach { (args, result) ->
      assertEquals(result.jsonArray.map { it.jsonPrimitive.content }, planCardMeterOrder(readings(args[0]), str(args[1])), args.toString())
    }
    cases("planCardContext").forEach { (args, result) ->
      assertEquals(str(result), planCardContext(str(args[0]), args[1].jsonPrimitive.boolean), args.toString())
    }
    cases("planCardShows").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.boolean, planCardShows(readings(args[0]), args[1].jsonPrimitive.boolean), args.toString())
    }
  }

  /** A CRM currency field's amounts (AGL-3971): USD's two decimals, JPY's none, BHD's three, as the console's Intl. */
  @Test
  fun currencyFieldAmountsUseEachCurrencysOwnDecimals() {
    cases("currencyFractionDigits").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.long.toInt(), currencyFractionDigits(str(args[0]).orEmpty()), args.toString())
    }
    cases("currencyMinorToMajor").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.double, currencyMinorToMajor(args[0].jsonPrimitive.double, str(args[1]).orEmpty()), args.toString())
    }
    cases("parseCurrencyInput").forEach { (args, result) ->
      assertEquals((result as? JsonPrimitive)?.takeIf { it !is JsonNull }?.long, parseCurrencyInput(str(args[0]), str(args[1]).orEmpty()), args.toString())
    }
    cases("customFieldCurrency").forEach { (args, result) ->
      assertEquals(str(result), customFieldCurrency(str((args[0] as? JsonObject)?.get("currency"))), args.toString())
    }
    assertEquals("1250.50", currencyInputText(125050.0, "usd"))
    assertEquals("1500", currencyInputText(1500.0, "jpy"))
    assertEquals("1.250", currencyInputText(1250.0, "bhd"))
    assertEquals("-0.05", currencyInputText(-5.0, "usd"))
  }

  @Test
  fun anOfflineSaleIsPricedAndTaxedAsTheConsoleDoes() = cases("posOfflineSaleTotals").forEach { (args, result) ->
    val input = args[0].jsonObject
    val tax = input.getValue("tax").jsonObject
    val lines = input.getValue("lines").jsonArray.map {
      PosOfflineTotalsLine(it.jsonObject.getValue("unitAmountCents").jsonPrimitive.double, it.jsonObject.getValue("quantity").jsonPrimitive.double)
    }
    val totals = posOfflineSaleTotals(
      lines,
      input.getValue("discountPct").jsonPrimitive.double,
      tax["pct"]?.takeIf { it !is JsonNull }?.jsonPrimitive?.double,
      tax.getValue("pricesIncludeTax").jsonPrimitive.boolean,
    )
    val expected = result.jsonObject
    assertEquals(expected.getValue("itemsCents").jsonPrimitive.double, totals.itemsCents, args.toString())
    assertEquals(expected.getValue("discountCents").jsonPrimitive.double, totals.discountCents, args.toString())
    assertEquals(expected.getValue("taxCents").jsonPrimitive.double, totals.taxCents, args.toString())
    assertEquals(expected.getValue("totalCents").jsonPrimitive.double, totals.totalCents, args.toString())
    assertEquals(expected.getValue("shippingCents").jsonPrimitive.double, totals.shippingCents, args.toString())
    assertEquals(expected.getValue("feeCents").jsonPrimitive.double, totals.feeCents, args.toString())
  }

  @Test
  fun changeIsNeverNegative() = cases("posOfflineChangeCents").forEach { (args, result) ->
    assertEquals(result.jsonPrimitive.long, posOfflineChangeCents(args[0].jsonPrimitive.double, args[1].jsonPrimitive.double), args.toString())
  }

  @Test
  fun aCardTakenOfflineIsRefusedAsTheConsoleRefusesIt() {
    cases("posOfflineCardRefusal").forEach { (args, result) ->
      val input = args[0].jsonObject
      val card = input["card"]?.takeIf { it !is JsonNull }?.jsonObject?.let {
        PosOfflineKitCard(
          available = it.getValue("available").jsonPrimitive.boolean,
          currency = "usd",
          destination = "acct_test",
          maxSaleCents = it.getValue("maxSaleCents").jsonPrimitive.double,
          maxDeviceDailyCents = it.getValue("maxDeviceDailyCents").jsonPrimitive.double,
          unavailableReason = it["unavailableReason"]?.jsonPrimitive?.content,
        )
      }
      val expected = result.takeIf { it !is JsonNull }?.jsonPrimitive?.content
      assertEquals(expected, posOfflineCardRefusal(card, input.getValue("totalCents").jsonPrimitive.double, input.getValue("takenTodayCents").jsonPrimitive.double), args.toString())
    }
    cases("posOfflineCardIntentMetadata").forEach { (args, result) ->
      val input = args[0].jsonObject
      val expected = result.jsonObject.mapValues { it.value.jsonPrimitive.content }
      assertEquals(expected, posOfflineCardIntentMetadata(str(input["saleKey"]) ?: "", str(input["hostId"]) ?: "", str(input["orgId"]) ?: "", str(input["registerId"]) ?: ""), args.toString())
    }
  }

  @Test
  fun theDayReportReadsAndExportsAsTheConsoleDoes() {
    fun report(value: JsonElement) = ContractJsonFormat.decodeFromJsonElement(PosDayReport.serializer(), value)
    cases("posDayRangeLabel").forEach { (args, result) ->
      val input = args[0].jsonObject
      assertEquals(result.jsonPrimitive.content, posDayRangeLabel(str(input["from"])!!, str(input["to"])!!))
    }
    cases("posDayAmount").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.content, posDayAmount(args[0].takeIf { it !is JsonNull }?.jsonPrimitive?.double, str(args[1])!!), args.toString())
    }
    cases("posDayReportIsEmpty").forEach { (args, result) -> assertEquals(result.jsonPrimitive.boolean, posDayReportIsEmpty(report(args[0]))) }
    cases("posDayReportCsv").forEach { (args, result) -> assertEquals(result.jsonPrimitive.content, posDayReportCsv(report(args[0]))) }
    cases("posShiftsCsv").forEach { (args, result) ->
      val rows = args[0].jsonArray.map { raw ->
        val obj = raw.jsonObject
        PosShiftCsvRow(
          id = obj["id"]?.jsonPrimitive?.content ?: "",
          registerName = obj["registerName"]?.jsonPrimitive?.contentOrNull,
          shift = ContractJsonFormat.decodeFromJsonElement(PosShift.serializer(), raw),
        )
      }
      assertEquals(result.jsonPrimitive.content, posShiftsCsv(rows))
    }
  }

  @Test
  fun aSaleKeyIsAnIdTheOrderCanTake() = cases("posOfflineSaleKeyIsValid").forEach { (args, result) ->
    assertEquals(result.jsonPrimitive.boolean, posOfflineSaleKeyIsValid(str(args[0])), args.toString())
  }

  @Test
  fun whatACustomerTypesOnTheDisplayIsCheckedAsTheConsoleChecksIt() {
    cases("posDisplayEmail").forEach { (args, result) -> assertEquals(result.jsonPrimitive.content, posDisplayEmail(str(args[0])), args.toString()) }
    cases("posDisplayPhone").forEach { (args, result) -> assertEquals(result.jsonPrimitive.content, posDisplayPhone(str(args[0])), args.toString()) }
  }

  @Test
  fun aTipIsWholeCentsAndNoMoreThanThePayment() = cases("posTipProblem").forEach { (args, result) ->
    assertEquals(str(result), posTipProblem(args[0].jsonPrimitive.double, args[1].jsonPrimitive.double), args.toString())
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
  fun describeRestockCheckCases() = cases("describeRestockCheck").forEach { (args, result) ->
    val check = ContractJsonFormat.decodeFromJsonElement(OrderRestockCheck.serializer(), args[0])
    assertEquals(result.jsonPrimitive.content, describeRestockCheck(check, order(args[1])), args.toString())
  }

  @Test
  fun posPinProblemCases() = cases("posPinProblem").forEach { (args, result) ->
    assertEquals(str(result), posPinProblem(str(args[0])), args.toString())
  }

  @Test
  fun posCashVarianceCases() = cases("posCashVarianceCents").forEach { (args, result) ->
    assertEquals(result.jsonPrimitive.long, posCashVarianceCents(args[0].jsonPrimitive.double, args[1].jsonPrimitive.double), args.toString())
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

  /** A stored order as the figures take it: `$id` and `livemode` beside the order's own fields. */
  private fun figure(json: JsonElement): FigureOrder {
    val fields = json.jsonObject
    return FigureOrder(
      id = str(fields["\$id"]),
      livemode = (fields["livemode"] as? JsonPrimitive)?.booleanOrNull,
      order = order(JsonObject(fields - "\$id" - "livemode")),
    )
  }

  @Test
  fun liftLegacyOrderCases() = cases("liftLegacyOrder").forEach { (args, result) ->
    assertEquals(order(result), liftLegacyOrder(order(args[0])), args.toString())
  }

  @Test
  fun orderIsTestModeCases() = cases("orderIsTestMode").forEach { (args, result) ->
    val source = figure(args[0])
    assertEquals(result.jsonPrimitive.boolean, orderIsTestMode(source.order, source.id, source.livemode), args.toString())
  }

  @Test
  fun salesFigureCases() {
    cases("orderCountsAsSale").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.boolean, orderCountsAsSale(figure(args[0])), args.toString())
    }
    cases("orderWindowFigures").forEach { (args, result) ->
      val expected = result.jsonObject
      val figures = orderWindowFigures(args[0].jsonArray.map(::figure), args[1].jsonPrimitive.double, args[2].jsonPrimitive.double)
      assertEquals(
        OrderWindowFigures(expected.getValue("orders").jsonPrimitive.long, expected.getValue("revenueCents").jsonPrimitive.double, expected.getValue("averageCents").jsonPrimitive.double),
        figures,
        args.toString(),
      )
    }
    cases("productSales").forEach { (args, result) ->
      val expected = result.jsonArray.map {
        val row = it.jsonObject
        ProductSales(row.getValue("productId").jsonPrimitive.content, row.getValue("name").jsonPrimitive.content, row.getValue("units").jsonPrimitive.double, row.getValue("cents").jsonPrimitive.double)
      }
      assertEquals(expected, productSales(args[0].jsonArray.map(::figure)), args.toString())
    }
  }

  private fun product(json: JsonElement): HostProduct = ContractJsonFormat.decodeFromJsonElement(HostProduct.serializer(), json)

  @Test
  fun productFigureCases() {
    cases("productPriceRange").forEach { (args, result) ->
      val (low, high) = result.jsonArray.map { it.jsonPrimitive.double }
      assertEquals(low to high, productPriceRange(product(args[0])), args.toString())
    }
    cases("productInventory").forEach { (args, result) ->
      assertEquals((result as? JsonPrimitive)?.takeIf { it !is JsonNull }?.double, productInventory(product(args[0])), args.toString())
    }
    cases("isLowStock").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.boolean, isLowStock(product(args[0])), args.toString())
    }
    cases("liftLegacyProduct").forEach { (args, result) ->
      assertEquals(product(result), liftLegacyProduct(product(args[0])), args.toString())
    }
  }

  @Test
  fun variantMatrixCases() {
    val options = { e: JsonElement? -> (e as? JsonArray).orEmpty().map { ContractJsonFormat.decodeFromJsonElement(ProductOption.serializer(), it) } }
    cases("expandVariantMatrix").forEach { (args, result) ->
      val expected = result.jsonArray.map { combo -> combo.jsonObject.mapValues { it.value.jsonPrimitive.content } }
      assertEquals(expected, expandVariantMatrix(options(args[0]).takeIf { args[0] !is JsonNull }), args.toString())
    }
    cases("renameProductOptions").forEach { (args, result) ->
      val product = args[0].jsonObject
      val variants = { e: JsonElement? -> (e as JsonArray).map { ContractJsonFormat.decodeFromJsonElement(ProductVariant.serializer(), it) } }
      val names = args[1].jsonArray.map { str(it) }
      val (renamed, moved) = renameProductOptions(options(product["options"]), variants(product["variants"]), names)
      assertEquals(options(result.jsonObject["options"]), renamed, args.toString())
      assertEquals(variants(result.jsonObject["variants"]), moved, args.toString())
    }
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
