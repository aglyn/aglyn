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
import androidx.compose.ui.graphics.FilterQuality
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
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.roundToInt
import kotlin.math.sqrt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
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
 * What is drawn is the art's ink, not its canvas: a logo uploaded off-center or with empty room round it is centered by
 * its ink and sized by it (AGL-4027). Opaque art (a photo, a solid tile) fills the [shape] and loses its corners to it,
 * which costs nothing. A badge that already fits the shape (a round seal) is drawn edge to edge. Any other art on a
 * transparent ground (a logo mark) is drawn whole: fitted, and shrunk only as far as the shape needs for every visible
 * pixel to clear its edges ([brandArtScale]). The picture is decoded at the pixels it is drawn at, so it is never
 * minified on screen.
 */
@Composable
fun BrandPicture(url: String?, darkUrl: String? = null, size: Dp, shape: Shape, fallback: @Composable () -> Unit) {
  val shown = (if (isSystemInDarkTheme()) darkUrl else null) ?: url
  val fit = BrandFit.Badge(size.value, shapeCornerFraction(shape, size))
  val picture = rememberBrandPicture(shown, fit)
  if (picture != null) {
    Box(Modifier.size(size).clip(shape), contentAlignment = Alignment.Center) { BrandDrawn(picture, fit.layout(picture.art), size) }
  } else {
    fallback()
  }
}

/** A loaded brand picture in its box, as its layout says: covering the box, or whole inside it. */
@Composable
internal fun BrandDrawn(picture: BrandImage, layout: BrandLayout, side: Dp) {
  // Decoded at the pixels it is drawn at (rememberBrandPicture), so this draws it about one to one; the high filter is
  // the backstop for the rounding between the two.
  if (layout.fill) {
    Image(picture.image, contentDescription = null, modifier = Modifier.size(side), contentScale = ContentScale.Crop, filterQuality = FilterQuality.High)
  } else {
    Image(picture.image, contentDescription = null, modifier = Modifier.size(layout.inkSide.dp), contentScale = ContentScale.Fit, filterQuality = FilterQuality.High)
  }
}

/** How a brand picture is placed: the box it is drawn in, which decides how its art is laid out and its pixels. */
internal sealed interface BrandFit {
  /** The box's side, in dp. */
  val side: Float

  /** A picture in a square of [side] dp whose corner radius is [cornerFraction] of its side ([BrandPicture]). */
  data class Badge(override val side: Float, val cornerFraction: Float) : BrandFit

  /** A workspace's tile of [side] dp ([WorkspaceTile]), with its logo slot of [slot] dp on the plate. */
  data class Tile(override val side: Float, val cornerFraction: Float, val slot: Float) : BrandFit

  /** Where [art] goes in this box. */
  fun layout(art: BrandArt): BrandLayout = when (this) {
    is Badge -> when {
      art.opaqueCorners -> BrandLayout(fill = true, inkSide = side * art.fillFactor, plate = false)
      else -> BrandLayout(fill = false, inkSide = side * (brandBadgeScale(art, cornerFraction) ?: brandArtScale(art.ink, cornerFraction)), plate = false)
    }
    is Tile -> {
      val badge = brandBadgeScale(art, cornerFraction)
      when {
        // Figma Rail/Workspace tile, Type=Picture: a picture covers the whole tile.
        art.opaqueCorners -> BrandLayout(fill = true, inkSide = side * art.fillFactor, plate = false)
        // A badge already has its own edge, so it takes the whole tile too, with nothing under it.
        badge != null -> BrandLayout(fill = false, inkSide = side * badge, plate = false)
        // Type=Logo: a mark sits on the paper plate, its ink fitted whole in the slot, which keeps it clear of the
        // plate's corners, so it is not shrunk again.
        else -> BrandLayout(fill = false, inkSide = slot, plate = true)
      }
    }
  }
}

/** Where a brand picture's art goes: covering its box ([fill]) or whole in it, its ink's longer side [inkSide] dp. */
internal data class BrandLayout(val fill: Boolean, val inkSide: Float, val plate: Boolean)

/** A decoded brand picture, cut to its ink's box, and where its art has ink. */
internal class BrandImage(val image: ImageBitmap, val art: BrandArt)

/** Fetched image bytes by URL, so a logo drawn at several sizes is fetched once. */
private object BrandBytes {
  private const val CAPACITY = 48
  private val entries = LinkedHashMap<String, ByteArray>()

  fun get(url: String): ByteArray? = entries.remove(url)?.also { entries[url] = it }

  fun put(url: String, bytes: ByteArray) {
    entries[url] = bytes
    while (entries.size > CAPACITY) entries.remove(entries.keys.first())
  }
}

/** Each brand picture's art by URL, and each size it is drawn at, decoded once. */
private object BrandImages {
  private const val CAPACITY = 240
  private val arts = LinkedHashMap<String, BrandArt>()
  private val images = LinkedHashMap<String, BrandImage>()

  fun art(url: String): BrandArt? = arts.remove(url)?.also { arts[url] = it }

  fun putArt(url: String, art: BrandArt) {
    arts[url] = art
    while (arts.size > CAPACITY) arts.remove(arts.keys.first())
  }

  fun get(url: String, pixels: Int): BrandImage? = "$url@$pixels".let { key -> images.remove(key)?.also { images[key] = it } }

  fun put(url: String, pixels: Int, image: BrandImage) {
    images["$url@$pixels"] = image
    while (images.size > CAPACITY) images.remove(images.keys.first())
  }
}

/** The pixels [fit] draws [art]'s ink box's longer side at, at [density]. */
private fun brandPixels(fit: BrandFit, art: BrandArt, density: Float): Int =
  maxOf(1, ceil(fit.layout(art).inkSide * density).toInt())

/**
 * The brand picture at [url] as [fit] draws it, or null while it loads, with no loader, or when it cannot be read. The
 * bytes are fetched once per URL and its art read once; each drawn size is cut to the ink and reduced to its pixels by
 * area averaging ([areaAverage]), so it is never minified on screen. The caches are only touched on the composition's
 * thread; the decoding runs off it.
 */
@Composable
internal fun rememberBrandPicture(url: String?, fit: BrandFit): BrandImage? {
  val loader = LocalImageLoader.current
  val density = LocalDensity.current.density
  var picture by remember(url, fit, density) {
    mutableStateOf(url?.let { u -> BrandImages.art(u)?.let { art -> BrandImages.get(u, brandPixels(fit, art, density)) } })
  }
  LaunchedEffect(url, fit, density, loader) {
    if (url == null || loader == null || picture != null) return@LaunchedEffect
    picture = try {
      val bytes = BrandBytes.get(url) ?: loader.load(url)?.also { BrandBytes.put(url, it) }
      val known = BrandImages.art(url)
      bytes?.let { withContext(Dispatchers.Default) { decodeBrandImage(it, known, fit, density) } }?.also {
        BrandImages.putArt(url, it.art)
        BrandImages.put(url, brandPixels(fit, it.art, density), it)
      }
    } catch (error: CancellationException) {
      throw error
    } catch (_: Throwable) {
      null
    }
  }
  return picture
}

/** [bytes] decoded, its art read (unless [known]), cut to its ink and reduced to the pixels [fit] draws it at. */
internal fun decodeBrandImage(bytes: ByteArray, known: BrandArt?, fit: BrandFit, density: Float): BrandImage? {
  val full = bytes.decodeToImageBitmap()
  val width = full.width
  val height = full.height
  if (width <= 0 || height <= 0) return null
  val argb = IntArray(width * height)
  full.readPixels(argb)
  val art = known ?: brandArtOf(width, height) { x, y -> (argb[y * width + x] ushr 24) / 255f }
  return BrandImage(reduceToInk(argb, width, height, art, brandPixels(fit, art, density)), art)
}

/** [argb] ([width] × [height]) cut to [art]'s ink box, rounded out to whole pixels, its longer side reduced to [pixels]. */
internal fun reduceToInk(argb: IntArray, width: Int, height: Int, art: BrandArt, pixels: Int): ImageBitmap {
  val left = floor(art.left * width).toInt().coerceIn(0, width - 1)
  val top = floor(art.top * height).toInt().coerceIn(0, height - 1)
  val right = ceil(art.right * width).toInt().coerceIn(left + 1, width)
  val bottom = ceil(art.bottom * height).toInt().coerceIn(top + 1, height)
  val boxWidth = right - left
  val boxHeight = bottom - top
  // Never enlarged: a picture smaller than it is drawn keeps its own pixels and is scaled up on screen.
  val factor = minOf(1f, pixels.toFloat() / maxOf(boxWidth, boxHeight))
  val outWidth = maxOf(1, (boxWidth * factor).roundToInt())
  val outHeight = maxOf(1, (boxHeight * factor).roundToInt())
  return imageBitmapOf(areaAverage(argb, width, left, top, boxWidth, boxHeight, outWidth, outHeight), outWidth, outHeight)
}

/**
 * The [boxWidth] × [boxHeight] region of [src] (ARGB, [srcWidth] wide) from [left], [top], reduced to [outWidth] ×
 * [outHeight] by averaging every source pixel each output pixel covers, weighted by how much of it it covers and by its
 * opacity, so a clear pixel's color never bleeds into the art's edge. Output is ARGB, not premultiplied. This is the
 * filter a picture needs to be made smaller than about half its size without aliasing; a GPU's bilinear sampling reads
 * only four source pixels for each one it draws.
 */
internal fun areaAverage(
  src: IntArray, srcWidth: Int, left: Int, top: Int, boxWidth: Int, boxHeight: Int, outWidth: Int, outHeight: Int,
): IntArray {
  val xs = coverage(boxWidth, outWidth)
  val ys = coverage(boxHeight, outHeight)
  // Pass 1: each source row in the box, reduced across to outWidth columns of premultiplied (a, r, g, b).
  val rows = FloatArray(boxHeight * outWidth * 4)
  for (y in 0 until boxHeight) {
    val rowStart = (top + y) * srcWidth + left
    for (ox in 0 until outWidth) {
      var a = 0f; var r = 0f; var g = 0f; var b = 0f
      for ((sx, weight) in xs[ox]) {
        val c = src[rowStart + sx]
        val alpha = (c ushr 24) / 255f * weight
        a += alpha
        r += ((c shr 16) and 0xFF) * alpha
        g += ((c shr 8) and 0xFF) * alpha
        b += (c and 0xFF) * alpha
      }
      val i = (y * outWidth + ox) * 4
      rows[i] = a; rows[i + 1] = r; rows[i + 2] = g; rows[i + 3] = b
    }
  }
  // Pass 2: down each column.
  val out = IntArray(outWidth * outHeight)
  for (oy in 0 until outHeight) {
    for (ox in 0 until outWidth) {
      var a = 0f; var r = 0f; var g = 0f; var b = 0f
      for ((sy, weight) in ys[oy]) {
        val i = (sy * outWidth + ox) * 4
        a += rows[i] * weight
        r += rows[i + 1] * weight
        g += rows[i + 2] * weight
        b += rows[i + 3] * weight
      }
      out[oy * outWidth + ox] = if (a <= 0f) {
        0
      } else {
        val alpha = (a * 255f).roundToInt().coerceIn(0, 255)
        (alpha shl 24) or ((r / a).roundToInt().coerceIn(0, 255) shl 16) or
          ((g / a).roundToInt().coerceIn(0, 255) shl 8) or (b / a).roundToInt().coerceIn(0, 255)
      }
    }
  }
  return out
}

/** For each of [outSize] output pixels, the source pixels of [inSize] it covers and how much of each, summing to 1. */
private fun coverage(inSize: Int, outSize: Int): Array<List<Pair<Int, Float>>> {
  val step = inSize.toFloat() / outSize
  return Array(outSize) { o ->
    val start = o * step
    val end = start + step
    val taps = ArrayList<Pair<Int, Float>>()
    var s = floor(start).toInt()
    while (s < end && s < inSize) {
      val overlap = minOf(end, s + 1f) - maxOf(start, s.toFloat())
      if (overlap > 0f) taps += s to overlap / step
      s++
    }
    taps
  }
}

/** An [ImageBitmap] of [argb] (not premultiplied), [width] × [height]: Android's Bitmap, the desktop's Skia image. */
internal expect fun imageBitmapOf(argb: IntArray, width: Int, height: Int): ImageBitmap

/** The room a brand mark keeps from its badge's edge, as a fraction of the badge's side. */
internal const val BRAND_ART_MARGIN = 0.06f

/**
 * How nearly whole art must fit a shape with no room round it to count as a badge in its own right (a round or rounded
 * seal, which brings its own edge) rather than a mark that wants room round it.
 */
internal const val BRAND_BADGE_FIT = 0.95f

/**
 * Where a brand picture's art has ink. [left], [top], [right] and [bottom] are the box round the ink, as fractions of
 * the picture's width and height, and everything else is measured in it: [ink] holds, for each row of pixels that has
 * any, the outer corner of its outermost visible pixel on each side, as `x, y` pairs measured from the box's center in
 * units of its longer side. The badge's shape is convex and symmetric, so those are the only points that can cross its
 * edge. [opaqueCorners] is whether the box's four corners are opaque: a photo or a solid tile rather than a mark.
 */
internal class BrandArt(
  val ink: FloatArray,
  val opaqueCorners: Boolean,
  val left: Float = 0f,
  val top: Float = 0f,
  val right: Float = 1f,
  val bottom: Float = 1f,
  /** The ink box's width over its height. */
  val aspect: Float = 1f,
) {
  /** How much longer the ink box's longer side is than its shorter: covering a square with it takes its shorter side. */
  val fillFactor: Float get() = if (aspect > 0f) maxOf(aspect, 1f / aspect) else 1f
}

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

/** [BrandArt] of a [width] × [height] picture whose opacity at a pixel is [alphaAt], rows counted from the top. */
internal fun brandArtOf(width: Int, height: Int, alphaAt: (x: Int, y: Int) -> Float): BrandArt {
  if (width <= 0 || height <= 0) return BrandArt(FloatArray(0), opaqueCorners = false)
  val rowY = ArrayList<Int>()
  val rowLeft = ArrayList<Int>()
  val rowRight = ArrayList<Int>()
  for (y in 0 until height) {
    val left = (0 until width).firstOrNull { alphaAt(it, y) > INK_ALPHA } ?: continue
    val right = (width - 1 downTo left).first { alphaAt(it, y) > INK_ALPHA }
    rowY += y
    rowLeft += left
    rowRight += right + 1
  }
  // Nothing visible: nothing to fit.
  if (rowY.isEmpty()) return BrandArt(FloatArray(0), opaqueCorners = false, aspect = width.toFloat() / height)
  val minX = rowLeft.min()
  val maxX = rowRight.max()
  val top = rowY.first()
  val bottom = rowY.last() + 1
  val boxWidth = (maxX - minX).toFloat()
  val boxHeight = (bottom - top).toFloat()
  val unit = maxOf(boxWidth, boxHeight)
  val midX = (minX + maxX) / 2f
  val midY = (top + bottom) / 2f
  val opaque = listOf(minX to top, maxX - 1 to top, minX to bottom - 1, maxX - 1 to bottom - 1).all { (x, y) -> alphaAt(x, y) >= 0.95f }
  val points = FloatArray(rowY.size * 4)
  for (i in rowY.indices) {
    val y = rowY[i]
    // The pixel's edge farthest from the center, on each axis.
    val farY = maxOf(abs(y - midY), abs(y + 1 - midY)) / unit
    points[i * 4] = abs(rowLeft[i] - midX) / unit
    points[i * 4 + 1] = farY
    points[i * 4 + 2] = abs(rowRight[i] - midX) / unit
    points[i * 4 + 3] = farY
  }
  return BrandArt(
    points, opaque,
    left = minX.toFloat() / width, top = top.toFloat() / height, right = maxX.toFloat() / width,
    bottom = bottom.toFloat() / height, aspect = boxWidth / boxHeight,
  )
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

/**
 * The scale [art] is drawn at when it is a badge in its own right: art that fits the shape all but whole with no room
 * round it (a round seal in a rounded square). Null for a mark, which keeps its room.
 */
internal fun brandBadgeScale(art: BrandArt, cornerFraction: Float): Float? {
  if (art.ink.isEmpty()) return null
  val whole = brandArtScale(art.ink, cornerFraction, margin = 0f)
  return if (whole >= BRAND_BADGE_FIT) whole else null
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

