package com.aglyn.screens

import com.aglyn.core.ApiMethod
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject

/** Labels for several orders at once: pick a box and a rule, review the rates, buy them all, the way the console's batch labels do. */
class ShippingBatchSpecsTest : SpecTestBase() {
  private val settings = """{"settings":{"defaultPackageId":"box1","packages":[{"id":"box1","name":"Small","lengthCm":20,"widthCm":15,"heightCm":10}]}}"""

  @Test
  fun theLabelsRowLivesInTheSelectedOrdersAndNavigatesWithTheBoxAndRule() {
    assertEquals(listOf("ordersBulk"), spec("shipping", "shipping.batch").zones)
    assertEquals(listOf("ordersBulk"), spec("commerce", "commerce.ordersBulk").blocks.filter { it.type == "zone" }.map { it.string("name") })
    val model = screen(spec("shipping", "shipping.batch"), mapOf("orderIds" to "a,b", "run" to "run1"), """{"avail":{"available":true},"settings":$settings}""")
    assertEquals(listOf("about", "rate"), model.shown())
    val rate = model.action("rate", "rate")
    assertEquals(listOf("presetId", "policy"), rate.prompt.map { it.key })
    assertEquals("box1", ScreenValues.render(rate.prompt.first().initial!!, model.context))
    assertEquals("Small (20 × 15 × 10 cm)", rate.prompt.first().choices(model.context).single().second)
    assertEquals("shipping.batchReview", rate.navigate!!.screen)
    assertEquals(mapOf("orderIds" to "{params.orderIds}", "run" to "{params.run}", "presetId" to "{form.presetId}", "policy" to "{form.policy}"), rate.navigate!!.params)
    assertEquals(listOf("off"), screen(spec("shipping", "shipping.batch"), emptyMap(), """{"avail":{"available":false}}""").shown())
  }

  private val rated = """{"results":[
    {"recordId":"a","recordRef":"#1001","shipmentId":"shp_a","rate":{"rateId":"rate_a","label":"UPS Ground","amountCents":845,"currency":"USD"},"weightGrams":900,"error":null},
    {"recordId":"b","recordRef":"#1002","shipmentId":"shp_b","rate":{"rateId":"rate_b","label":"USPS Priority","amountCents":1210,"currency":"USD","merchantCarrierAccount":true},"weightGrams":1500,"error":null},
    {"recordId":"c","recordRef":null,"shipmentId":null,"rate":null,"weightGrams":null,"error":"No rate matches the service rule."}]}"""

  private fun review(results: String = rated) =
    screen(spec("shipping", "shipping.batchReview"), mapOf("orderIds" to "a,b,c", "run" to "run0123456789", "presetId" to "box1", "policy" to "fastest"), """{"rates":$results}""")

  @Test
  fun theRatesAreAskedForTheTickedOrdersInOneBoxUnderOneRule() {
    val model = review()
    val load = model.spec.loads.single()
    assertEquals(ApiMethod.POST, load.method)
    assertEquals("/api/shipping/batch/rates", ScreenValues.renderUrl(load.url, model.context))
    assertEquals(json("""{"hostId":"h1","recordIds":["a","b","c"],"presetId":"box1","policy":"fastest"}"""), ScreenValues.resolveBody(load.body!!, model.context))
  }

  @Test
  fun eachOrderReadsWithItsRateOrWhyItHasNone() {
    val model = review()
    val list = model.block("results")
    fun line(index: Int) = model.row("data.rates.results", index).let { row ->
      listOf("primary", "secondary", "trailing").map { ScreenValues.render(list.string(it)!!, row) }
    }
    assertEquals(listOf("#1001", "UPS Ground", "$8.45"), line(0))
    assertEquals(listOf("#1002", "USPS Priority", "$12.10"), line(1))
    assertEquals(listOf("c", "No rate matches the service rule.", ""), line(2))
  }

  @Test
  fun theTotalLeavesOutLabelsOnTheMerchantsOwnCarrierAccount() {
    val model = review()
    val total = model.block("total").raw.jsonObject["rows"]!!.jsonArray.single().jsonObject
    assertEquals("Total for labels on discounted rates", (total["label"] as JsonPrimitive).content)
    // Order a is on Aglyn's rate ($8.45); order b is on the merchant's own account ($12.10, billed by the carrier); c has no rate.
    assertEquals("$8.45", ScreenValues.render((total["value"] as JsonPrimitive).content, model.context))
    assertTrue("total" in model.shown())
    assertTrue("total" !in review("""{"results":[{"recordId":"c","rate":null,"error":"No rate."}]}""").shown())
    assertEquals("$0.00", ScreenValues.render((total["value"] as JsonPrimitive).content, review("""{"results":[{"recordId":"b","shipmentId":"s","rate":{"rateId":"r","amountCents":500,"merchantCarrierAccount":true}}]}""").context))
  }

  @Test
  fun buyingSendsOnlyTheOrdersThatHaveARateUnderTheRunsKey() {
    val model = review()
    assertEquals(listOf("buy"), model.actionsShown("buy"))
    val buy = model.action("buy", "buy")
    assertEquals(
      json("""{"hostId":"h1","batchKey":"run0123456789","items":[{"recordId":"a","shipmentId":"shp_a","rateId":"rate_a"},{"recordId":"b","shipmentId":"shp_b","rateId":"rate_b"}]}"""),
      model.body(buy),
    )
    assertEquals("/api/shipping/batch/buy", buy.url)
    assertTrue(!buy.reload && buy.back, "the rates are not asked for again once the labels are bought")
    assertTrue(ScreenValues.render(buy.confirm!!, model.context).startsWith("Buy 2 labels?"))
    assertTrue("buy" !in review("""{"results":[{"recordId":"c","rate":null,"error":"No rate."}]}""").shown(), "nothing to buy when no order has a rate")
  }

  @Test
  fun theAnswerCountsTheLabelsBoughtAndNamesWhatWasNot() {
    val buy = review().action("buy", "buy")
    val allBought = json("""{"response":{"results":[{"recordId":"a","label":{"labelUrl":"https://x/a"},"error":null},{"recordId":"b","label":{"labelUrl":"https://x/b"},"error":null}]}}""")
    assertEquals("2 labels bought. Each is on its order, ready to print.", ScreenValues.render(buy.success!!, allBought))
    assertNull(buy.insteadEntry(allBought), "no error, so the plain message shows")
    val partly = json("""{"response":{"results":[{"recordId":"a","label":{"labelUrl":"https://x/a"},"error":null},{"recordId":"b","label":null,"error":"Insufficient funds"}]}}""")
    val entry = assertNotNull(buy.insteadEntry(partly))
    assertEquals("Some labels were not bought", entry.str("title"))
    assertEquals("Insufficient funds", ScreenValues.render(entry.str("text")!!, partly))
    assertEquals("1 label bought. Each is on its order, ready to print.", ScreenValues.render(buy.success!!, partly))
  }
}
