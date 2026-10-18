package com.aglyn.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import org.jetbrains.compose.resources.decodeToImageBitmap

/**
 * Fetches an image's bytes. The shell provides one backed by its HTTP client
 * through [LocalImageLoader]; with none (a preview, a test) images show their
 * placeholder icon.
 */
fun interface ImageLoader {
  suspend fun load(url: String): ByteArray?
}

val LocalImageLoader = staticCompositionLocalOf<ImageLoader?> { null }

/** Decoded images by URL, a small least-recently-used window shared by every screen. */
private object ImageCache {
  private const val CAPACITY = 120
  private val entries = LinkedHashMap<String, ImageBitmap>()

  fun get(url: String): ImageBitmap? = entries.remove(url)?.also { entries[url] = it }

  fun put(url: String, image: ImageBitmap) {
    entries[url] = image
    while (entries.size > CAPACITY) entries.remove(entries.keys.first())
  }
}

/**
 * A remote image (a media thumbnail, a site's logo): the bytes through
 * [LocalImageLoader], decoded once and kept in a small shared cache. While it
 * loads, and when it cannot (no URL, offline, not an image), the [icon] sits
 * on a muted ground in its place.
 */
@Composable
fun RemoteImage(
  url: String?,
  contentDescription: String?,
  modifier: Modifier = Modifier,
  contentScale: ContentScale = ContentScale.Crop,
  icon: String = "image",
) {
  val shown = rememberRemoteBitmap(url)
  if (shown != null) {
    Image(shown, contentDescription, modifier, contentScale = contentScale)
  } else {
    Box(modifier.background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
      Icon(AglynIcons.named(icon), contentDescription, Modifier.size(32.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}

/** The decoded image at [url] (cached), or null while it loads, with no loader, or when it cannot be read. */
@Composable
internal fun rememberRemoteBitmap(url: String?): ImageBitmap? {
  val loader = LocalImageLoader.current
  var image by remember(url) { mutableStateOf(url?.let(ImageCache::get)) }
  LaunchedEffect(url, loader) {
    if (url == null || loader == null || image != null) return@LaunchedEffect
    image = try {
      loader.load(url)?.decodeToImageBitmap()?.also { ImageCache.put(url, it) }
    } catch (error: CancellationException) {
      throw error
    } catch (_: Throwable) {
      null
    }
  }
  return image
}

/**
 * A brand picture in a small square: a workspace's logo or a site's favicon, its dark-theme art in dark mode when there
 * is one, and [fallback] (the kit's icon) while there is none, while it loads, or when it fails.
 */
@Composable
fun BrandPicture(url: String?, darkUrl: String? = null, size: Dp, shape: Shape, fallback: @Composable () -> Unit) {
  val shown = (if (isSystemInDarkTheme()) darkUrl else null) ?: url
  val image = rememberRemoteBitmap(shown)
  if (image != null) {
    Image(image, contentDescription = null, modifier = Modifier.size(size).clip(shape), contentScale = ContentScale.Crop)
  } else {
    fallback()
  }
}

/** Where a picked file comes from. */
enum class PickSource { PHOTOS, CAMERA, FILES }

/** A file the person picked or shot, read whole, with the name and type the device gave it. */
class PickedFile(val name: String, val mimeType: String, val bytes: ByteArray) {
  val size: Long get() = bytes.size.toLong()
}

/**
 * The device's own pickers: the photo library, the camera and the file
 * browser. The shell provides one through [LocalMediaPicker] (the Android
 * system pickers; a file dialog on desktop, which has no camera source).
 */
interface MediaPicker {
  /** The sources this device offers, in the order a sheet lists them. */
  val sources: List<PickSource>

  /** The files picked from [source]; empty when the person backs out. */
  suspend fun pick(source: PickSource, multiple: Boolean = true): List<PickedFile>
}

val LocalMediaPicker = staticCompositionLocalOf<MediaPicker?> { null }

/** How a source reads in a menu, with its icon. */
fun pickSourceLabel(source: PickSource): Pair<String, String> = when (source) {
  PickSource.PHOTOS -> "Photo library" to "photo_library"
  PickSource.CAMERA -> "Take a photo" to "photo_camera"
  PickSource.FILES -> "Choose files" to "folder_open"
}

/** A square media tile's frame, so grids line up whatever the image's shape. */
@Composable
fun MediaThumb(url: String?, contentDescription: String?, icon: String, modifier: Modifier = Modifier) {
  Box(modifier) {
    RemoteImage(url, contentDescription, Modifier.fillMaxSize(), icon = icon)
  }
}

/**
 * Hands a file the app made (an export) to the person: the share sheet on
 * Android, a Save dialog on desktop. The shell provides one through
 * [LocalFileExporter]; answers false when the person backs out.
 */
interface FileExporter {
  suspend fun export(name: String, mimeType: String, bytes: ByteArray): Boolean
}

val LocalFileExporter = staticCompositionLocalOf<FileExporter?> { null }

/**
 * What the image editor writes, in the order the console's editor applies it
 * to a picture standing upright: mirror (flipH, flipV), turn clockwise by
 * [rotation] degrees (0, 90, 180 or 270), cut [cropW] by [cropH] from
 * ([cropX], [cropY]) of the turned picture, and draw that at [width] by
 * [height]. PNG stays lossless; anything else is a JPEG.
 */
data class ImageEditPlan(
  val rotation: Int,
  val flipH: Boolean,
  val flipV: Boolean,
  val cropX: Int,
  val cropY: Int,
  val cropW: Int,
  val cropH: Int,
  val width: Int,
  val height: Int,
  val png: Boolean,
)

/** A picture opened for editing: decoded and stood upright once, drawn at as many plans as the screen asks. */
interface ImageEditSession {
  /** The upright picture's size. */
  val width: Int
  val height: Int

  /** The picture drawn as [plan] says, encoded; null when the device cannot draw or encode it. */
  fun render(plan: ImageEditPlan): ByteArray?

  /** Lets the decoded picture go. */
  fun close() {}
}

/**
 * The device's pixels for the image editor: Android's bitmaps, the desktop's
 * java.awt. The shell provides one through [LocalImageTransformer].
 */
fun interface ImageTransformer {
  /** Decodes [bytes] (a photo's EXIF turn applied), or null for a format the device cannot read. */
  fun open(bytes: ByteArray): ImageEditSession?
}

val LocalImageTransformer = staticCompositionLocalOf<ImageTransformer?> { null }

/** A picture's bytes as something Compose can draw, or null when they are not an image it reads. */
fun ByteArray.toImageBitmapOrNull(): ImageBitmap? = try {
  decodeToImageBitmap()
} catch (error: CancellationException) {
  throw error
} catch (_: Throwable) {
  null
}

/**
 * What a device read from a film before it was uploaded (the console's `probeVideoFile`): its length and frame size, a still
 * from near the start for a poster, or why none of that could be had. Neither server can decode a film, so the uploader's
 * device does it, for nothing, before the bytes move.
 */
class VideoProbeResult(
  val durationMs: Long? = null,
  val width: Int? = null,
  val height: Int? = null,
  /** The poster still, as JPEG bytes. */
  val poster: ByteArray? = null,
  /** A short note on what did not happen; only said when something was tried and failed. */
  val reason: String? = null,
)

/** The device's decoder for the film upload path: Android's media retriever; desktop has none, and says so. */
fun interface VideoProbe {
  suspend fun probe(file: PickedFile): VideoProbeResult
}

val LocalVideoProbe = staticCompositionLocalOf<VideoProbe?> { null }

