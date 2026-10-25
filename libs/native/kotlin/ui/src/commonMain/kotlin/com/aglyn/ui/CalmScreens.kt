package com.aglyn.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/*
 * The calmer screens' pieces (the nav redesign's eight rules): one primary action, summary before detail, advanced
 * folded, fewer boxes. Shared so every record screen reads the same.
 */

/** One action a record screen offers: in its ⋯ menu, or as its one filled button. */
data class RecordAction(val id: String, val label: String, val icon: String, val destructive: Boolean = false, val enabled: Boolean = true, val run: () -> Unit)

/**
 * A record's header: its title and the line under it (a status, a date), then on the right the ⋯ menu with every other
 * action and the one filled button, the next step for the record's state. No other button sits in the header. With
 * [settings], the title wears a ▾ that opens the record's own compact settings (Rename, Move…).
 */
@Composable
fun RecordHeader(
  title: String,
  modifier: Modifier = Modifier,
  status: (@Composable () -> Unit)? = null,
  primary: RecordAction? = null,
  more: List<RecordAction> = emptyList(),
  settings: List<RecordAction> = emptyList(),
) {
  var settingsOpen by remember { mutableStateOf(false) }
  Row(modifier.fillMaxWidth().testTag("record-header"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      if (settings.isEmpty()) {
        Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.semantics { heading() })
      } else {
        Box {
          Row(
            Modifier.clip(MaterialTheme.shapes.small).clickable { settingsOpen = true }.padding(end = 4.dp).testTag("record-title-menu")
              .semantics(mergeDescendants = true) { role = Role.Button; heading() },
            verticalAlignment = Alignment.CenterVertically,
          ) {
            Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            Icon(AglynIcons.named("expand_more"), contentDescription = "Settings for $title", Modifier.size(24.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
          }
          DropdownMenu(settingsOpen, onDismissRequest = { settingsOpen = false }, modifier = Modifier.testTag("record-settings")) {
            for (action in settings) {
              DropdownMenuItem(
                text = { Text(action.label) },
                leadingIcon = { Icon(AglynIcons.named(action.icon), null) },
                enabled = action.enabled,
                onClick = { settingsOpen = false; action.run() },
                modifier = Modifier.testTag(action.id),
              )
            }
          }
        }
      }
      status?.invoke()
    }
    // Beside a list (the desktop, a tablet) the head is Figma's (Mac 13:483, iPad 13:2167): the ⋯ in a bordered square,
    // then the standard filled button, as the list head draws them. A phone keeps its own.
    val compactHead = LocalShellMetrics.current.compact || currentWidthClass() != WidthClass.COMPACT
    if (more.isNotEmpty()) {
      OverflowMenu(
        more.map { MenuAction(it.id, it.label, it.icon, destructive = it.destructive, enabled = it.enabled) { it.run() } },
        contentDescription = "More actions", boxed = compactHead, boxSize = 36.dp,
      )
    }
    primary?.let { action ->
      if (compactHead) {
        // Figma's record head button is words only (iPad 13:2167 "Fulfill", 36 tall).
        CompactButton(action.label, null, action.run, Modifier.testTag(action.id), enabled = action.enabled, filled = true, tall = true)
      } else {
        Button(shape = controlShape(), onClick = action.run, enabled = action.enabled, modifier = Modifier.testTag(action.id)) {
          Icon(AglynIcons.named(action.icon), contentDescription = null, Modifier.size(18.dp))
          Text(action.label, Modifier.padding(start = space(1f)), maxLines = 1)
        }
      }
    }
  }
}

/**
 * A section that stays folded until opened (Customer details, Timeline and notes), as Figma's Section/Folded draws it
 * (Mac 13:483, iPad 13:2167): a row under a hairline, the chevron at the content's edge (it turns down when open), the
 * title, and the count on the right.
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
      horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      Box(Modifier.size(16.dp), contentAlignment = Alignment.CenterStart) {
        Icon(
          AglynIcons.named("chevron_right"), null,
          Modifier.size(16.dp).graphicsLayer { rotationZ = if (open) 90f else 0f },
          tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
      Text(title, fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.weight(1f))
      count?.takeIf { it > 0 }?.let { Text(it.toString(), fontSize = 12.sp, lineHeight = 16.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
    AnimatedVisibility(open) {
      Column(Modifier.fillMaxWidth().padding(start = 28.dp, bottom = space(2f)), verticalArrangement = Arrangement.spacedBy(space(1f)), content = content)
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

/**
 * The dismissible "Start from a template" strip over a list (the redesign's screen patterns): one line saying what the
 * templates are for, a button that opens them, and a close. Its owner keeps the item in a menu too, so dismissing it
 * never hides the way in.
 */
@Composable
fun TemplateStrip(text: String, action: String, onOpen: () -> Unit, onDismiss: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
  androidx.compose.material3.Surface(
    shape = MaterialTheme.shapes.medium,
    color = MaterialTheme.colorScheme.primaryContainer,
    modifier = modifier.fillMaxWidth().testTag("template-strip"),
  ) {
    Row(Modifier.padding(start = space(2f), end = space(0.5f), top = space(1f), bottom = space(1f)), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      Icon(AglynIcons.named("widgets"), null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onPrimaryContainer)
      Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onPrimaryContainer, modifier = Modifier.weight(1f))
      TextButton(onClick = onOpen, enabled = enabled, modifier = Modifier.testTag("template-strip-open")) { Text(action) }
      androidx.compose.material3.IconButton(onClick = onDismiss, modifier = Modifier.testTag("template-strip-dismiss")) {
        Icon(AglynIcons.named("close"), contentDescription = "Dismiss", Modifier.size(18.dp))
      }
    }
  }
}
