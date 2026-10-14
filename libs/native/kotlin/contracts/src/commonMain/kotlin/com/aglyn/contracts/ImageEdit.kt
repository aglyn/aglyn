package com.aglyn.contracts

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject

/*
 * The arithmetic of the media library's image editor, ported once from
 * libs/aglyn/src/lib/app-utils/image-edit.ts: the quarter-turn size, the crop a
 * drag draws, where an edit cuts and how big it comes out, the copy's name and
 * type. The pixels are each platform's own (ImageTransformer in native-ui);
 * ImageEditCasesTest replays the TypeScript's own answers, so a crop that
 * lands on one pixel in the browser lands on the same pixel in the app.
 */

/** A rectangle in whatever pixels the caller measures in. */
data class ImageEditRect(val x: Double, val y: Double, val w: Double, val h: Double)

/** A crop ratio the editor offers; a null [ratio] is a free crop. */
data class ImageEditAspect(val label: String, val ratio: Double?)

/** What an edit writes: the crop in the turned image's own pixels, and the size it is drawn at. */
data class ImageEditOutput(val cropX: Int, val cropY: Int, val cropW: Int, val cropH: Int, val width: Int, val height: Int)

/** The crop ratios, as the console lists them. */
val imageEditAspects: List<ImageEditAspect> by lazy {
  Json.parseToJsonElement(Contracts.imageEditAspectsJson).jsonArray.map { entry ->
    val ratio = entry.jsonObject["ratio"]
    ImageEditAspect(
      (entry.jsonObject["label"] as JsonPrimitive).content,
      if (ratio == null || ratio is JsonNull) null else (ratio as JsonPrimitive).doubleOrNull,
    )
  }
}

/** `Math.round`: halves go up, which Kotlin's `round` (to even) does not do. */
private fun jsRound(value: Double): Double = floor(value + 0.5)

/** The image's size once it is turned: a quarter turn swaps the sides. */
fun imageEditWorkedSize(width: Int, height: Int, rotation: Int): Pair<Int, Int> =
  if (rotation == 90 || rotation == 270) height to width else width to height

/** How far the preview is shrunk so its longest side fits; never enlarged. */
fun imageEditPreviewScale(workedW: Double, workedH: Double): Double {
  if (workedW == 0.0 || workedH == 0.0) return 1.0
  return min(1.0, Contracts.imageEditPreviewMax.toDouble() / max(workedW, workedH))
}

/**
 * The crop a drag draws, from where it started to where the pointer is, kept
 * inside the preview. A locked ratio is width-led; a free crop uses the
 * dragged height.
 */
fun imageEditCropFromDrag(
  startX: Double, startY: Double, nowX: Double, nowY: Double, aspect: Double?, previewW: Double, previewH: Double,
): ImageEditRect {
  val w = abs(nowX - startX)
  val h = if (aspect != null && aspect != 0.0) w / aspect else abs(nowY - startY)
  val x = min(startX, nowX)
  val y = min(startY, nowY)
  return ImageEditRect(x, y, min(w, previewW - x), min(h, previewH - y))
}

/**
 * Where an edit cuts and how big it comes out. [crop] is in preview pixels
 * (null keeps the whole turned image) and [scale] is the preview's
 * [imageEditPreviewScale]; [maxWidth] shrinks the result to at most that wide
 * (0, nothing, or a width at or above the crop's keeps the size). A crop under
 * a pixel each way is taken as no crop.
 */
fun imageEditOutput(workedW: Int, workedH: Int, crop: ImageEditRect?, scale: Double, maxWidth: Double): ImageEditOutput {
  val inv = if (scale != 0.0) 1 / scale else 1.0
  var x = 0.0
  var y = 0.0
  var w = workedW.toDouble()
  var h = workedH.toDouble()
  if (crop != null) {
    val drawnW = jsRound(crop.w * inv)
    val drawnH = jsRound(crop.h * inv)
    if (drawnW >= 1 && drawnH >= 1) {
      x = jsRound(crop.x * inv)
      y = jsRound(crop.y * inv)
      w = drawnW
      h = drawnH
    }
  }
  val targetW = if (maxWidth.isFinite() && maxWidth > 0 && maxWidth < w) maxWidth else w
  val targetH = if (w > 0) jsRound(h * targetW / w) else h
  return ImageEditOutput(x.toInt(), y.toInt(), w.toInt(), h.toInt(), max(1.0, targetW).toInt(), max(1.0, targetH).toInt())
}

/** The name "Save as copy" gives the new file: `photo.png` becomes `photo (edited).png`. */
fun imageEditCopyName(fileName: String): String {
  val dot = fileName.lastIndexOf('.')
  // The extension is a dot and at least one character after it; a trailing dot has none.
  return if (dot >= 0 && dot < fileName.length - 1) fileName.substring(0, dot) + " (edited)" + fileName.substring(dot) else "$fileName (edited)"
}

/** PNG stays PNG, so a logo keeps its edges; anything else is saved as JPEG. */
fun imageEditContentType(fileName: String): String = if (fileName.endsWith(".png", ignoreCase = true)) "image/png" else "image/jpeg"

/**
 * The turn that stands a photo upright, from its EXIF orientation (1 to 8): a
 * quarter-turn count in degrees and whether it is mirrored first, in the order
 * the editor applies them (mirror, then rotate). The browser applies it before
 * drawing; a phone photo saved sideways would otherwise be saved sideways.
 */
fun exifTurn(orientation: Int): Pair<Int, Boolean> = when (orientation) {
  2 -> 0 to true
  3 -> 180 to false
  4 -> 180 to true
  5 -> 270 to true
  6 -> 90 to false
  7 -> 90 to true
  8 -> 270 to false
  else -> 0 to false
}

/** The EXIF orientation (1 to 8) a JPEG records, or 1 when it records none or is not a JPEG. */
fun jpegExifOrientation(bytes: ByteArray): Int {
  fun u8(at: Int): Int = bytes[at].toInt() and 0xFF
  if (bytes.size < 4 || u8(0) != 0xFF || u8(1) != 0xD8) return 1
  var at = 2
  while (at + 4 <= bytes.size) {
    if (u8(at) != 0xFF) return 1
    val marker = u8(at + 1)
    if (marker == 0xFF) { at += 1; continue }
    // Start of scan, end of image: no metadata follows.
    if (marker == 0xDA || marker == 0xD9) return 1
    val length = (u8(at + 2) shl 8) or u8(at + 3)
    if (length < 2) return 1
    if (marker == 0xE1 && at + 4 + 6 <= bytes.size && length >= 8) {
      val start = at + 4
      val header = "Exif".encodeToByteArray()
      if (header.indices.all { bytes[start + it] == header[it] } && bytes[start + 4].toInt() == 0 && bytes[start + 5].toInt() == 0) {
        return exifOrientationIn(bytes, start + 6, min(bytes.size, at + 2 + length))
      }
    }
    at += 2 + length
  }
  return 1
}

/** The Orientation tag of the first image directory in a TIFF block that runs from [tiff] to [end]. */
private fun exifOrientationIn(bytes: ByteArray, tiff: Int, end: Int): Int {
  if (tiff + 8 > end) return 1
  val little = bytes[tiff].toInt() == 0x49 && bytes[tiff + 1].toInt() == 0x49
  val big = bytes[tiff].toInt() == 0x4D && bytes[tiff + 1].toInt() == 0x4D
  if (!little && !big) return 1
  fun u16(at: Int): Int {
    val a = bytes[at].toInt() and 0xFF
    val b = bytes[at + 1].toInt() and 0xFF
    return if (little) (b shl 8) or a else (a shl 8) or b
  }
  fun u32(at: Int): Long {
    val a = u16(at).toLong()
    val b = u16(at + 2).toLong()
    return if (little) (b shl 16) or a else (a shl 16) or b
  }
  val directory = tiff + u32(tiff + 4).toInt()
  if (directory < tiff || directory + 2 > end) return 1
  val count = u16(directory)
  for (index in 0 until count) {
    val entry = directory + 2 + index * 12
    if (entry + 12 > end) return 1
    if (u16(entry) == 0x0112) {
      val value = u16(entry + 8)
      return if (value in 1..8) value else 1
    }
  }
  return 1
}
