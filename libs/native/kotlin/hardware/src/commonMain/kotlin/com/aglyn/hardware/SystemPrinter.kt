package com.aglyn.hardware

/*
 * THE DEVICE'S OWN PRINT DIALOG. The console prints a receipt that has no cloud
 * printer through the browser's print dialog (`window.print()` from a hidden
 * frame, `pos-receipt.ts`): the page goes to whatever printers the computer
 * knows. This is that, on the device: Android's print service on a phone or a
 * tablet, the desktop's print dialog on a computer. No printer driver and no
 * SDK ship in the app; the person picks the printer in the system's own sheet.
 */

sealed interface SystemPrintResult {
  /** The job was handed to the print service (or printed). */
  data object Printed : SystemPrintResult

  /** The person closed the print sheet. */
  data object Canceled : SystemPrintResult

  data class Failed(val message: String) : SystemPrintResult
}

/** What the print sheet prints besides a receipt's text. */
sealed interface PrintableDocument {
  /**
   * A page of markup the console prints from a popup: the packing slip and the invoice. Tables, headings and text, no
   * script and no style sheet, which every platform's own HTML printing lays out.
   */
  data class Html(val html: String) : PrintableDocument

  /** A PDF made elsewhere: a carrier's shipping label. */
  class Pdf(val bytes: ByteArray) : PrintableDocument

  /** Product labels, one label to a page sized to the label. */
  data class Labels(val sheet: LabelSheet) : PrintableDocument
}

interface SystemPrinter {
  /** Sends [text], monospaced, to the system's print sheet and waits for the person's answer. */
  suspend fun printText(text: String, jobName: String): SystemPrintResult

  /** Sends [document] to the system's print sheet: the console's `window.print()` of the same page. */
  suspend fun printDocument(document: PrintableDocument, jobName: String): SystemPrintResult =
    SystemPrintResult.Failed("This device cannot print that.")
}

/** Whether [bytes] are a PDF (`%PDF`). */
fun isPdf(bytes: ByteArray): Boolean =
  bytes.size >= 4 && bytes[0] == '%'.code.toByte() && bytes[1] == 'P'.code.toByte() && bytes[2] == 'D'.code.toByte() && bytes[3] == 'F'.code.toByte()

/** The receipt's lines cut into pages that each hold [linesPerPage], at least one page. */
fun printPages(text: String, linesPerPage: Int): List<List<String>> {
  val lines = text.trimEnd('\n').split('\n')
  return lines.chunked(maxOf(1, linesPerPage)).ifEmpty { listOf(emptyList()) }
}

/** The font size that fits [columns] monospaced characters across [widthPoints], within the readable range. */
fun printFontSize(widthPoints: Float, columns: Int, min: Float = 5f, max: Float = 10f): Float =
  (widthPoints / (columns * 0.6f)).coerceIn(min, max)
