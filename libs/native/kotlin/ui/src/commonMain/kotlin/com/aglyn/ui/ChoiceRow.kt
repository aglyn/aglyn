package com.aglyn.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/** What a [ChoiceRow] shows beside its label, its address null until there is one. */
data class ChoicePicture(val url: String?)

/**
 * One row of a single choice (an Aglyn AI tier, a plan): a radio that fills when it is the one chosen, a label with a
 * supporting line under it, and a trailing [badge] ("Current"). A row that cannot be chosen stays on screen, dimmed,
 * its supporting line saying why: a prerequisite is shown, never hidden. The whole row selects. A row with a [picture] shows
 * what it picks beside its label, in the words a card of pictures uses (a site starter).
 */
@Composable
fun ChoiceRow(
  title: String,
  selected: Boolean,
  onSelect: () -> Unit,
  modifier: Modifier = Modifier,
  supporting: String? = null,
  enabled: Boolean = true,
  picture: ChoicePicture? = null,
  badge: (@Composable () -> Unit)? = null,
) {
  Row(
    modifier
      .fillMaxWidth()
      .heightIn(min = if (LocalUiDensity.current.compact) 48.dp else 56.dp)
      .selectable(selected = selected, enabled = enabled, role = Role.RadioButton, onClick = onSelect)
      .alpha(if (enabled) 1f else 0.5f)
      .padding(horizontal = space(2f), vertical = space(1f)),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(space(1.5f)),
  ) {
    // The row is the control; the radio only shows its state.
    RadioButton(selected = selected, onClick = null, enabled = enabled)
    if (picture != null) {
      val side = if (LocalUiDensity.current.compact) 44.dp else 56.dp
      RemoteImage(picture.url, null, Modifier.size(side).clip(MaterialTheme.shapes.small))
    }
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      if (picture != null) {
        Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
      } else {
        Text(title, style = MaterialTheme.typography.bodyLarge)
      }
      if (supporting != null) {
        Text(supporting, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    badge?.invoke()
  }
}
