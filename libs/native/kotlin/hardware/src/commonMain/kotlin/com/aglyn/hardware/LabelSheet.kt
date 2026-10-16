package com.aglyn.hardware

/*
 * PRODUCT LABELS, DRAWN HERE. The console prints its label sheet as a page of
 * markup (`productLabelsHtml` in the commerce plugin's
 * `printing/product-labels.ts`): one label per page, the page sized to the
 * label, the name, the options, the price, the barcode's bars and its digits.
 * The apps draw the same label on the print sheet's own pages, with the same
 * measurements, so a label printer prints it at 100% scale as it prints the
 * console's. The Apple kit's `LabelSheet.swift` draws it the same way.
 */

/** One label: what the console's label page prints for a variant. */
data class PrintLabel(
  val name: String,
  /** A variant's options, e.g. `Large / Blue`. */
  val detail: String? = null,
  /** The price line, already formatted. */
  val price: String? = null,
  /** The barcode as modules, `1` a bar and `0` a space, without its quiet zone. */
  val bars: String? = null,
  /** What is printed under the bars. */
  val code: String? = null,
)

/** Labels of one size, one label to a page; each copy is its own page. */
data class LabelSheet(val widthPoints: Double, val heightPoints: Double, val labels: List<PrintLabel>)

/** The label page's measurements, in points: the console's CSS for `.label` and its parts. */
object LabelMetrics {
  /** `padding: 0.06in 0.08in`. */
  const val PADDING_Y = 0.06 * 72
  const val PADDING_X = 0.08 * 72

  /** `.name`: 9pt bold, line-height 1.1, at most two lines. */
  const val NAME_SIZE = 9.0
  const val NAME_LINE_HEIGHT = 9.0 * 1.1
  const val NAME_MAX_LINES = 2

  /** `.detail`: 7pt, line-height 1.1, one line. */
  const val DETAIL_SIZE = 7.0
  const val DETAIL_LINE_HEIGHT = 7.0 * 1.1

  /** `.price`: 11pt bold, line-height 1.2. */
  const val PRICE_SIZE = 11.0
  const val PRICE_LINE_HEIGHT = 11.0 * 1.2

  /** `.bars`: what is left, at least 0.3in. */
  const val BARS_MIN_HEIGHT = 0.3 * 72

  /** `.code`: 7pt, centered, the font's normal line height. */
  const val CODE_SIZE = 7.0
  const val CODE_LINE_HEIGHT = 7.0 * 1.15

  /** `barcodeSvg`'s quiet zone: ten modules a side. */
  const val QUIET_MODULES = 10
}

/** A rectangle in points, top-left origin. */
data class LabelRect(val x: Double, val y: Double, val width: Double, val height: Double) {
  val bottom: Double get() = y + height
}

/** Where each part of a label goes on its page. */
data class LabelLayout(
  val name: LabelRect,
  val detail: LabelRect? = null,
  val price: LabelRect? = null,
  val bars: LabelRect? = null,
  val code: LabelRect? = null,
)

/**
 * Lays a label out on a page of [width] × [height] points, the name taking [nameLines] lines (one or two), as the
 * console's flex column does: the name, the options, the price, then the bars filling what is left (never under 0.3in),
 * the digits under them.
 */
fun layoutLabel(width: Double, height: Double, nameLines: Int, hasDetail: Boolean, hasPrice: Boolean, hasBars: Boolean): LabelLayout {
  val x = LabelMetrics.PADDING_X
  val inner = maxOf(0.0, width - 2 * LabelMetrics.PADDING_X)
  var y = LabelMetrics.PADDING_Y
  val lines = nameLines.coerceIn(1, LabelMetrics.NAME_MAX_LINES)
  val name = LabelRect(x, y, inner, lines * LabelMetrics.NAME_LINE_HEIGHT)
  y += name.height
  val detail = if (hasDetail) LabelRect(x, y, inner, LabelMetrics.DETAIL_LINE_HEIGHT).also { y += it.height } else null
  val price = if (hasPrice) LabelRect(x, y, inner, LabelMetrics.PRICE_LINE_HEIGHT).also { y += it.height } else null
  if (!hasBars) return LabelLayout(name, detail, price)
  val bottom = height - LabelMetrics.PADDING_Y - LabelMetrics.CODE_LINE_HEIGHT
  val bars = LabelRect(x, y, inner, maxOf(LabelMetrics.BARS_MIN_HEIGHT, bottom - y))
  return LabelLayout(name, detail, price, bars, LabelRect(x, bars.bottom, inner, LabelMetrics.CODE_LINE_HEIGHT))
}

/**
 * The bars of [modules] across [rect], the quiet zone either side included in the width as the console's SVG does: one
 * rect per run of bars, ready to fill.
 */
fun barRects(modules: String, rect: LabelRect): List<LabelRect> {
  val units = modules.length + LabelMetrics.QUIET_MODULES * 2
  if (units <= 0 || rect.width <= 0) return emptyList()
  val module = rect.width / units
  val out = mutableListOf<LabelRect>()
  var index = 0
  while (index < modules.length) {
    if (modules[index] != '1') {
      index += 1
      continue
    }
    var run = 1
    while (index + run < modules.length && modules[index + run] == '1') run += 1
    out += LabelRect(rect.x + (index + LabelMetrics.QUIET_MODULES) * module, rect.y, run * module, rect.height)
    index += run
  }
  return out
}

/**
 * Words wrapped to lines that [fits] says fit, breaking a word only when it alone does not: how a label's name falls
 * onto its two lines.
 */
fun wrapToWidth(text: String, fits: (String) -> Boolean): List<String> {
  val lines = mutableListOf<String>()
  var current = ""
  for (word in text.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }) {
    val joined = if (current.isEmpty()) word else "$current $word"
    if (fits(joined)) {
      current = joined
      continue
    }
    if (current.isNotEmpty()) lines += current
    var rest = word
    while (rest.length > 1 && !fits(rest)) {
      var cut = rest.length - 1
      while (cut > 1 && !fits(rest.substring(0, cut))) cut -= 1
      lines += rest.substring(0, cut)
      rest = rest.substring(cut)
    }
    current = rest
  }
  if (current.isNotEmpty()) lines += current
  return lines
}

/** [text] cut to what [fits] allows, an ellipsis marking the cut, as CSS's `text-overflow: ellipsis`. */
fun ellipsize(text: String, fits: (String) -> Boolean): String {
  if (fits(text)) return text
  var end = text.length
  while (end > 0 && !fits(text.substring(0, end).trimEnd() + "…")) end -= 1
  return if (end == 0) "" else text.substring(0, end).trimEnd() + "…"
}

/**
 * Draws a label through [canvas], whichever platform's drawing it wraps (Android's `Canvas`, AWT's `Graphics2D`), so
 * both lay the label out with the same code. [origin] is the page's top-left.
 */
interface LabelCanvas {
  /** The width of [text] at [size] points. */
  fun measure(text: String, size: Double, bold: Boolean): Double

  /** Draws [text] with its baseline at [baseline], starting at [x]. */
  fun text(text: String, x: Double, baseline: Double, size: Double, bold: Boolean)

  fun fill(rect: LabelRect)
}

fun drawLabel(label: PrintLabel, width: Double, height: Double, originX: Double, originY: Double, canvas: LabelCanvas) {
  val inner = maxOf(0.0, width - 2 * LabelMetrics.PADDING_X)
  val nameLines = wrapToWidth(label.name) { canvas.measure(it, LabelMetrics.NAME_SIZE, true) <= inner }
  val bars = label.bars?.takeIf { it.contains('1') }
  val layout = layoutLabel(width, height, nameLines.size, !label.detail.isNullOrEmpty(), !label.price.isNullOrEmpty(), bars != null)
  // A line's text sits at about 80% of its line box, as a browser centers the font's ascent in it.
  fun baseline(top: Double, lineHeight: Double, size: Double) = originY + top + (lineHeight - size) / 2 + size * 0.8
  // Two lines at most; the rest is cut off, as the console's `max-height: 2.2em; overflow: hidden`.
  nameLines.take(LabelMetrics.NAME_MAX_LINES).forEachIndexed { index, line ->
    canvas.text(line, originX + layout.name.x, baseline(layout.name.y + index * LabelMetrics.NAME_LINE_HEIGHT, LabelMetrics.NAME_LINE_HEIGHT, LabelMetrics.NAME_SIZE), LabelMetrics.NAME_SIZE, true)
  }
  layout.detail?.let { rect ->
    val shown = ellipsize(label.detail.orEmpty()) { canvas.measure(it, LabelMetrics.DETAIL_SIZE, false) <= inner }
    canvas.text(shown, originX + rect.x, baseline(rect.y, rect.height, LabelMetrics.DETAIL_SIZE), LabelMetrics.DETAIL_SIZE, false)
  }
  layout.price?.let { rect ->
    canvas.text(label.price.orEmpty(), originX + rect.x, baseline(rect.y, rect.height, LabelMetrics.PRICE_SIZE), LabelMetrics.PRICE_SIZE, true)
  }
  if (bars != null) {
    layout.bars?.let { rect -> barRects(bars, rect.copy(x = originX + rect.x, y = originY + rect.y)).forEach(canvas::fill) }
  }
  layout.code?.let { rect ->
    val code = label.code.orEmpty()
    val textWidth = canvas.measure(code, LabelMetrics.CODE_SIZE, false)
    canvas.text(code, originX + rect.x + maxOf(0.0, (rect.width - textWidth) / 2), baseline(rect.y, rect.height, LabelMetrics.CODE_SIZE), LabelMetrics.CODE_SIZE, false)
  }
}
