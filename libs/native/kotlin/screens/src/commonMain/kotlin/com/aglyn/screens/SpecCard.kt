package com.aglyn.screens

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.SectionCard

/**
 * A spec screen's `cardSlot` card: one row, named and pictured as the screen is, that opens it. The screen is opened with
 * the plugin's id as `pluginId`, as a plugin's settings page opens its screens, so a `requires` of
 * `params.pluginId == <plugin>` holds from either door.
 */
@Composable
internal fun SpecCard(spec: ScreenSpec, pluginId: String, context: NativePluginContext) {
  SectionCard(null, Modifier.fillMaxWidth()) {
    AglynListItem(
      title = spec.label,
      supporting = spec.subtitle,
      icon = AglynIcons.named(spec.icon),
      trailing = { Icon(AglynIcons.named("chevron_right"), contentDescription = null) },
      onClick = { context.navigate(spec.id, mapOf("pluginId" to pluginId)) },
      modifier = Modifier.testTag("spec-card-${spec.id}"),
    )
  }
}
