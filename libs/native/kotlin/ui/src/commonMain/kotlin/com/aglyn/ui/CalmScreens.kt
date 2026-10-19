package com.aglyn.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/*
 * The calmer screens' pieces (the nav redesign's eight rules): one primary action, summary before detail, advanced
 * folded, fewer boxes. Shared so every record screen reads the same.
 */

/** One action a record screen offers: in its ⋯ menu, or as its one filled button. */
data class RecordAction(val id: String, val label: String, val icon: String, val destructive: Boolean = false, val enabled: Boolean = true, val run: () -> Unit)

/**
 * A record's header: its title and the line under it (a status, a date), then on the right the ⋯ menu with every other
 * action and the one filled button, the next step for the record's state. No other button sits in the header.
 */
@Composable
fun RecordHeader(
  title: String,
  modifier: Modifier = Modifier,
  status: (@Composable () -> Unit)? = null,
  primary: RecordAction? = null,
  more: List<RecordAction> = emptyList(),
) {
  Row(modifier.fillMaxWidth().testTag("record-header"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.semantics { heading() })
      status?.invoke()
    }
    if (more.isNotEmpty()) {
      OverflowMenu(more.map { MenuAction(it.id, it.label, it.icon, destructive = it.destructive, enabled = it.enabled) { it.run() } }, contentDescription = "More actions")
    }
    primary?.let { action ->
      Button(onClick = action.run, enabled = action.enabled, modifier = Modifier.testTag(action.id)) {
        Icon(AglynIcons.named(action.icon), contentDescription = null, Modifier.size(18.dp))
        Text(action.label, Modifier.padding(start = space(1f)), maxLines = 1)
      }
    }
  }
}

/**
 * A section that stays folded until opened (Payment and refunds, Customer details, Timeline and notes): a heading with an
 * optional count, separated by a rule rather than a card.
 */
@Composable
fun FoldedSection(
  title: String,
  modifier: Modifier = Modifier,
  count: Int? = null,
  initiallyOpen: Boolean = false,
  tag: String? = null,
  content: @Composable ColumnScope.() -> Unit,
) {
  var open by rememberSaveable(title) { mutableStateOf(initiallyOpen) }
  Column(modifier.fillMaxWidth()) {
    HorizontalDivider(color = shellColors.divider)
    Row(
      Modifier.fillMaxWidth().clickable { open = !open }.heightIn(min = 48.dp).padding(vertical = space(1f))
        .then(if (tag != null) Modifier.testTag(tag) else Modifier)
        .semantics(mergeDescendants = true) { role = Role.Button; stateDescription = if (open) "Open" else "Folded"; heading() },
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(space(1f)),
    ) {
      Icon(AglynIcons.named(if (open) "expand_more" else "chevron_right"), null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
      Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
      count?.takeIf { it > 0 }?.let { Text(it.toString(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
    AnimatedVisibility(open) {
      Column(Modifier.fillMaxWidth().padding(start = space(3.5f), bottom = space(2f)), verticalArrangement = Arrangement.spacedBy(space(1f)), content = content)
    }
  }
}

/** A plain section: a heading and its lines, set apart by space rather than a card. */
@Composable
fun PlainSection(title: String?, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
  Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
    title?.let { Text(it, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() }) }
    content()
  }
}
