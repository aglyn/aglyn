package com.aglyn.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/*
 * Settings pages as grouped rows (the redesign's screen patterns): a group's heading, then rows of a title, one line of
 * description, and one trailing thing — a chevron to a page, a switch, or a status.
 */

/** What sits at a settings row's end. */
sealed interface SettingsTrailing {
  /** Opens a page or a picker; [value] is what is set now ("Comfortable"). */
  data class Opens(val value: String? = null) : SettingsTrailing
  data class Toggle(val checked: Boolean, val onChange: (Boolean) -> Unit, val enabled: Boolean = true) : SettingsTrailing
  /** A state with no action (Connected, Off). */
  data class Status(val text: String, val tone: StatusTone = StatusTone.NEUTRAL) : SettingsTrailing
  data object None : SettingsTrailing
}

/** A group of settings rows under one heading, on one rounded ground, the rows parted by hairlines. */
@Composable
fun SettingsGroup(title: String?, modifier: Modifier = Modifier, footer: String? = null, content: @Composable ColumnScope.() -> Unit) {
  Column(modifier.fillMaxWidth().padding(horizontal = space(2f), vertical = space(1f)), verticalArrangement = Arrangement.spacedBy(6.dp)) {
    title?.let {
      Text(it, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 4.dp).semantics { heading() })
    }
    Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainerLowest, tonalElevation = 0.dp, modifier = Modifier.fillMaxWidth()) {
      Column(content = content)
    }
    footer?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 4.dp)) }
  }
}

/** The hairline between two rows of a group. */
@Composable
fun SettingsDivider() = HorizontalDivider(Modifier.padding(start = space(2f)), color = MaterialTheme.colorScheme.outlineVariant)

/** One settings row: title, one line of description, and a chevron, a switch or a status at its end. */
@Composable
fun SettingsRow(
  title: String,
  modifier: Modifier = Modifier,
  description: String? = null,
  icon: String? = null,
  trailing: SettingsTrailing = SettingsTrailing.None,
  onClick: (() -> Unit)? = null,
) {
  val toggle = trailing as? SettingsTrailing.Toggle
  val click: (() -> Unit)? = onClick ?: toggle?.takeIf { it.enabled }?.let { t -> { t.onChange(!t.checked) } }
  val compact = LocalUiDensity.current.compact
  Row(
    modifier
      .fillMaxWidth()
      .then(if (click != null) Modifier.clickable(onClick = click) else Modifier)
      .heightIn(min = if (compact) 44.dp else 52.dp)
      .padding(horizontal = space(2f), vertical = if (compact) 6.dp else 10.dp)
      .semantics(mergeDescendants = true) {
        if (toggle != null) {
          role = Role.Switch
          toggleableState = ToggleableState(toggle.checked)
        } else if (click != null) {
          role = Role.Button
        }
      },
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(space(1.5f)),
  ) {
    icon?.let { Icon(AglynIcons.named(it), null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant) }
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
      description?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis) }
    }
    when (trailing) {
      is SettingsTrailing.Opens -> {
        trailing.value?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1) }
        Icon(AglynIcons.named("chevron_right"), null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      is SettingsTrailing.Toggle -> Switch(trailing.checked, onCheckedChange = null, enabled = trailing.enabled, modifier = Modifier.testTag("switch"))
      is SettingsTrailing.Status -> StatusChip(trailing.text, trailing.tone)
      SettingsTrailing.None -> Unit
    }
  }
}
