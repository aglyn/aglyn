package com.aglyn.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/**
 * A setting that is on or off: a label, an optional supporting line and a
 * switch. The whole row toggles and reads as one switch to screen readers,
 * named by [title] and announced as on or off.
 */
@Composable
fun SwitchRow(
  title: String,
  checked: Boolean,
  onCheckedChange: (Boolean) -> Unit,
  modifier: Modifier = Modifier,
  supporting: String? = null,
  enabled: Boolean = true,
  /** A trailing note beside the switch (a level chip, say); not part of the toggle's name. */
  badge: (@Composable () -> Unit)? = null,
) {
  Row(
    modifier
      .fillMaxWidth()
      .heightIn(min = 56.dp)
      .toggleable(value = checked, enabled = enabled, role = Role.Switch, onValueChange = onCheckedChange)
      .semantics(mergeDescendants = true) {
        contentDescription = if (supporting != null) "$title. $supporting" else title
        stateDescription = if (checked) "On" else "Off"
      }
      .padding(horizontal = space(2f), vertical = space(1f)),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(space(1.5f)),
  ) {
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(title, style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
      if (supporting != null) {
        Text(
          supporting,
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 2,
          overflow = TextOverflow.Ellipsis,
        )
      }
    }
    badge?.invoke()
    // The row is the toggle; the switch only shows its state.
    Switch(checked = checked, onCheckedChange = null, enabled = enabled)
  }
}
