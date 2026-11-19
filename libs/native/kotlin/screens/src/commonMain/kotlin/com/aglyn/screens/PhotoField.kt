package com.aglyn.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.ImageEditPlan
import com.aglyn.ui.LocalImageTransformer
import com.aglyn.ui.LocalMediaPicker
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.PickSource
import com.aglyn.ui.PickedFile
import com.aglyn.ui.pickSourceLabel
import com.aglyn.ui.space
import com.aglyn.ui.toImageBitmapOrNull
import kotlinx.coroutines.launch
import kotlin.math.floor
import kotlin.math.max

/**
 * A PHOTO OF A PAGE (`kind: "photo"`), as the console's paper waiver takes one (AGL-4042, `shrinkPhoto`): taken with the
 * camera or picked from the photos, stood upright and shrunk to a JPEG no wider or taller than `maxEdge` pixels (1600),
 * never made larger. The value is the picture as a `data:image/jpeg;base64,` address, the shape `waivers/paper` takes.
 */
internal object PagePhoto {
  const val MAX_EDGE = 1600

  /** The console's `Math.round`: half up. */
  private fun rounded(value: Double) = floor(value + 0.5).toInt()

  /** How a picture [width] by [height] is drawn: whole, upright, scaled so its longer side is at most [maxEdge]. */
  fun plan(width: Int, height: Int, maxEdge: Int = MAX_EDGE): ImageEditPlan {
    val scale = minOf(1.0, maxEdge.toDouble() / max(1, max(width, height)))
    return ImageEditPlan(
      rotation = 0, flipH = false, flipV = false,
      cropX = 0, cropY = 0, cropW = width, cropH = height,
      width = max(1, rounded(width * scale)), height = max(1, rounded(height * scale)),
      png = false,
    )
  }

  fun dataUrl(jpeg: ByteArray): String = "data:image/jpeg;base64," + ScreenValues.base64(jpeg)

  /** A `data:` address's bytes, or null. */
  @OptIn(kotlin.io.encoding.ExperimentalEncodingApi::class)
  fun bytesOf(dataUrl: String): ByteArray? {
    val comma = dataUrl.indexOf(";base64,")
    if (!dataUrl.startsWith("data:image/") || comma < 0) return null
    return runCatching { kotlin.io.encoding.Base64.Default.decode(dataUrl.substring(comma + 8)) }.getOrNull()
  }
}

/** The sources a page's photo comes from: the camera and the photos, the files only where a device has nothing else. */
internal fun pagePhotoSources(offered: List<PickSource>): List<PickSource> =
  offered.filter { it != PickSource.FILES }.ifEmpty { offered }

@Composable
internal fun PhotoFieldInput(field: FieldSpec, label: String, value: String, onChange: (String) -> Unit) {
  val picker = LocalMediaPicker.current
  val transformer = LocalImageTransformer.current
  val scope = rememberCoroutineScope()
  var open by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  val sources = pagePhotoSources(picker?.sources.orEmpty())
  val maxEdge = (field.config as? kotlinx.serialization.json.JsonObject)?.get("maxEdge")?.let { ScreenValues.number(it) }?.toInt() ?: PagePhoto.MAX_EDGE
  val retake = (field.config as? kotlinx.serialization.json.JsonObject)?.get("retakeLabel")?.let { ScreenValues.text(it) }
  val alt = (field.config as? kotlinx.serialization.json.JsonObject)?.get("alt")?.let { ScreenValues.text(it) }
  val preview = remember(value) { PagePhoto.bytesOf(value)?.toImageBitmapOrNull() }

  fun take(file: PickedFile) {
    val session = transformer?.open(file.bytes)
    val jpeg = session?.let { opened -> opened.render(PagePhoto.plan(opened.width, opened.height, maxEdge)).also { opened.close() } }
    if (jpeg == null) {
      error = "That file is not a photo."
    } else {
      error = null
      onChange(PagePhoto.dataUrl(jpeg))
    }
  }

  fun pick(source: PickSource) {
    open = false
    scope.launch { picker?.pick(source, multiple = false)?.firstOrNull()?.let(::take) }
  }

  Column(Modifier.fillMaxWidth()) {
    Box {
      OutlinedButton(
        onClick = { if (sources.size == 1) pick(sources.single()) else open = true },
        enabled = sources.isNotEmpty(),
        modifier = Modifier.fillMaxWidth().testTag("photo-${field.key}"),
      ) { Text(if (value.isNotEmpty() && retake != null) retake else label) }
      DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
        sources.forEach { source ->
          val (words, icon) = pickSourceLabel(source)
          DropdownMenuItem(
            text = { Text(words) },
            leadingIcon = { Icon(AglynIcons.named(icon), null) },
            onClick = { pick(source) },
            modifier = Modifier.testTag("photo-${field.key}-${source.name.lowercase()}"),
          )
        }
      }
    }
    if (preview != null) {
      Image(
        preview,
        contentDescription = alt ?: label,
        modifier = Modifier.fillMaxWidth().heightIn(max = 360.dp).padding(top = space(1f)).clip(MaterialTheme.shapes.small),
        contentScale = ContentScale.Fit,
      )
    }
    error?.let { Text(it, Modifier.padding(top = space(0.5f)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
  }
}
