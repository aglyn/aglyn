package com.aglyn.site.media

import com.aglyn.contracts.ImageEditRect
import com.aglyn.contracts.imageEditContentType
import com.aglyn.contracts.imageEditCropFromDrag
import com.aglyn.contracts.imageEditOutput
import com.aglyn.contracts.imageEditPreviewScale
import com.aglyn.contracts.imageEditWorkedSize
import com.aglyn.ui.ImageEditPlan
import kotlin.math.floor
import kotlin.math.max

/**
 * What a person has asked of the image editor so far: the console's editor
 * state (rotation, flips, a ratio-locked crop in preview pixels, a max width),
 * and the plans it turns into. Every number comes from the arithmetic in
 * contracts (ImageEdit.kt), which replays the console's own.
 */
data class ImageEditSettings(
  val rotation: Int = 0,
  val flipH: Boolean = false,
  val flipV: Boolean = false,
  /** The crop's width over its height, or null for a free crop. */
  val aspect: Double? = null,
  /** The crop, in preview pixels; null keeps the whole picture. */
  val crop: ImageEditRect? = null,
  /** The widest the result may be, as typed; blank keeps the size. */
  val maxWidth: String = "",
) {
  /** A quarter turn; the crop was drawn on the old turn, so it goes. */
  fun turned(clockwise: Boolean): ImageEditSettings = copy(rotation = (rotation + if (clockwise) 90 else 270) % 360, crop = null)

  /** A new ratio starts the crop over, as the console's editor does. */
  fun withAspect(ratio: Double?): ImageEditSettings = copy(aspect = ratio, crop = null)

  fun withMaxWidth(text: String): ImageEditSettings = copy(maxWidth = text.filter { it.isDigit() }.take(5))

  /** The picture's size once it is turned. */
  fun worked(sourceWidth: Int, sourceHeight: Int): Pair<Int, Int> = imageEditWorkedSize(sourceWidth, sourceHeight, rotation)

  /** How far the preview is shrunk so its longest side fits. */
  fun scale(sourceWidth: Int, sourceHeight: Int): Double = worked(sourceWidth, sourceHeight).let { imageEditPreviewScale(it.first.toDouble(), it.second.toDouble()) }

  /** The preview's size in pixels. */
  fun previewSize(sourceWidth: Int, sourceHeight: Int): Pair<Int, Int> {
    val (w, h) = worked(sourceWidth, sourceHeight)
    val scale = scale(sourceWidth, sourceHeight)
    return floor(w * scale + 0.5).toInt() to floor(h * scale + 0.5).toInt()
  }

  /** The crop a drag from ([startX], [startY]) to ([nowX], [nowY]) draws, in preview pixels. */
  fun dragged(startX: Double, startY: Double, nowX: Double, nowY: Double, previewWidth: Int, previewHeight: Int): ImageEditSettings {
    fun clampX(value: Double) = value.coerceIn(0.0, previewWidth.toDouble())
    fun clampY(value: Double) = value.coerceIn(0.0, previewHeight.toDouble())
    return copy(crop = imageEditCropFromDrag(clampX(startX), clampY(startY), clampX(nowX), clampY(nowY), aspect, previewWidth.toDouble(), previewHeight.toDouble()))
  }

  /** The turned picture at preview size, with no cut: what the screen shows under the crop. */
  fun previewPlan(sourceWidth: Int, sourceHeight: Int): ImageEditPlan {
    val (w, h) = worked(sourceWidth, sourceHeight)
    val (previewW, previewH) = previewSize(sourceWidth, sourceHeight)
    return ImageEditPlan(rotation, flipH, flipV, 0, 0, w, h, max(1, previewW), max(1, previewH), png = true)
  }

  /** The file to save: the crop and size the console's editor would write, in the type it would pick. */
  fun savePlan(sourceWidth: Int, sourceHeight: Int, fileName: String): ImageEditPlan {
    val (w, h) = worked(sourceWidth, sourceHeight)
    val out = imageEditOutput(w, h, crop, scale(sourceWidth, sourceHeight), maxWidth.toDoubleOrNull() ?: 0.0)
    return ImageEditPlan(rotation, flipH, flipV, out.cropX, out.cropY, out.cropW, out.cropH, out.width, out.height, png = imageEditContentType(fileName) == "image/png")
  }

  /** Whether anything is asked for: a plain save of an unchanged picture is not an edit. */
  val changed: Boolean get() = rotation != 0 || flipH || flipV || crop != null || maxWidth.isNotBlank()
}
