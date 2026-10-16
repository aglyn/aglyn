package com.aglyn.hardware

import android.app.Activity
import android.app.Application
import android.content.Context
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintJob
import android.print.PrintJobInfo
import android.print.PrintManager
import android.print.pdf.PrintedPdfDocument
import android.webkit.WebView
import android.webkit.WebViewClient
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import java.io.FileOutputStream
import java.lang.ref.WeakReference

/**
 * Android's print service as the register's print dialog: the receipt becomes a
 * monospaced text document and goes to [PrintManager], whose own sheet lets the
 * person pick a printer (or save a PDF). It follows the activity on screen
 * through the application's lifecycle callbacks, so a screen needs no hook.
 */
class AndroidSystemPrinter(application: Application) : SystemPrinter {
  private var top: WeakReference<Activity>? = null

  init {
    application.registerActivityLifecycleCallbacks(
      object : Application.ActivityLifecycleCallbacks {
        override fun onActivityResumed(activity: Activity) {
          top = WeakReference(activity)
        }

        override fun onActivityPaused(activity: Activity) = Unit
        override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
        override fun onActivityStarted(activity: Activity) = Unit
        override fun onActivityStopped(activity: Activity) = Unit
        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
        override fun onActivityDestroyed(activity: Activity) = Unit
      },
    )
  }

  override suspend fun printText(text: String, jobName: String): SystemPrintResult {
    val host = top?.get() ?: return SystemPrintResult.Failed("Printing needs the app on screen.")
    val manager = host.getSystemService(Context.PRINT_SERVICE) as? PrintManager
      ?: return SystemPrintResult.Failed("Printing is not available on this device.")
    val job = try {
      manager.print(jobName, TextPrintAdapter(host, jobName, text), null)
    } catch (error: RuntimeException) {
      return SystemPrintResult.Failed(error.message ?: "The print sheet could not be shown.")
    }
    return awaitJob(job)
  }

  override suspend fun printDocument(document: PrintableDocument, jobName: String): SystemPrintResult {
    val host = top?.get() ?: return SystemPrintResult.Failed("Printing needs the app on screen.")
    val manager = host.getSystemService(Context.PRINT_SERVICE) as? PrintManager
      ?: return SystemPrintResult.Failed("Printing is not available on this device.")
    return when (document) {
      is PrintableDocument.Html -> printHtml(host, manager, document.html, jobName)
      is PrintableDocument.Pdf -> start { manager.print(jobName, PdfPrintAdapter(jobName, document.bytes), null) }
      is PrintableDocument.Labels -> {
        val sheet = document.sheet
        if (sheet.labels.isEmpty()) return SystemPrintResult.Failed("There are no labels to print.")
        // Ask for the label's own size, no margins, as a label printer's driver offers its stock.
        val media = PrintAttributes.MediaSize(
          "aglyn-label-${sheet.widthPoints.toInt()}x${sheet.heightPoints.toInt()}",
          "Label",
          (sheet.widthPoints * 1000 / 72).toInt(),
          (sheet.heightPoints * 1000 / 72).toInt(),
        )
        val attributes = PrintAttributes.Builder().setMediaSize(media).setMinMargins(PrintAttributes.Margins.NO_MARGINS)
          .setColorMode(PrintAttributes.COLOR_MODE_MONOCHROME).build()
        start { manager.print(jobName, LabelPrintAdapter(host, jobName, sheet), attributes) }
      }
    }
  }

  /** The page in a web view, laid out by Android's own HTML engine, then its print adapter. */
  private suspend fun printHtml(host: Activity, manager: PrintManager, html: String, jobName: String): SystemPrintResult {
    val view = onMain { WebView(host) }
    val loaded = suspendCancellableCoroutine<Boolean> { continuation ->
      Handler(Looper.getMainLooper()).post {
        view.webViewClient = object : WebViewClient() {
          override fun onPageFinished(page: WebView, url: String?) {
            if (continuation.isActive) continuation.resume(true)
          }
        }
        view.settings.javaScriptEnabled = false
        view.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
      }
    }
    if (!loaded) return SystemPrintResult.Failed("The page could not be laid out.")
    val result = start { onMain { manager.print(jobName, view.createPrintDocumentAdapter(jobName), PrintAttributes.Builder().build()) } }
    // The adapter draws from the view while the spooler finishes the job, so it is let go a while after.
    Handler(Looper.getMainLooper()).postDelayed({ view.destroy() }, VIEW_GRACE_MS)
    return result
  }

  private suspend fun start(print: suspend () -> PrintJob): SystemPrintResult {
    val job = try {
      print()
    } catch (error: RuntimeException) {
      return SystemPrintResult.Failed(error.message ?: "The print sheet could not be shown.")
    }
    return awaitJob(job)
  }

  /** The sheet stays open while the person chooses; the job tells us how it ended. */
  private suspend fun awaitJob(job: PrintJob): SystemPrintResult {
    repeat(MAX_WAIT_HALF_SECONDS) {
      when (job.info.state) {
        PrintJobInfo.STATE_QUEUED, PrintJobInfo.STATE_STARTED, PrintJobInfo.STATE_COMPLETED -> return SystemPrintResult.Printed
        PrintJobInfo.STATE_CANCELED -> return SystemPrintResult.Canceled
        PrintJobInfo.STATE_FAILED -> return SystemPrintResult.Failed("The print service reported a problem.")
        else -> delay(500)
      }
    }
    return SystemPrintResult.Canceled
  }

  private suspend fun <T> onMain(block: () -> T): T =
    if (Looper.myLooper() == Looper.getMainLooper()) block()
    else suspendCancellableCoroutine { continuation -> Handler(Looper.getMainLooper()).post { continuation.resume(block()) } }

  private companion object {
    /** Five minutes at the print sheet. */
    const val MAX_WAIT_HALF_SECONDS = 600

    /** How long a printed page's web view is kept for the spooler. */
    const val VIEW_GRACE_MS = 60_000L
  }
}

/** Draws the receipt's text, one monospaced line per row, fitted to the page's width. */
private class TextPrintAdapter(private val context: Context, private val jobName: String, text: String) : PrintDocumentAdapter() {
  private val lines = text.trimEnd('\n').split('\n')
  private val columns = lines.maxOfOrNull { it.length }?.coerceAtLeast(1) ?: 1
  private var pdf: PrintedPdfDocument? = null
  private var perPage = 1
  private var fontSize = 8f
  private val paint = Paint().apply {
    typeface = Typeface.MONOSPACE
    color = Color.BLACK
    isAntiAlias = true
  }

  override fun onLayout(
    old: PrintAttributes?,
    attributes: PrintAttributes,
    cancel: CancellationSignal,
    callback: LayoutResultCallback,
    extras: Bundle?,
  ) {
    if (cancel.isCanceled) return callback.onLayoutCancelled()
    pdf = PrintedPdfDocument(context, attributes)
    val media = attributes.mediaSize
    val margins = attributes.minMargins
    val widthPoints = ((media?.widthMils ?: 8500) - (margins?.leftMils ?: 0) - (margins?.rightMils ?: 0)) * 72f / 1000 - 2 * PADDING
    val heightPoints = ((media?.heightMils ?: 11000) - (margins?.topMils ?: 0) - (margins?.bottomMils ?: 0)) * 72f / 1000 - 2 * PADDING
    fontSize = printFontSize(widthPoints, columns)
    perPage = maxOf(1, (heightPoints / (fontSize * LINE_HEIGHT)).toInt())
    val pages = printPages(lines.joinToString("\n"), perPage).size
    callback.onLayoutFinished(
      PrintDocumentInfo.Builder(jobName).setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).setPageCount(pages).build(),
      old == null || old != attributes,
    )
  }

  override fun onWrite(pages: Array<out PageRange>, destination: ParcelFileDescriptor, cancel: CancellationSignal, callback: WriteResultCallback) {
    val document = pdf ?: return callback.onWriteFailed("The receipt was not laid out.")
    paint.textSize = fontSize
    printPages(lines.joinToString("\n"), perPage).forEachIndexed { index, pageLines ->
      if (cancel.isCanceled) {
        document.close()
        return callback.onWriteCancelled()
      }
      val page = document.startPage(index)
      pageLines.forEachIndexed { row, line ->
        page.canvas.drawText(line, PADDING, PADDING + fontSize + row * fontSize * LINE_HEIGHT, paint)
      }
      document.finishPage(page)
    }
    try {
      FileOutputStream(destination.fileDescriptor).use { document.writeTo(it) }
      callback.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
    } catch (error: java.io.IOException) {
      callback.onWriteFailed(error.message)
    } finally {
      document.close()
      pdf = null
    }
  }

  private companion object {
    const val PADDING = 6f
    const val LINE_HEIGHT = 1.25f
  }
}

/** Hands the print service the PDF as it is. */
private class PdfPrintAdapter(private val jobName: String, private val bytes: ByteArray) : PrintDocumentAdapter() {
  override fun onLayout(
    old: PrintAttributes?,
    attributes: PrintAttributes,
    cancel: CancellationSignal,
    callback: LayoutResultCallback,
    extras: Bundle?,
  ) {
    if (cancel.isCanceled) return callback.onLayoutCancelled()
    callback.onLayoutFinished(
      PrintDocumentInfo.Builder(jobName).setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
        .setPageCount(PrintDocumentInfo.PAGE_COUNT_UNKNOWN).build(),
      old == null,
    )
  }

  override fun onWrite(pages: Array<out PageRange>, destination: ParcelFileDescriptor, cancel: CancellationSignal, callback: WriteResultCallback) {
    if (cancel.isCanceled) return callback.onWriteCancelled()
    try {
      FileOutputStream(destination.fileDescriptor).use { it.write(bytes) }
      callback.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
    } catch (error: java.io.IOException) {
      callback.onWriteFailed(error.message)
    }
  }
}

/** Each label on a page of its own, drawn as the console's label page at the page's top left. */
private class LabelPrintAdapter(private val context: Context, private val jobName: String, private val sheet: LabelSheet) : PrintDocumentAdapter() {
  private var pdf: PrintedPdfDocument? = null

  override fun onLayout(
    old: PrintAttributes?,
    attributes: PrintAttributes,
    cancel: CancellationSignal,
    callback: LayoutResultCallback,
    extras: Bundle?,
  ) {
    if (cancel.isCanceled) return callback.onLayoutCancelled()
    pdf = PrintedPdfDocument(context, attributes)
    callback.onLayoutFinished(
      PrintDocumentInfo.Builder(jobName).setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).setPageCount(sheet.labels.size).build(),
      old == null || old != attributes,
    )
  }

  override fun onWrite(pages: Array<out PageRange>, destination: ParcelFileDescriptor, cancel: CancellationSignal, callback: WriteResultCallback) {
    val document = pdf ?: return callback.onWriteFailed("The labels were not laid out.")
    sheet.labels.forEachIndexed { index, label ->
      if (cancel.isCanceled) {
        document.close()
        return callback.onWriteCancelled()
      }
      val page = document.startPage(index)
      drawLabel(label, sheet.widthPoints, sheet.heightPoints, 0.0, 0.0, AndroidLabelCanvas(page.canvas))
      document.finishPage(page)
    }
    try {
      FileOutputStream(destination.fileDescriptor).use { document.writeTo(it) }
      callback.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
    } catch (error: java.io.IOException) {
      callback.onWriteFailed(error.message)
    } finally {
      document.close()
      pdf = null
    }
  }
}

/** A label drawn on an Android canvas: sans-serif, as the console's Arial/Helvetica, in points. */
private class AndroidLabelCanvas(private val canvas: android.graphics.Canvas) : LabelCanvas {
  private val regular = Paint().apply {
    typeface = Typeface.SANS_SERIF
    color = Color.BLACK
    isAntiAlias = true
  }
  private val bold = Paint(regular).apply { typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD) }
  private val bars = Paint().apply {
    color = Color.BLACK
    style = Paint.Style.FILL
    isAntiAlias = false
  }

  private fun paint(size: Double, heavy: Boolean) = (if (heavy) bold else regular).apply { textSize = size.toFloat() }

  override fun measure(text: String, size: Double, bold: Boolean): Double = paint(size, bold).measureText(text).toDouble()

  override fun text(text: String, x: Double, baseline: Double, size: Double, bold: Boolean) {
    canvas.drawText(text, x.toFloat(), baseline.toFloat(), paint(size, bold))
  }

  override fun fill(rect: LabelRect) {
    canvas.drawRect(rect.x.toFloat(), rect.y.toFloat(), (rect.x + rect.width).toFloat(), (rect.y + rect.height).toFloat(), bars)
  }
}
