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
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlin.math.sqrt
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

/**
 * The decoded image at [url] (cached), or null while it loads, with no loader, or when it cannot be read. Art the decoders
 * cannot read (an SVG logo, which the media CDN serves unchanged) is read as the CDN's PNG of it ([mediaRasterUrl]).
 */
@Composable
internal fun rememberRemoteBitmap(url: String?): ImageBitmap? {
  val loader = LocalImageLoader.current
  var image by remember(url) { mutableStateOf(url?.let(ImageCache::get)) }
  LaunchedEffect(url, loader) {
    if (url == null || loader == null || image != null) return@LaunchedEffect
    image = try {
      val bytes = loader.load(url)
      (bytes?.let { runCatching { it.decodeToImageBitmap() }.getOrNull() }
        ?: bytes?.let { com.aglyn.core.mediaRasterUrl(url) }?.let { png -> loader.load(png)?.decodeToImageBitmap() })
        ?.also { ImageCache.put(url, it) }
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
 *
 * Opaque art (a photo, a solid tile) fills the [shape] and loses its corners to it, which costs nothing. Art on a
 * transparent ground (a logo mark) is drawn whole: fitted, and shrunk only as far as the shape needs for every visible
 * pixel to clear its edges ([brandArtScale]). A favicon is drawn edge to edge for a browser tab, so filling a circle
 * with it cuts its corners off.
 */
@Composable
fun BrandPicture(url: String?, darkUrl: String? = null, size: Dp, shape: Shape, fallback: @Composable () -> Unit) {
  val shown = (if (isSystemInDarkTheme()) darkUrl else null) ?: url
  val image = rememberRemoteBitmap(shown)
  if (image != null) {
    val art = remember(image) { brandArtOf(image) }
    if (art.opaqueCorners) {
      Image(image, contentDescription = null, modifier = Modifier.size(size).clip(shape), contentScale = ContentScale.Crop)
    } else {
      val corner = shapeCornerFraction(shape, size)
      val scale = remember(art, corner) { brandArtScale(art.ink, corner) }
      Box(Modifier.size(size).clip(shape), contentAlignment = Alignment.Center) {
        Image(image, contentDescription = null, modifier = Modifier.size(size * scale), contentScale = ContentScale.Fit)
      }
    }
  } else {
    fallback()
  }
}

/** The room a brand mark keeps from its badge's edge, as a fraction of the badge's side. */
internal const val BRAND_ART_MARGIN = 0.06f

/**
 * Where a brand picture's art has ink. [ink] holds, for each row of pixels that has any, the outer corner of its
 * outermost visible pixel on each side, as `x, y` pairs measured from the picture's center in units of its longer
 * side. The badge's shape is convex and symmetric, so those are the only points that can cross its edge.
 */
internal class BrandArt(val ink: FloatArray, val opaqueCorners: Boolean)

/** Pixels at or below this opacity are ground, not art: anti-aliasing haze, not a visible edge. */
private const val INK_ALPHA = 0.06f

/** Reads [image]'s ink; a picture whose pixels cannot be read is treated as opaque, so it fills as it always has. */
internal fun brandArtOf(image: ImageBitmap): BrandArt = try {
  val pixels = image.toPixelMap()
  brandArtOf(image.width, image.height) { x, y -> pixels[x, y].alpha }
} catch (error: CancellationException) {
  throw error
} catch (_: Throwable) {
  BrandArt(FloatArray(0), opaqueCorners = true)
}

/** [BrandArt] of a [width] × [height] picture whose opacity at a pixel is [alphaAt]. */
internal fun brandArtOf(width: Int, height: Int, alphaAt: (x: Int, y: Int) -> Float): BrandArt {
  if (width <= 0 || height <= 0) return BrandArt(FloatArray(0), opaqueCorners = false)
  val opaque = listOf(0 to 0, width - 1 to 0, 0 to height - 1, width - 1 to height - 1).all { (x, y) -> alphaAt(x, y) >= 0.95f }
  val unit = maxOf(width, height).toFloat()
  val points = ArrayList<Float>()
  for (y in 0 until height) {
    val left = (0 until width).firstOrNull { alphaAt(it, y) > INK_ALPHA } ?: continue
    val right = (width - 1 downTo left).first { alphaAt(it, y) > INK_ALPHA }
    // The pixel's edge farthest from the center, on each axis.
    val top = y / unit - height / (2 * unit)
    val bottom = (y + 1) / unit - height / (2 * unit)
    val rowY = maxOf(abs(top), abs(bottom))
    points += abs(left / unit - width / (2 * unit))
    points += rowY
    points += abs((right + 1) / unit - width / (2 * unit))
    points += rowY
  }
  return BrandArt(points.toFloatArray(), opaque)
}

/**
 * How far to shrink art fitted to a badge (its longer side the badge's side) so that every point of [ink] lies inside
 * the badge's shape, [margin] in from its edge: 1 when it already does, since art is never enlarged past its fit.
 * [cornerFraction] is the shape's corner radius as a fraction of its side: 0 for a square, 0.5 for a circle.
 */
internal fun brandArtScale(ink: FloatArray, cornerFraction: Float, margin: Float = BRAND_ART_MARGIN): Float {
  val half = 0.5f - margin
  val radius = (cornerFraction.coerceIn(0f, 0.5f) - margin).coerceAtLeast(0f)
  val straight = half - radius
  var scale = 1f
  var i = 0
  while (i + 1 < ink.size) {
    val x = abs(ink[i])
    val y = abs(ink[i + 1])
    i += 2
    val far = maxOf(x, y)
    if (far <= 0f) continue
    var limit = half / far
    // Past the straight part of both edges the point meets the corner's arc instead: the larger root of
    // |k·(x, y) − (straight, straight)| = radius.
    if (radius > 0f && limit * minOf(x, y) > straight) {
      val norm = x * x + y * y
      val reach = -straight * straight * (x - y) * (x - y) + radius * radius * norm
      limit = minOf(limit, (straight * (x + y) + sqrt(reach.coerceAtLeast(0f))) / norm)
    }
    scale = minOf(scale, limit)
  }
  return scale
}

/** [shape]'s corner radius as a fraction of a [size] square's side; an outline that is not a rounded box counts as round. */
@Composable
private fun shapeCornerFraction(shape: Shape, size: Dp): Float {
  val density = LocalDensity.current
  val direction = LocalLayoutDirection.current
  return remember(shape, size, density, direction) {
    val side = with(density) { size.toPx() }
    if (side <= 0f) return@remember 0.5f
    when (val outline = shape.createOutline(Size(side, side), direction, density)) {
      is Outline.Rectangle -> 0f
      is Outline.Rounded -> with(outline.roundRect) {
        maxOf(topLeftCornerRadius.x, topRightCornerRadius.x, bottomLeftCornerRadius.x, bottomRightCornerRadius.x) / side
      }
      is Outline.Generic -> 0.5f
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

