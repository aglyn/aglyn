package com.aglyn.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/** What a picture is previewed on: the ground it will be seen on. */
enum class ImageFileGround(val fill: Color, val ink: Color) {
  LIGHT(Color.White, Color(0xFF757575)),
  DARK(Color(0xFF212121), Color(0xFFBDBDBD)),
}

/** The sources a picture can come from: a logo is not a photo taken now. */
internal fun imageFileSources(sources: List<PickSource>): List<PickSource> = sources.filter { it != PickSource.CAMERA }

/**
 * Pick one image, see it, and take it away again: a tile on the [ground] the picture will be seen on, its [label], and
 * Choose file (Replace once one is held) with Remove beside it. It hands back the file and nothing else: what a form
 * accepts, what it refuses and where the file goes are the form's. [error] says why the last file was refused, over the
 * [helper] and the file's name. The console's `ImageFileField`; the Apple kit's `AglynImageFileField`.
 */
@Composable
fun ImageFileField(
  label: String,
  file: PickedFile?,
  onChoose: (PickedFile) -> Unit,
  onRemove: () -> Unit,
  modifier: Modifier = Modifier,
  ground: ImageFileGround? = null,
  helper: String? = null,
  error: String? = null,
  enabled: Boolean = true,
) {
  val picker = LocalMediaPicker.current
  val scope = rememberCoroutineScope()
  val colors = MaterialTheme.colorScheme
  val shape = MaterialTheme.shapes.small
  var open by remember { mutableStateOf(false) }
  val sources = imageFileSources(picker?.sources.orEmpty())
  val preview = remember(file) { file?.bytes?.toImageBitmapOrNull() }
  val below = error ?: file?.name ?: helper

  fun pick(source: PickSource) {
    open = false
    scope.launch { picker?.pick(source, multiple = false)?.firstOrNull()?.let(onChoose) }
  }

  Row(
    modifier.fillMaxWidth(),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(space(1.5f)),
  ) {
    Box(
      Modifier.size(56.dp).clip(shape).background(ground?.fill ?: colors.surface).border(1.dp, colors.outline, shape),
      contentAlignment = Alignment.Center,
    ) {
      if (preview != null) {
        Image(preview, null, Modifier.padding(space(0.5f)).size(48.dp), contentScale = ContentScale.Fit)
      } else {
        Icon(AglynIcons.named(if (file == null) "upload" else "image"), null, Modifier.size(20.dp), tint = ground?.ink ?: colors.onSurfaceVariant)
      }
    }
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(label, style = MaterialTheme.typography.bodyMedium, color = colors.onSurface)
      if (below != null) {
        Text(
          below,
          style = MaterialTheme.typography.bodySmall,
          color = if (error != null) colors.error else colors.onSurfaceVariant,
          // A file's name stays on one line; words wrap.
          maxLines = if (error == null && file != null) 1 else Int.MAX_VALUE,
          overflow = TextOverflow.Ellipsis,
        )
      }
    }
    if (file != null) {
      TextButton(onClick = onRemove, enabled = enabled, modifier = Modifier.semantics { contentDescription = "Remove $label" }.testTag("image-file-remove")) {
        Text("Remove")
      }
    }
    Box {
      OutlinedButton(
        onClick = { if (sources.size == 1) pick(sources.single()) else open = true },
        enabled = enabled && sources.isNotEmpty(),
        modifier = Modifier.semantics { contentDescription = (if (file == null) "Choose " else "Replace ") + label }.testTag("image-file-choose"),
      ) { Text(if (file == null) "Choose file" else "Replace") }
      DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
        sources.forEach { source ->
          val (words, icon) = pickSourceLabel(source)
          DropdownMenuItem(
            text = { Text(words) },
            leadingIcon = { Icon(AglynIcons.named(icon), null) },
            onClick = { pick(source) },
            modifier = Modifier.testTag("image-file-${source.name.lowercase()}"),
          )
        }
      }
    }
  }
}
