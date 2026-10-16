package com.aglyn.hardware

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.awt.Color
import java.awt.Desktop
import java.awt.Font
import java.awt.Graphics2D
import java.awt.GraphicsEnvironment
import java.awt.RenderingHints
import java.awt.geom.Rectangle2D
import java.awt.print.PageFormat
import java.awt.print.Paper
import java.awt.print.Printable
import java.awt.print.PrinterException
import java.awt.print.PrinterJob
import java.io.ByteArrayInputStream
import java.io.File
import javax.print.DocFlavor
import javax.print.PrintException
import javax.print.PrintServiceLookup
import javax.print.ServiceUI
import javax.print.SimpleDoc
import javax.print.attribute.HashPrintRequestAttributeSet
import javax.print.attribute.standard.JobName
import javax.swing.JEditorPane

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

  override suspend fun printDocument(document: PrintableDocument, jobName: String): SystemPrintResult = withContext(Dispatchers.IO) {
    if (GraphicsEnvironment.isHeadless()) return@withContext SystemPrintResult.Failed("Printing is not available on this device.")
    try {
      when (document) {
        is PrintableDocument.Html -> printHtml(document.html, jobName)
        is PrintableDocument.Pdf -> printPdf(document.bytes, jobName)
        is PrintableDocument.Labels -> printLabels(document.sheet, jobName)
      }
    } catch (error: PrinterException) {
      SystemPrintResult.Failed(error.message ?: "The page did not print.")
    } catch (error: PrintException) {
      SystemPrintResult.Failed(error.message ?: "The page did not print.")
    }
  }

  /** Swing's HTML view lays the page out (tables, headings and text, as the console's page uses) and prints it. */
  private fun printHtml(html: String, jobName: String): SystemPrintResult {
    val pane = JEditorPane("text/html", html)
    pane.isEditable = false
    val attributes = HashPrintRequestAttributeSet().apply { add(JobName(jobName, null)) }
    return if (pane.print(null, null, true, null, attributes, false)) SystemPrintResult.Printed else SystemPrintResult.Canceled
  }

  /**
   * A printer that takes PDF is offered in the print dialog; with none (most Windows drivers), the label opens in the
   * computer's PDF viewer, whose own Print prints it, as the console's link opens it in a tab.
   */
  private fun printPdf(bytes: ByteArray, jobName: String): SystemPrintResult {
    val flavor = DocFlavor.INPUT_STREAM.PDF
    val services = PrintServiceLookup.lookupPrintServices(flavor, null)
    if (services.isNotEmpty()) {
      val attributes = HashPrintRequestAttributeSet().apply { add(JobName(jobName, null)) }
      val preferred = PrintServiceLookup.lookupDefaultPrintService()?.takeIf { it in services } ?: services.first()
      val chosen = ServiceUI.printDialog(null, 120, 120, services, preferred, flavor, attributes) ?: return SystemPrintResult.Canceled
      chosen.createPrintJob().print(SimpleDoc(ByteArrayInputStream(bytes), flavor, null), attributes)
      return SystemPrintResult.Printed
    }
    if (!Desktop.isDesktopSupported() || !Desktop.getDesktop().isSupported(Desktop.Action.OPEN)) {
      return SystemPrintResult.Failed("No printer here takes a PDF, and no PDF viewer is set up.")
    }
    val file = File.createTempFile(jobName.replace(Regex("[^A-Za-z0-9]+"), "-").trim('-').ifEmpty { "label" } + "-", ".pdf")
    file.deleteOnExit()
    file.writeBytes(bytes)
    Desktop.getDesktop().open(file)
    return SystemPrintResult.Printed
  }

  /** Each label on a page the size of the label, drawn as the console's label page. */
  private fun printLabels(sheet: LabelSheet, jobName: String): SystemPrintResult {
    if (sheet.labels.isEmpty()) return SystemPrintResult.Failed("There are no labels to print.")
    val job = PrinterJob.getPrinterJob()
    job.jobName = jobName
    val format = job.defaultPage().apply {
      orientation = PageFormat.PORTRAIT
      paper = Paper().apply {
        setSize(sheet.widthPoints, sheet.heightPoints)
        setImageableArea(0.0, 0.0, sheet.widthPoints, sheet.heightPoints)
      }
    }
    job.setPrintable({ graphics, _, pageIndex ->
      val label = sheet.labels.getOrNull(pageIndex) ?: return@setPrintable Printable.NO_SUCH_PAGE
      val canvas = graphics as Graphics2D
      canvas.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON)
      canvas.color = Color.BLACK
      canvas.clip(Rectangle2D.Double(0.0, 0.0, sheet.widthPoints, sheet.heightPoints))
      drawLabel(label, sheet.widthPoints, sheet.heightPoints, 0.0, 0.0, AwtLabelCanvas(canvas))
      Printable.PAGE_EXISTS
    }, format)
    if (!job.printDialog()) return SystemPrintResult.Canceled
    job.print()
    return SystemPrintResult.Printed
  }
}

/** A label drawn with AWT: SansSerif, as the console's Arial/Helvetica, in points. */
internal class AwtLabelCanvas(private val graphics: Graphics2D) : LabelCanvas {
  private fun font(size: Double, bold: Boolean) = Font(Font.SANS_SERIF, if (bold) Font.BOLD else Font.PLAIN, 1).deriveFont(size.toFloat())

  override fun measure(text: String, size: Double, bold: Boolean): Double =
    graphics.getFontMetrics(font(size, bold)).getStringBounds(text, graphics).width

  override fun text(text: String, x: Double, baseline: Double, size: Double, bold: Boolean) {
    graphics.font = font(size, bold)
    graphics.drawString(text, x.toFloat(), baseline.toFloat())
  }

  override fun fill(rect: LabelRect) {
    graphics.fill(Rectangle2D.Double(rect.x, rect.y, rect.width, rect.height))
  }
}
