package com.aglyn.hardware

/*
 * A printer-neutral document: what a receipt, a test page or a drawer kick
 * IS, laid out in fixed columns, before any printer's bytes. The console's
 * cloud printers render the same operations (`print-document.ts`), and the
 * register's direct printers render them through [EscPosEncoder], so a
 * receipt is laid out once and every printer prints the same lines.
 *
 * Text operations are one printed LINE each and already fit the paper: the
 * layout wraps and pads here, because a thermal printer's own wrapping breaks
 * mid-word and cannot right-align a price.
 */

enum class PrintAlign { LEFT, CENTER, RIGHT }

sealed interface PrintOp {
  data class Text(
    val text: String,
    val align: PrintAlign = PrintAlign.LEFT,
    val bold: Boolean = false,
    /** 1 = normal; 2 = double width and height. */
    val size: Int = 1,
  ) : PrintOp

  data class Feed(val lines: Int) : PrintOp

  data class Barcode(val data: String) : PrintOp

  /** The logo stored in the printer's memory. */
  data object Logo : PrintOp

  /** The cash drawer kick (`ESC p`), wired through the printer. */
  data object Drawer : PrintOp

  data object Cut : PrintOp
}

data class PrintDocument(
  /** Characters per line at size 1: 48 on 80 mm paper, 32 on 58 mm. */
  val columns: Int,
  val ops: List<PrintOp>,
)

/** Paper widths in characters at the printers' standard font. */
object PaperColumns {
  const val MM80 = 48
  const val MM58 = 32
}

private val SYMBOLS = mapOf(
  '•' to "*",
  '·' to "*",
  '–' to "-",
  '—' to "-",
  '‘' to "'",
  '’' to "'",
  '“' to "\"",
  '”' to "\"",
  '…' to "...",
  ' ' to " ",
  ' ' to " ",
  '€' to "EUR",
  '£' to "GBP",
  '¥' to "JPY",
  '₹' to "INR",
)

/** Decomposes accented letters (`é` → `e` + U+0301), as Unicode NFKD does. */
internal expect fun decompose(value: String): String

/**
 * Text as the printer's built-in ASCII font can print it. Accents are folded
 * (`Crème brûlée` → `Creme brulee`), the punctuation a product name or a
 * money format carries is spelled in ASCII, and anything left becomes `?`
 * rather than the mojibake a raw UTF-8 byte prints as on a code-page printer.
 */
fun toPrintable(value: String?): String {
  val folded = decompose(value ?: "").filterNot { it in '̀'..'ͯ' }
  val out = StringBuilder(folded.length)
  for (char in folded) {
    when {
      char in ' '..'~' -> out.append(char)
      SYMBOLS.containsKey(char) -> out.append(SYMBOLS.getValue(char))
      char.isWhitespace() -> out.append(' ')
      // A surrogate pair is one character on paper: one `?` for the pair.
      char.isLowSurrogate() -> Unit
      else -> out.append('?')
    }
  }
  return out.toString()
}

/** Words wrapped to [width], breaking a word only when it alone is too long. */
fun wrapText(text: String, width: Int): List<String> {
  val lines = mutableListOf<String>()
  var current = ""
  for (word in toPrintable(text).split(Regex("\\s+")).filter { it.isNotEmpty() }) {
    var rest = word
    while (rest.length > width) {
      if (current.isNotEmpty()) {
        lines += current
        current = ""
      }
      lines += rest.substring(0, width)
      rest = rest.substring(width)
    }
    if (rest.isEmpty()) continue
    current = when {
      current.isEmpty() -> rest
      current.length + 1 + rest.length <= width -> "$current $rest"
      else -> {
        lines += current
        rest
      }
    }
  }
  if (current.isNotEmpty()) lines += current
  return lines.ifEmpty { listOf("") }
}

/**
 * A left label and a right amount on one line; a label too long to share the
 * line wraps above, so the amount always lands flush right.
 */
fun twoColumnLines(left: String, right: String, width: Int): List<String> {
  val amount = toPrintable(right)
  val room = maxOf(1, width - amount.length - 1)
  val wrapped = wrapText(left, room).toMutableList()
  val last = wrapped.removeAt(wrapped.lastIndex)
  return wrapped + (last + " ".repeat(maxOf(1, width - last.length - amount.length)) + amount)
}

/**
 * Code128 code set B carries printable ASCII, and a scanner reads a short
 * symbol more reliably than a long one: the data reduced to those characters
 * and capped at 20.
 */
fun code128Printable(value: String?): String = toPrintable(value).filter { it in '!'..'~' }.take(20)

/** A drawer kick with nothing printed: a paid-out, a cash refund, "Open drawer". */
fun drawerKickDocument(columns: Int = PaperColumns.MM80) = PrintDocument(columns, listOf(PrintOp.Drawer))

/**
 * A document as plain text: what the register shows as the receipt preview
 * and what a spec reads a layout by. Size and emphasis do not exist in plain
 * text; alignment is padding; a barcode prints its data between brackets; a
 * drawer kick and a cut print nothing.
 */
fun renderText(document: PrintDocument): String {
  val columns = document.columns
  val lines = mutableListOf<String>()
  for (op in document.ops) {
    when (op) {
      is PrintOp.Text -> {
        val text = toPrintable(op.text).take(columns)
        val gap = columns - text.length
        lines += when (op.align) {
          PrintAlign.CENTER -> (" ".repeat(gap / 2) + text).trimEnd()
          PrintAlign.RIGHT -> " ".repeat(gap) + text
          PrintAlign.LEFT -> text
        }
      }
      is PrintOp.Feed -> repeat(op.lines) { lines += "" }
      is PrintOp.Barcode -> {
        val text = "[${toPrintable(op.data)}]"
        lines += " ".repeat(maxOf(0, (columns - text.length) / 2)) + text
      }
      else -> Unit
    }
  }
  return lines.joinToString("\n") + "\n"
}
