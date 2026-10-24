package com.aglyn.ui

import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toComposeImageBitmap
import org.jetbrains.skia.ColorAlphaType
import org.jetbrains.skia.ColorType
import org.jetbrains.skia.Image
import org.jetbrains.skia.ImageInfo

internal actual fun imageBitmapOf(argb: IntArray, width: Int, height: Int): ImageBitmap {
  // Skia's BGRA_8888 keeps each pixel as bytes B, G, R, A.
  val bytes = ByteArray(argb.size * 4)
  for (i in argb.indices) {
    val c = argb[i]
    bytes[i * 4] = (c and 0xFF).toByte()
    bytes[i * 4 + 1] = ((c shr 8) and 0xFF).toByte()
    bytes[i * 4 + 2] = ((c shr 16) and 0xFF).toByte()
    bytes[i * 4 + 3] = ((c ushr 24) and 0xFF).toByte()
  }
  val info = ImageInfo(width, height, ColorType.BGRA_8888, ColorAlphaType.UNPREMUL)
  return Image.makeRaster(info, bytes, width * 4).toComposeImageBitmap()
}
