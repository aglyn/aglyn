package com.aglyn.screens

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.site.media.MediaPickField

/** The workspace, site and API the screen is drawn for, for an input that needs them (the media chooser). */
internal val LocalSpecPlugin = staticCompositionLocalOf<NativePluginContext?> { null }

/**
 * What a `media` field holds for a file: the path the CDN serves it from, else its address (the console's `MediaUrlField`
 * stores `media.cdnPath ?: media.url`), so the logo and favicon a workspace saves read the same in the console, the apps
 * and the emails that show them.
 */
internal fun mediaFieldValue(cdnPath: String?, url: String?): String = cdnPath ?: url ?: ""

/**
 * A file chosen from the workspace's media library (`kind: "media"`), as the console's `MediaUrlField` offers it: the logo,
 * favicon or image is picked, never typed. The picker is the one the site's Setup uses ([MediaPickField]), over the
 * workspace's library alone; the value is the file's `cdnPath` (else its address).
 */
@Composable
internal fun MediaFieldInput(field: FieldSpec, value: String, onChange: (String) -> Unit) {
  val plugin = LocalSpecPlugin.current ?: return
  MediaPickField(
    plugin,
    field.label,
    value,
    onPick = { chosen -> onChange(mediaFieldValue(chosen.item.cdnPath, chosen.item.url)) },
    onClear = { onChange("") },
    modifier = Modifier.testTag("media-field-${field.key}"),
    enabled = plugin.orgId != null,
    workspaceOnly = true,
  )
}
