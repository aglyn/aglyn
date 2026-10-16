package com.aglyn.plugins.commerce.products

import com.aglyn.contracts.ProductLabel
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Product labels and their barcodes replay the console's own answers (`product-labels.ts`, `barcode-encode.ts`) from
 * `functionCases` in libs/native/contracts/function-cases.generated.json; the Apple plugin replays the same file.
 */
class ProductLabelsTest {
  private val functions = Json.parseToJsonElement(File("../../../../native/contracts/function-cases.generated.json").readText())
    .jsonObject.getValue("functions").jsonObject

  private fun cases(name: String) = functions.getValue(name).jsonObject.getValue("cases").jsonArray.map { it.jsonObject }
    .also { assertTrue(it.isNotEmpty(), name) }

  private fun text(element: JsonElement?): String? = (element as? JsonPrimitive)?.takeIf { it !is JsonNull }?.let {
    if (it.isString) it.content else it.doubleOrNull?.toLong()?.toString()
  }

  private fun number(element: JsonElement?): Double? = (element as? JsonPrimitive)?.takeIf { it !is JsonNull && !it.isString }?.doubleOrNull

  /** A stored document as the Firestore reader hands it over: plain maps, lists, strings, numbers and booleans. */
  private fun plain(element: JsonElement): Any? = when (element) {
    is JsonNull -> null
    is JsonObject -> element.mapValues { plain(it.value) }
    is JsonArray -> element.map(::plain)
    is JsonPrimitive -> if (element.isString) element.content else element.booleanOrNull ?: element.doubleOrNull
  }

  private fun label(json: JsonElement): ProductLabel {
    val o = json.jsonObject
    return ProductLabel(
      code = text(o["code"]).orEmpty(),
      copies = number(o["copies"])?.toLong() ?: 0,
      currency = text(o["currency"]),
      detail = text(o["detail"]),
      name = text(o["name"]).orEmpty(),
      priceCents = number(o["priceCents"])?.toLong(),
    )
  }

  @Test
  fun encodesEachBarcodeAsTheConsoleDoes() {
    for (case in cases("encodeBarcode")) {
      val arg = text(case.getValue("args").jsonArray[0])
      val result = case.getValue("result")
      val encoded = encodeBarcode(arg)
      if (result is JsonNull) {
        assertNull(encoded, "$arg")
        continue
      }
      assertEquals(text(result.jsonObject["format"]), encoded?.format?.raw, "$arg")
      assertEquals(text(result.jsonObject["text"]), encoded?.text, "$arg")
      assertEquals(text(result.jsonObject["modules"]), encoded?.modules, "$arg")
    }
  }

  @Test
  fun buildsAProductsLabelRows() {
    for (case in cases("productLabelRows")) {
      @Suppress("UNCHECKED_CAST")
      val rows = productLabelRows(plain(case.getValue("args").jsonArray[0]) as Map<String, Any?>)
      val expected = case.getValue("result").jsonArray
      assertEquals(expected.map { text(it.jsonObject["variantId"]) }, rows.map { it.variantId })
      assertEquals(expected.map(::label), rows.map { it.label })
    }
  }

  @Test
  fun writesTheZplAZebraPrints() {
    for (case in cases("productLabelsZpl")) {
      val args = case.getValue("args").jsonArray
      val zpl = productLabelsZpl(args[0].jsonArray.map(::label), args.getOrNull(1)?.let(::text), args.getOrNull(2)?.let(::number)?.toInt() ?: 203)
      assertEquals(text(case.getValue("result")), zpl, "${args.size}")
    }
  }

  @Test
  fun countsCopiesAndPricesAsTheDialogDoes() {
    for (case in cases("labelCopiesFromInput")) {
      val arg = case.getValue("args").jsonArray[0]
      val copies = when {
        arg is JsonPrimitive && arg.isString -> labelCopiesFromInput(arg.content)
        else -> labelCopiesFromInput(number(arg) ?: 0.0)
      }
      assertEquals(number(case.getValue("result"))?.toLong(), copies, "$arg")
    }
    for (case in cases("labelCopiesTotal")) {
      assertEquals(number(case.getValue("result"))?.toLong(), labelCopiesTotal(case.getValue("args").jsonArray[0].jsonArray.map(::label)))
    }
    for (case in cases("labelPriceText")) {
      val arg = case.getValue("args").jsonArray[0].jsonObject
      assertEquals(text(case.getValue("result")), labelPriceText(number(arg["priceCents"]), text(arg["currency"])), "$arg")
    }
    for (case in cases("labelSize")) {
      assertEquals(text(case.getValue("result").jsonObject["id"]), labelSize(text(case.getValue("args").jsonArray[0])).id)
    }
    for (case in cases("labelsZplFileName")) {
      assertEquals(text(case.getValue("result")), labelsZplFileName(text(case.getValue("args").jsonArray[0])))
    }
  }

  @Test
  fun theSheetPrintsEachCopyOnItsOwnPageAtTheLabelsSize() {
    val sheet = labelSheet(
      listOf(
        ProductLabel(code = "4006381333931", copies = 2, currency = "usd", detail = "Blue", name = "Mug", priceCents = 1250),
        ProductLabel(code = "", copies = 3, name = "No code"),
        ProductLabel(code = "SKU-1", copies = 0, name = "None"),
      ),
      "2x1",
    )
    assertEquals(144.0, sheet.widthPoints)
    assertEquals(72.0, sheet.heightPoints)
    assertEquals(2, sheet.labels.size)
    assertEquals("$12.50", sheet.labels[0].price)
    assertEquals("4006381333931", sheet.labels[0].code)
    assertEquals(encodeBarcode("4006381333931")?.modules, sheet.labels[0].bars)
  }

  @Test
  fun theImportOpensTheHubForThisSitesProducts() {
    assertEquals(mapOf("resource" to "commerce.products", "title" to "Import products", "hostId" to "h1"), productsImportParams("h1"))
    assertEquals("core.settings.data.import", CORE_DATA_IMPORT_SCREEN)
  }
}
