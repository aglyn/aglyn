package com.aglyn.shell

import android.graphics.Bitmap
import android.media.MediaDataSource
import android.media.MediaMetadataRetriever
import com.aglyn.site.media.POSTER_MAX_WIDTH
import com.aglyn.site.media.POSTER_QUALITY
import com.aglyn.site.media.posterTimeSeconds
import com.aglyn.ui.PickedFile
import com.aglyn.ui.VideoProbe
import com.aglyn.ui.VideoProbeResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream

actual fun platformVideoProbe(): VideoProbe = AndroidVideoProbe

/** A film's bytes as the retriever's data source, so a picked file needs no path. */
private class BytesDataSource(private val bytes: ByteArray) : MediaDataSource() {
  override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
    if (position >= bytes.size) return -1
    val count = minOf(size, bytes.size - position.toInt())
    System.arraycopy(bytes, position.toInt(), buffer, offset, count)
    return count
  }

  override fun getSize(): Long = bytes.size.toLong()

  override fun close() = Unit
}

/** Reads a film with Android's media retriever: length, frame size (as it plays, rotation applied) and a still near the start. */
object AndroidVideoProbe : VideoProbe {
  override suspend fun probe(file: PickedFile): VideoProbeResult = withContext(Dispatchers.IO) {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(BytesDataSource(file.bytes))
      fun number(key: Int) = retriever.extractMetadata(key)?.toLongOrNull()
      val durationMs = number(MediaMetadataRetriever.METADATA_KEY_DURATION)?.takeIf { it > 0 }
      val rotation = number(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION) ?: 0L
      var width = number(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toInt() ?: 0
      var height = number(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toInt() ?: 0
      // The browser reports the frame as it plays, so a film shot sideways is its turned size.
      if (rotation == 90L || rotation == 270L) width = height.also { height = width }
      if (durationMs == null) return@withContext VideoProbeResult(reason = "video reported no usable duration")
      if (width <= 0 || height <= 0) return@withContext VideoProbeResult(reason = "video reported no frame size")
      val at = (posterTimeSeconds(durationMs / 1000.0) * 1_000_000).toLong()
      val frame = retriever.getFrameAtTime(at, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
        ?: return@withContext VideoProbeResult(durationMs, width, height, reason = "could not read a poster frame")
      val scaled = if (frame.width > POSTER_MAX_WIDTH) {
        Bitmap.createScaledBitmap(frame, POSTER_MAX_WIDTH, maxOf(1, Math.round(frame.height.toDouble() * POSTER_MAX_WIDTH / frame.width).toInt()), true).also { frame.recycle() }
      } else {
        frame
      }
      val out = ByteArrayOutputStream()
      val encoded = scaled.compress(Bitmap.CompressFormat.JPEG, Math.round(POSTER_QUALITY * 100).toInt(), out)
      scaled.recycle()
      if (!encoded || out.size() == 0) VideoProbeResult(durationMs, width, height, reason = "poster frame encoded to nothing") else VideoProbeResult(durationMs, width, height, out.toByteArray())
    } catch (error: Throwable) {
      VideoProbeResult(reason = "video probe failed — ${error.message ?: error::class.simpleName}".take(120))
    } finally {
      runCatching { retriever.release() }
    }
  }
}
