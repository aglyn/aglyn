package com.aglyn.plugins.commerce.products

import com.aglyn.contracts.Contracts
import com.aglyn.contracts.EncodedBarcode
import com.aglyn.contracts.EncodedFormat
import com.aglyn.contracts.LabelSize
import com.aglyn.contracts.ProductLabel
import com.aglyn.contracts.formatReceiptMoney
import com.aglyn.hardware.LabelSheet
import com.aglyn.hardware.PrintLabel
import com.aglyn.hardware.toPrintable
import com.aglyn.plugins.commerce.pos.jsRound
import kotlin.math.floor

/*
 * PRODUCT LABELS (the products list's "Labels", AGL-3619 on the console): a
 * label per variant with its name, options, price and a barcode the register
 * scans back, printed on the device's print sheet or saved as ZPL for a
 * Zebra. The console's `printing/product-labels.ts` and
 * `barcode/barcode-encode.ts`, ported once; ProductLabelsTest replays their
 * answers from function-cases.generated.json, and the Apple plugin's
 * ProductLabels.swift replays the same file. The sizes, the copy limit and
 * the Code 128 table are the console's own values (ContractValues).
 */

private val EAN_L = listOf("0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011")
private val EAN_G = EAN_L.map { code -> code.map { if (it == '1') '0' else '1' }.reversed().joinToString("") }
private val EAN_R = EAN_L.map { code -> code.map { if (it == '1') '0' else '1' }.joinToString("") }
private val EAN_PARITY = listOf("LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL")

/** Only the ASCII digits `0`–`9`, as JavaScript's `\d`. */
private fun isAsciiDigits(value: String) = value.isNotEmpty() && value.all { it in '0'..'9' }

/** Whether an EAN/UPC's last digit is its check digit (`eanCheckDigitValid`). */
fun eanCheckDigitValid(code: String): Boolean {
  if (!isAsciiDigits(code)) return false
  val body = code.dropLast(1)
  var sum = 0
  body.forEachIndexed { index, char ->
    // Weights run 3,1,3,1… from the digit nearest the check digit.
    val fromRight = body.length - 1 - index
    sum += (char - '0') * (if (fromRight % 2 == 0) 3 else 1)
  }
  return (10 - sum % 10) % 10 == code.last() - '0'
}

private fun ean13(code: String): String {
  val parity = EAN_PARITY[code[0] - '0']
  val out = StringBuilder("101")
  for (index in 1..6) out.append((if (parity[index - 1] == 'L') EAN_L else EAN_G)[code[index] - '0'])
  out.append("01010")
  for (index in 7..12) out.append(EAN_R[code[index] - '0'])
  return out.append("101").toString()
}

private fun ean8(code: String): String {
  val out = StringBuilder("101")
  for (index in 0 until 4) out.append(EAN_L[code[index] - '0'])
  out.append("01010")
  for (index in 4 until 8) out.append(EAN_R[code[index] - '0'])
  return out.append("101").toString()
}

private fun widthsToModules(widths: List<Int>) = widths.mapIndexed { index, width -> (if (index % 2 == 1) "0" else "1").repeat(width) }.joinToString("")

/** Code 128: set C for an even run of digits (half as wide), set B otherwise. */
private fun code128(text: String): String {
  val patterns = Contracts.code128Patterns.map { row -> row.map { it.toInt() } }
  val numeric = isAsciiDigits(text) && text.length % 2 == 0 && text.length >= 4
  val values = mutableListOf(if (numeric) 105 else 104)
  if (numeric) {
    for (index in text.indices step 2) values += (text[index] - '0') * 10 + (text[index + 1] - '0')
  } else {
    for (char in text) values += char.code - 32
  }
  val checksum = values.foldIndexed(0) { index, sum, value -> sum + value * maxOf(1, index) } % 103
  values += listOf(checksum, 106)
  return values.joinToString("") { widthsToModules(patterns[it]) }
}

/**
 * The barcode a value prints as, or null when it has nothing printable (`encodeBarcode`). A valid EAN-13, UPC-A or
 * EAN-8 prints as itself; anything else (a SKU, an internal code) as Code 128, cut to what a 2-inch label still scans.
 */
fun encodeBarcode(raw: String?): EncodedBarcode? {
  val value = raw.orEmpty().trim()
  if (value.isEmpty()) return null
  if (isAsciiDigits(value) && eanCheckDigitValid(value)) {
    when (value.length) {
      13 -> return EncodedBarcode(EncodedFormat.EAN_13, ean13(value), value)
      // UPC-A is EAN-13 with a leading zero; the bars are identical.
      12 -> return EncodedBarcode(EncodedFormat.UPC_A, ean13("0$value"), value)
      8 -> return EncodedBarcode(EncodedFormat.EAN_8, ean8(value), value)
    }
  }
  val printable = value.filter { it.code in 0x20..0x7e }.take(Contracts.labelCodeMaxLength.toInt())
  if (printable.isEmpty()) return null
  return EncodedBarcode(EncodedFormat.CODE_128, code128(printable), printable)
}

/** A label the products list prints for one variant (`ProductLabelRow`). */
data class ProductLabelRow(val variantId: String, val label: ProductLabel)

/** JavaScript's `Number(value)` over a stored value: [present] false is `undefined` (NaN), null is 0. */
private fun jsNumber(value: Any?, present: Boolean): Double = when {
  !present -> Double.NaN
  value == null -> 0.0
  value is Number -> value.toDouble()
  value is Boolean -> if (value) 1.0 else 0.0
  value is String -> value.trim().let { if (it.isEmpty()) 0.0 else it.toDoubleOrNull() ?: Double.NaN }
  else -> Double.NaN
}

/** A value as a template literal prints it, null for a falsy one. */
private fun truthyText(value: Any?): String? = when (value) {
  is String -> value.ifEmpty { null }
  is Number -> value.toDouble().takeIf { it != 0.0 && it.isFinite() }?.let { if (it == floor(it) && kotlin.math.abs(it) < 1e15) it.toLong().toString() else it.toString() }
  true -> "true"
  else -> null
}

/**
 * The labels a product prints (`productLabelRows`): one row per variant, its options as the detail (in key order, as
 * Firestore reads a map), its price and the code the register looks up, the barcode or else the SKU.
 */
fun productLabelRows(product: Map<String, Any?>): List<ProductLabelRow> {
  val name = product["name"] as? String ?: ""
  return (product["variants"] as? List<*>).orEmpty().map { raw ->
    val variant = (raw as? Map<*, *>).orEmpty()
    val options = (variant["options"] as? Map<*, *>).orEmpty().entries
      .sortedBy { it.key.toString() }.mapNotNull { truthyText(it.value) }
    val price = jsNumber(variant["priceUsd"], variant.containsKey("priceUsd"))
    val code = (truthyText(variant["barcode"]) ?: truthyText(variant["sku"]) ?: "").trim()
    ProductLabelRow(
      variantId = variant["id"] as? String ?: "",
      label = ProductLabel(
        code = code,
        copies = 1,
        currency = "usd",
        detail = options.takeIf { it.isNotEmpty() }?.joinToString(" / "),
        name = name,
        priceCents = if (price.isFinite()) jsRound(price * 100) else null,
      ),
    )
  }
}

/** A copy count kept whole, at least 0 and at most the console's limit (`labelCopiesFromInput`). */
fun labelCopiesFromInput(value: Double): Long =
  if (value.isNaN()) 0 else floor(value).coerceIn(0.0, Contracts.maxLabelCopies.toDouble()).toLong()

/** A typed copy count: what JavaScript's `Number` reads in it. */
fun labelCopiesFromInput(text: String): Long = labelCopiesFromInput(jsNumber(text, true))

private fun copiesOf(label: ProductLabel) = labelCopiesFromInput(label.copies.toDouble())

/** The rows that print: a code and at least one copy (`printableLabelRows`). */
fun printableLabels(labels: List<ProductLabel>) = labels.filter { it.code.isNotEmpty() && copiesOf(it) > 0 }

/** How many labels print in all (`labelCopiesTotal`). */
fun labelCopiesTotal(labels: List<ProductLabel>): Long = printableLabels(labels).sumOf { copiesOf(it) }

/** The label's price line, empty without a price (`labelPriceText`). */
fun labelPriceText(priceCents: Double?, currency: String?): String =
  if (priceCents == null || !priceCents.isFinite()) "" else formatReceiptMoney(jsRound(priceCents).toDouble(), currency ?: "usd")

/** The size picked, or the first (`labelSize`). */
fun labelSize(id: String?): LabelSize = Contracts.labelSizes.let { sizes -> sizes.firstOrNull { it.id == id } ?: sizes.first() }

/** The ZPL file's name (`labelsZplFileName`). */
fun labelsZplFileName(productName: String?): String =
  "labels-${(productName ?: "product").replace(Regex("[^A-Za-z0-9]+"), "-").lowercase()}.zpl"

/** The label sheet the print sheet prints: each printable row, once per copy, drawn as the console's label page. */
fun labelSheet(labels: List<ProductLabel>, sizeId: String?): LabelSheet {
  val size = labelSize(sizeId)
  val pages = printableLabels(labels).flatMap { label ->
    val encoded = encodeBarcode(label.code)
    val price = labelPriceText(label.priceCents?.toDouble(), label.currency)
    val page = PrintLabel(label.name, label.detail, price.ifEmpty { null }, encoded?.modules, encoded?.text)
    List(copiesOf(label).toInt()) { page }
  }
  return LabelSheet(size.widthIn * 72, size.heightIn * 72, pages)
}

/**
 * Field text for ZPL (`zplText`): `^FH` makes `_` the escape, so `^`, `~` and `_` are written as hex, and the rest is
 * folded to the printer's ASCII font.
 */
fun zplText(value: String?): String = toPrintable(value).replace(Regex("[_^~]")) { "_" + it.value[0].code.toString(16).uppercase() }

private fun zplBarcode(encoded: EncodedBarcode, x: Long, y: Long, height: Long, moduleDots: Int): String {
  val at = "^FO$x,$y^BY$moduleDots"
  return when (encoded.format) {
    // ZPL takes the 12 data digits and adds the check digit itself.
    EncodedFormat.EAN_13 -> "$at^BEN,$height,Y,N^FD${encoded.text.take(12)}^FS"
    EncodedFormat.UPC_A -> "$at^BUN,$height,Y,N,Y^FD${encoded.text.take(11)}^FS"
    EncodedFormat.EAN_8 -> "$at^B8N,$height,Y,N^FD${encoded.text.take(7)}^FS"
    // Mode A: the printer picks sets B and C itself, as the page does.
    else -> "$at^BCN,$height,Y,N,N,A^FH^FD${zplText(encoded.text)}^FS"
  }
}

/** The labels as ZPL for a Zebra (`productLabelsZpl`): one format per label, its copies as the print quantity. */
fun productLabelsZpl(labels: List<ProductLabel>, sizeId: String? = null, dpi: Int = 203): String {
  val size = labelSize(sizeId)
  val dots = dpi.toDouble()
  val width = jsRound(size.widthIn * dots)
  val height = jsRound(size.heightIn * dots)
  val margin = jsRound(0.08 * dots)
  val font = jsRound(dots / 9)
  val small = jsRound(dots / 12)
  val moduleDots = if (dpi >= 300) 3 else 2
  return labels.mapNotNull { label ->
    val copies = copiesOf(label)
    if (copies == 0L) return@mapNotNull null
    val encoded = encodeBarcode(label.code)
    var y = margin
    val fields = StringBuilder()
    fields.append("^FO$margin,$y^A0N,$font,$font^FB${width - margin * 2},2,0,L^FH^FD${zplText(label.name)}^FS")
    y += font * 2 + 2
    if (!label.detail.isNullOrEmpty()) {
      fields.append("^FO$margin,$y^A0N,$small,$small^FB${width - margin * 2},1,0,L^FH^FD${zplText(label.detail)}^FS")
      y += small + 2
    }
    val price = labelPriceText(label.priceCents?.toDouble(), label.currency)
    if (price.isNotEmpty()) {
      fields.append("^FO$margin,$y^A0N,$font,$font^FH^FD${zplText(price)}^FS")
      y += font + 4
    }
    if (encoded != null) {
      // What is left of the label, less the printed digits under the bars.
      val barHeight = maxOf(jsRound(dots * 0.2), height - y - margin - small - 4)
      fields.append(zplBarcode(encoded, margin, y, barHeight, moduleDots))
    }
    "^XA^CI0^PW$width^LL$height^LH0,0$fields^PQ$copies,0,1,Y^XZ"
  }.joinToString("\n")
}
