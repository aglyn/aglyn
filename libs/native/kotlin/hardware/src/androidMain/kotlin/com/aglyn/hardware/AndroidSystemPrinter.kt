package com.aglyn.hardware

import android.app.Activity
import android.app.Application
import android.content.Context
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintJobInfo
import android.print.PrintManager
import android.print.pdf.PrintedPdfDocument
import kotlinx.coroutines.delay
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
    // The sheet stays open while the person chooses; the job tells us how it ended.
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

  private companion object {
    /** Five minutes at the print sheet. */
    const val MAX_WAIT_HALF_SECONDS = 600
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
