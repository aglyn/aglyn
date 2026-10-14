package com.aglyn.shell

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import com.aglyn.contracts.exifTurn
import com.aglyn.contracts.jpegExifOrientation
import com.aglyn.ui.ImageEditPlan
import com.aglyn.ui.ImageEditSession
import com.aglyn.ui.ImageTransformer
import java.io.ByteArrayOutputStream

actual fun platformImageTransformer(): ImageTransformer = AndroidImageTransformer

/** The editor's pixels on Android: a [Bitmap] stood upright once, drawn through one matrix per plan. */
object AndroidImageTransformer : ImageTransformer {
  override fun open(bytes: ByteArray): ImageEditSession? {
    val decoded = try {
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    } catch (_: OutOfMemoryError) {
      null
    } ?: return null
    val (rotation, mirror) = exifTurn(jpegExifOrientation(bytes))
    if (rotation == 0 && !mirror) return AndroidImageSession(decoded)
    val matrix = Matrix().apply {
      if (mirror) postScale(-1f, 1f)
      if (rotation != 0) postRotate(rotation.toFloat())
    }
    val upright = try {
      Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
    } catch (_: OutOfMemoryError) {
      return null
    }
    if (upright !== decoded) decoded.recycle()
    return AndroidImageSession(upright)
  }
}

private class AndroidImageSession(private val bitmap: Bitmap) : ImageEditSession {
  override val width: Int get() = bitmap.width
  override val height: Int get() = bitmap.height

  override fun render(plan: ImageEditPlan): ByteArray? {
    val swapped = plan.rotation == 90 || plan.rotation == 270
    val workedW = if (swapped) bitmap.height else bitmap.width
    val workedH = if (swapped) bitmap.width else bitmap.height
    val cropX = plan.cropX.coerceIn(0, workedW - 1)
    val cropY = plan.cropY.coerceIn(0, workedH - 1)
    val cropW = plan.cropW.coerceIn(1, workedW - cropX)
    val cropH = plan.cropH.coerceIn(1, workedH - cropY)
    // The console's canvas does the same, in the same order: place the picture
    // on its centre, mirror, turn, then cut and scale to the output.
    val matrix = Matrix().apply {
      setScale(plan.width.toFloat() / cropW, plan.height.toFloat() / cropH)
      preTranslate(-cropX.toFloat(), -cropY.toFloat())
      preTranslate(workedW / 2f, workedH / 2f)
      preRotate(plan.rotation.toFloat())
      preScale(if (plan.flipH) -1f else 1f, if (plan.flipV) -1f else 1f)
      preTranslate(-bitmap.width / 2f, -bitmap.height / 2f)
    }
    val out = try {
      Bitmap.createBitmap(plan.width, plan.height, Bitmap.Config.ARGB_8888)
    } catch (_: OutOfMemoryError) {
      return null
    }
    try {
      val canvas = Canvas(out)
      // A JPEG has no transparency; the console's canvas leaves it black.
      if (!plan.png) canvas.drawColor(android.graphics.Color.BLACK)
      canvas.drawBitmap(bitmap, matrix, Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG))
      val stream = ByteArrayOutputStream()
      val encoded = if (plan.png) out.compress(Bitmap.CompressFormat.PNG, 100, stream) else out.compress(Bitmap.CompressFormat.JPEG, 90, stream)
      return if (encoded) stream.toByteArray() else null
    } finally {
      out.recycle()
    }
  }

  override fun close() {
    if (!bitmap.isRecycled) bitmap.recycle()
  }
}
