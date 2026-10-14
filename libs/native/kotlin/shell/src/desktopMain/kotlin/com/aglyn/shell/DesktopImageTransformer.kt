package com.aglyn.shell

import com.aglyn.contracts.exifTurn
import com.aglyn.contracts.jpegExifOrientation
import com.aglyn.ui.ImageEditPlan
import com.aglyn.ui.ImageEditSession
import com.aglyn.ui.ImageTransformer
import java.awt.Color
import java.awt.RenderingHints
import java.awt.geom.AffineTransform
import java.awt.image.BufferedImage
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import javax.imageio.IIOImage
import javax.imageio.ImageIO
import javax.imageio.ImageWriteParam

actual fun platformImageTransformer(): ImageTransformer = DesktopImageTransformer

/** The editor's pixels on desktop: a [BufferedImage] stood upright once, drawn through one transform per plan. */
object DesktopImageTransformer : ImageTransformer {
  override fun open(bytes: ByteArray): ImageEditSession? {
    val decoded = try {
      ImageIO.read(ByteArrayInputStream(bytes))
    } catch (_: Exception) {
      null
    } catch (_: OutOfMemoryError) {
      null
    } ?: return null
    val (rotation, mirror) = exifTurn(jpegExifOrientation(bytes))
    if (rotation == 0 && !mirror) return DesktopImageSession(decoded)
    // Standing a photo upright is the same draw as an edit with no cut.
    val swapped = rotation == 90 || rotation == 270
    val upright = BufferedImage(if (swapped) decoded.height else decoded.width, if (swapped) decoded.width else decoded.height, BufferedImage.TYPE_INT_ARGB)
    drawTurned(decoded, upright, rotation, mirror, false, 0, 0, upright.width, upright.height)
    return DesktopImageSession(upright)
  }
}

/** [source] mirrored, turned and cut, drawn to fill all of [target]. */
private fun drawTurned(source: BufferedImage, target: BufferedImage, rotation: Int, flipH: Boolean, flipV: Boolean, cropX: Int, cropY: Int, cropW: Int, cropH: Int) {
  val swapped = rotation == 90 || rotation == 270
  val workedW = if (swapped) source.height else source.width
  val workedH = if (swapped) source.width else source.height
  val transform = AffineTransform().apply {
    scale(target.width.toDouble() / cropW, target.height.toDouble() / cropH)
    translate(-cropX.toDouble(), -cropY.toDouble())
    translate(workedW / 2.0, workedH / 2.0)
    rotate(Math.toRadians(rotation.toDouble()))
    scale(if (flipH) -1.0 else 1.0, if (flipV) -1.0 else 1.0)
    translate(-source.width / 2.0, -source.height / 2.0)
  }
  val graphics = target.createGraphics()
  try {
    graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC)
    graphics.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY)
    graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
    // A JPEG has no transparency; the console's canvas leaves it black.
    if (!target.colorModel.hasAlpha()) {
      graphics.color = Color.BLACK
      graphics.fillRect(0, 0, target.width, target.height)
    }
    graphics.drawImage(source, transform, null)
  } finally {
    graphics.dispose()
  }
}

private class DesktopImageSession(private val image: BufferedImage) : ImageEditSession {
  override val width: Int get() = image.width
  override val height: Int get() = image.height

  override fun render(plan: ImageEditPlan): ByteArray? {
    val swapped = plan.rotation == 90 || plan.rotation == 270
    val workedW = if (swapped) image.height else image.width
    val workedH = if (swapped) image.width else image.height
    val cropX = plan.cropX.coerceIn(0, workedW - 1)
    val cropY = plan.cropY.coerceIn(0, workedH - 1)
    val cropW = plan.cropW.coerceIn(1, workedW - cropX)
    val cropH = plan.cropH.coerceIn(1, workedH - cropY)
    return try {
      val out = BufferedImage(plan.width, plan.height, if (plan.png) BufferedImage.TYPE_INT_ARGB else BufferedImage.TYPE_INT_RGB)
      drawTurned(image, out, plan.rotation, plan.flipH, plan.flipV, cropX, cropY, cropW, cropH)
      val stream = ByteArrayOutputStream()
      if (plan.png) {
        if (!ImageIO.write(out, "png", stream)) return null
      } else {
        val writer = ImageIO.getImageWritersByFormatName("jpeg").takeIf { it.hasNext() }?.next() ?: return null
        try {
          val params = writer.defaultWriteParam.apply {
            compressionMode = ImageWriteParam.MODE_EXPLICIT
            compressionQuality = 0.9f
          }
          ImageIO.createImageOutputStream(stream).use { output ->
            writer.output = output
            writer.write(null, IIOImage(out, null, null), params)
          }
        } finally {
          writer.dispose()
        }
      }
      stream.toByteArray()
    } catch (_: Exception) {
      null
    } catch (_: OutOfMemoryError) {
      null
    }
  }
}
