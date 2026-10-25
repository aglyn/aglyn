package com.aglyn.site.media

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.parseMediaRef
import com.aglyn.core.mediaPreviewUrl
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.RemoteImage
import com.aglyn.ui.TextButton
import com.aglyn.ui.space

/**
 * A picture or film chosen from the media library, the way the console's
 * fields do: a preview, Choose from media (this site's files and the
 * workspace's), and Remove. A stored reference is not shown as text; nobody
 * edits one by hand. [onLink] adds "Use a link instead" for a file hosted
 * elsewhere (the console keeps that beside the picker for entry covers).
 */
@Composable
fun MediaPickField(
  context: NativePluginContext,
  label: String,
  value: String,
  onPick: (ChosenMedia) -> Unit,
  onClear: () -> Unit,
  modifier: Modifier = Modifier,
  kind: String = "image",
  enabled: Boolean = true,
  supporting: String? = null,
  onLink: ((String) -> Unit)? = null,
  /** The workspace's library alone, whichever site is picked (a workspace's own logo or favicon). */
  workspaceOnly: Boolean = false,
) {
  var choosing by remember { mutableStateOf(false) }
  var linkOpen by remember { mutableStateOf(value.startsWith("https://")) }
  val noun = if (kind == "video") "video" else "picture"
  Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(space(1f))) {
    Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(2f))) {
      if (kind == "video") {
        Column(Modifier.width(96.dp).height(72.dp)) {
          androidx.compose.material3.Icon(AglynIcons.named("video_library"), contentDescription = null)
          Text(if (value.isEmpty()) "No video" else if (parseMediaRef(value) != null) "From your media" else "Linked video", style = MaterialTheme.typography.labelSmall)
        }
      } else {
        RemoteImage(mediaPreviewUrl(value, context.api.origin, context.hostId), null, Modifier.width(96.dp).height(72.dp).clip(MaterialTheme.shapes.small), icon = "image")
      }
      Column {
        OutlinedButton(onClick = { choosing = true }, enabled = enabled, modifier = Modifier.testTag("media-pick-choose")) {
          Text(if (value.isEmpty()) "Choose from media" else "Replace from media")
        }
        if (value.isNotEmpty()) TextButton(onClick = { onClear(); linkOpen = false }, enabled = enabled, modifier = Modifier.testTag("media-pick-remove")) { Text("Remove") }
      }
    }
    supporting?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    if (onLink != null) {
      if (linkOpen) {
        // A picked file is a reference, not a link: the box stays empty for it rather than showing a value nobody edits by hand.
        OutlinedTextField(
          if (value.startsWith("https://") || value.isEmpty()) value else "",
          { onLink(it.trim()) },
          label = { Text("Link (https://)") },
          supportingText = { Text("A $noun hosted on another website, starting with https://") },
          singleLine = true,
          enabled = enabled,
          keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
          modifier = Modifier.fillMaxWidth(),
        )
      } else {
        TextButton(onClick = { linkOpen = true }, enabled = enabled) { Text("Use a link instead") }
      }
    }
  }
  if (choosing) {
    MediaChooserDialog(context, onChoose = { chosen -> choosing = false; linkOpen = false; onPick(chosen) }, onDismiss = { choosing = false }, kind = kind, workspaceOnly = workspaceOnly)
  }
}

/** A picture field that stores the pick's reference as its value. */
@Composable
fun MediaImageField(
  context: NativePluginContext,
  label: String,
  value: String,
  onChange: (String) -> Unit,
  modifier: Modifier = Modifier,
  enabled: Boolean = true,
  supporting: String? = null,
) = MediaPickField(context, label, value, onPick = { onChange(it.reference) }, onClear = { onChange("") }, modifier = modifier, enabled = enabled, supporting = supporting)
