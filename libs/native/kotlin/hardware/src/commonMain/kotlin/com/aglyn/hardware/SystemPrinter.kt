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

interface SystemPrinter {
  /** Sends [text], monospaced, to the system's print sheet and waits for the person's answer. */
  suspend fun printText(text: String, jobName: String): SystemPrintResult
}

/** The receipt's lines cut into pages that each hold [linesPerPage], at least one page. */
fun printPages(text: String, linesPerPage: Int): List<List<String>> {
  val lines = text.trimEnd('\n').split('\n')
  return lines.chunked(maxOf(1, linesPerPage)).ifEmpty { listOf(emptyList()) }
}

/** The font size that fits [columns] monospaced characters across [widthPoints], within the readable range. */
fun printFontSize(widthPoints: Float, columns: Int, min: Float = 5f, max: Float = 10f): Float =
  (widthPoints / (columns * 0.6f)).coerceIn(min, max)
