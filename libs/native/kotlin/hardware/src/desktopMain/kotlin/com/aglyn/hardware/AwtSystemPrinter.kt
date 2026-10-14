package com.aglyn.hardware

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.awt.Font
import java.awt.Graphics2D
import java.awt.GraphicsEnvironment
import java.awt.print.Printable
import java.awt.print.PrinterException
import java.awt.print.PrinterJob

/**
 * The desktop's print dialog as the register's: the receipt is a monospaced text page handed to Java's
 * [PrinterJob], whose own dialog lets the person pick a printer.
 */
class AwtSystemPrinter : SystemPrinter {
  override suspend fun printText(text: String, jobName: String): SystemPrintResult = withContext(Dispatchers.IO) {
    if (GraphicsEnvironment.isHeadless()) return@withContext SystemPrintResult.Failed("Printing is not available on this device.")
    try {
      val lines = text.trimEnd('\n').split('\n')
      val columns = lines.maxOfOrNull { it.length }?.coerceAtLeast(1) ?: 1
      val job = PrinterJob.getPrinterJob()
      job.jobName = jobName
      job.setPrintable { graphics, format, pageIndex ->
        val size = printFontSize(format.imageableWidth.toFloat(), columns)
        val lineHeight = size * 1.25f
        val perPage = maxOf(1, (format.imageableHeight / lineHeight).toInt())
        val pages = printPages(lines.joinToString("\n"), perPage)
        if (pageIndex >= pages.size) return@setPrintable Printable.NO_SUCH_PAGE
        val canvas = graphics as Graphics2D
        canvas.font = Font(Font.MONOSPACED, Font.PLAIN, 1).deriveFont(size)
        pages[pageIndex].forEachIndexed { row, line ->
          canvas.drawString(line, format.imageableX.toFloat(), (format.imageableY + size + row * lineHeight).toFloat())
        }
        Printable.PAGE_EXISTS
      }
      if (!job.printDialog()) return@withContext SystemPrintResult.Canceled
      job.print()
      SystemPrintResult.Printed
    } catch (error: PrinterException) {
      SystemPrintResult.Failed(error.message ?: "The receipt did not print.")
    }
  }
}
