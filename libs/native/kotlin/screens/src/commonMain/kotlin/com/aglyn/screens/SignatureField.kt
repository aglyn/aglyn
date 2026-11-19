package com.aglyn.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aglyn.ui.space
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max

/** A drawn signature's strokes: each a list of `x to y` points, 0 to 1000 across and down the pad. */
internal typealias SignatureStrokes = List<List<Pair<Int, Int>>>

/**
 * A DRAWN SIGNATURE (`kind: "signature"`), taken as the console's `SignaturePad` takes one (AGL-4042), so a signing on the
 * apps reaches `waivers/sign-at-window` in the shape a signing in the browser does:
 * - each point is a whole number from 0 to 1000 across and down a pad three times as wide as it is tall;
 * - a point closer than 3 (across plus down) to the last one is skipped, and a stroke stops growing at 3,900 points in all;
 * - the value is `{ strokes: [[[x, y], …], …], png }`, `png` the picture as a `data:image/png;base64,` address (the route
 *   keeps it privately, and the signed PDF redraws the strokes). Nothing drawn is no value at all.
 *
 * The picture is drawn here, by hand, the same on every device (the Apple kit's `SignatureInk` makes the same bytes):
 * black ink on white, 1200 by 400 pixels, one bit a pixel, so the PNG is small and the same strokes always make the same
 * file. No colour is chosen for it: a one-bit grey picture has only black and white.
 */
internal object SignatureInk {
  /** The pad is three times as wide as it is tall (the console's `ASPECT`). */
  const val ASPECT = 3f
  const val WIDTH = 1200
  const val HEIGHT = 400
  /** The console's `>= 3900`: past this many points in all, a stroke takes no more. */
  const val MAX_POINTS = 3900
  /** The console skips a point under 3 away (across plus down) from the last one. */
  const val MIN_STEP = 3
  /** The ink's radius in pixels: a line about 4 pixels wide on the 1200-pixel picture (the console's `width / 320`). */
  private const val RADIUS = 2

  /** A place on a pad [width] by [height] as the console stores it: rounded half up, kept inside 0 to 1000. */
  fun at(x: Float, y: Float, width: Float, height: Float): Pair<Int, Int> {
    fun scaled(value: Float, side: Float) = floor(value.toDouble() / max(1.0, side.toDouble()) * 1000 + 0.5).toInt().coerceIn(0, 1000)
    return scaled(x, width) to scaled(y, height)
  }

  /** A new stroke begins at [point] (a press always starts one, as the console's `pointerdown` does). */
  fun begin(strokes: SignatureStrokes, point: Pair<Int, Int>): SignatureStrokes = strokes + listOf(listOf(point))

  /** The last stroke grown by [point], or null when the console would skip it (too close, or the pad is full). */
  fun extend(strokes: SignatureStrokes, point: Pair<Int, Int>): SignatureStrokes? {
    val stroke = strokes.lastOrNull() ?: return null
    val last = stroke.last()
    if (abs(point.first - last.first) + abs(point.second - last.second) < MIN_STEP) return null
    if (strokes.sumOf { it.size } >= MAX_POINTS) return null
    return strokes.dropLast(1) + listOf(stroke + point)
  }

  /** The strokes a stored value holds (`{ strokes }`), or none. */
  fun strokesOf(value: String): SignatureStrokes {
    if (value.isBlank()) return emptyList()
    val strokes = runCatching { (Json.parseToJsonElement(value) as? JsonObject)?.get("strokes") as? JsonArray }.getOrNull() ?: return emptyList()
    return strokes.mapNotNull { stroke ->
      (stroke as? JsonArray)?.mapNotNull { point ->
        val pair = point as? JsonArray ?: return@mapNotNull null
        val x = pair.getOrNull(0)?.jsonPrimitive?.intOrNull
        val y = pair.getOrNull(1)?.jsonPrimitive?.intOrNull
        if (x == null || y == null) null else x to y
      }?.takeIf { it.isNotEmpty() }
    }
  }

  /** What the field holds for [strokes]: `{ strokes, png }` as JSON text, or "" when nothing is drawn. */
  fun encode(strokes: SignatureStrokes): String {
    if (strokes.isEmpty()) return ""
    return JsonObject(
      mapOf(
        "strokes" to JsonArray(strokes.map { stroke -> JsonArray(stroke.map { (x, y) -> JsonArray(listOf(JsonPrimitive(x), JsonPrimitive(y))) }) }),
        "png" to JsonPrimitive(dataUrl(strokes)),
      ),
    ).toString()
  }

  /** What the form sends for the field: the stored object, or null when nothing is drawn. */
  fun json(value: String): JsonElement =
    if (value.isBlank()) JsonNull else runCatching { Json.parseToJsonElement(value) }.getOrDefault(JsonNull)

  fun dataUrl(strokes: SignatureStrokes): String = "data:image/png;base64," + ScreenValues.base64(png(strokes))

  /** The strokes as a one-bit PNG, black on white, [WIDTH] by [HEIGHT]. */
  fun png(strokes: SignatureStrokes): ByteArray {
    val rowBytes = WIDTH / 8
    val bits = ByteArray(rowBytes * HEIGHT) { 0xFF.toByte() }
    fun ink(px: Int, py: Int) {
      if (px < 0 || py < 0 || px >= WIDTH || py >= HEIGHT) return
      val at = py * rowBytes + px / 8
      bits[at] = (bits[at].toInt() and (1 shl (7 - px % 8)).inv()).toByte()
    }
    fun dot(cx: Int, cy: Int) {
      for (dy in -RADIUS..RADIUS) for (dx in -RADIUS..RADIUS) if (dx * dx + dy * dy <= RADIUS * RADIUS) ink(cx + dx, cy + dy)
    }
    for (stroke in strokes) {
      val pixels = stroke.map { (x, y) -> x * WIDTH / 1000 to y * HEIGHT / 1000 }
      if (pixels.size == 1) dot(pixels[0].first, pixels[0].second)
      for (index in 1 until pixels.size) {
        val (x0, y0) = pixels[index - 1]
        val (x1, y1) = pixels[index]
        val dx = x1 - x0
        val dy = y1 - y0
        val steps = max(abs(dx), abs(dy))
        if (steps == 0) dot(x0, y0) else for (step in 0..steps) dot(x0 + dx * step / steps, y0 + dy * step / steps)
      }
    }
    // Each row starts with filter 0 (none), then its packed pixels.
    val raw = ByteArray((rowBytes + 1) * HEIGHT)
    for (row in 0 until HEIGHT) bits.copyInto(raw, row * (rowBytes + 1) + 1, row * rowBytes, (row + 1) * rowBytes)
    val header = ByteArray(13).also { ihdr ->
      putInt(ihdr, 0, WIDTH)
      putInt(ihdr, 4, HEIGHT)
      ihdr[8] = 1 // bit depth
      ihdr[9] = 0 // greyscale
    }
    return byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A) +
      chunk("IHDR", header) + chunk("IDAT", zlibStored(raw)) + chunk("IEND", ByteArray(0))
  }

  /** [data] in zlib's stored (uncompressed) blocks, with its Adler-32: what every PNG reader takes. */
  private fun zlibStored(data: ByteArray): ByteArray {
    val out = ArrayList<Byte>(data.size + data.size / 65535 * 5 + 16)
    out += 0x78.toByte()
    out += 0x01.toByte()
    var at = 0
    do {
      val length = minOf(65535, data.size - at)
      val last = at + length >= data.size
      out += (if (last) 1 else 0).toByte()
      out += (length and 0xFF).toByte()
      out += (length shr 8 and 0xFF).toByte()
      out += (length.inv() and 0xFF).toByte()
      out += (length.inv() shr 8 and 0xFF).toByte()
      for (index in at until at + length) out += data[index]
      at += length
    } while (at < data.size)
    var a = 1L
    var b = 0L
    for (byte in data) {
      a = (a + (byte.toInt() and 0xFF)) % 65521
      b = (b + a) % 65521
    }
    val adler = ByteArray(4).also { putInt(it, 0, ((b shl 16) or a).toInt()) }
    return out.toByteArray() + adler
  }

  private fun chunk(type: String, data: ByteArray): ByteArray {
    val typed = type.encodeToByteArray() + data
    val length = ByteArray(4).also { putInt(it, 0, data.size) }
    val crc = ByteArray(4).also { putInt(it, 0, crc32(typed).toInt()) }
    return length + typed + crc
  }

  private val crcTable = LongArray(256) { n ->
    var c = n.toLong()
    repeat(8) { c = if (c and 1L != 0L) 0xEDB88320L xor (c ushr 1) else c ushr 1 }
    c
  }

  private fun crc32(data: ByteArray): Long {
    var c = 0xFFFFFFFFL
    for (byte in data) c = crcTable[((c xor (byte.toLong() and 0xFF)) and 0xFF).toInt()] xor (c ushr 8)
    return c xor 0xFFFFFFFFL
  }

  private fun putInt(into: ByteArray, at: Int, value: Int) {
    into[at] = (value ushr 24).toByte()
    into[at + 1] = (value ushr 16).toByte()
    into[at + 2] = (value ushr 8).toByte()
    into[at + 3] = value.toByte()
  }
}

/**
 * The pad a `signature` field draws: sign with a finger, a stylus or a mouse, Clear to start again, and the field's help
 * beside it (the console's "Sign with your finger, a stylus or a mouse."). The pad's ground and ink are the theme's
 * surface and its text; only the stored picture is black on white.
 */
@Composable
internal fun SignatureFieldInput(field: FieldSpec, label: String, help: String?, value: String, onChange: (String) -> Unit) {
  val stored = remember(value) { SignatureInk.strokesOf(value) }
  val current by rememberUpdatedState(stored)
  val report by rememberUpdatedState(onChange)
  var live by remember { mutableStateOf<SignatureStrokes?>(null) }
  val shown = live ?: stored
  val colors = MaterialTheme.colorScheme
  val shape = MaterialTheme.shapes.small
  Column(Modifier.fillMaxWidth()) {
    // The label is the pad's accessible name, as the console's is; a `heading` field names the step above it.
    Canvas(
      Modifier.fillMaxWidth().aspectRatio(SignatureInk.ASPECT).clip(shape).background(colors.surface).border(1.dp, colors.outline, shape)
        .semantics { contentDescription = if (shown.isEmpty()) "$label: empty. Draw your signature here." else "$label: signed" }
        .testTag("signature-${field.key}")
        .pointerInput(Unit) {
          awaitEachGesture {
            val down = awaitFirstDown()
            down.consume()
            val side = size
            var strokes = SignatureInk.begin(current, SignatureInk.at(down.position.x, down.position.y, side.width.toFloat(), side.height.toFloat()))
            live = strokes
            while (true) {
              val event = awaitPointerEvent()
              val change = event.changes.firstOrNull { it.id == down.id } ?: break
              if (!change.pressed) {
                change.consume()
                break
              }
              SignatureInk.extend(strokes, SignatureInk.at(change.position.x, change.position.y, side.width.toFloat(), side.height.toFloat()))?.let {
                strokes = it
                live = it
              }
              change.consume()
            }
            report(SignatureInk.encode(strokes))
            live = null
          }
        },
    ) {
      val stroke = Stroke(width = max(2f, size.width / 320f), cap = StrokeCap.Round, join = StrokeJoin.Round)
      for (line in shown) {
        val path = Path()
        line.forEachIndexed { index, (x, y) ->
          val point = Offset(x / 1000f * size.width, y / 1000f * size.height)
          if (index == 0) path.moveTo(point.x, point.y) else path.lineTo(point.x, point.y)
        }
        if (line.size == 1) path.lineTo(line[0].first / 1000f * size.width + 0.5f, line[0].second / 1000f * size.height)
        drawPath(path, colors.onSurface, style = stroke)
      }
    }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Text(
        help.orEmpty(),
        Modifier.weight(1f).padding(top = space(0.5f)),
        style = MaterialTheme.typography.bodySmall,
        color = colors.onSurfaceVariant,
      )
      TextButton(onClick = { onChange("") }, enabled = shown.isNotEmpty(), modifier = Modifier.testTag("signature-clear-${field.key}")) { Text("Clear") }
    }
  }
}
