package com.aglyn.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
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
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
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
  val shown = image
  if (shown != null) {
    Image(shown, contentDescription, modifier, contentScale = contentScale)
  } else {
    Box(modifier.background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
      Icon(AglynIcons.named(icon), contentDescription, Modifier.size(32.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
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
