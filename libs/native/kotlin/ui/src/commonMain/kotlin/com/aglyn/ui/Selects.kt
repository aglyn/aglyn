package com.aglyn.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/** A section of a [SectionNav]: its key, its label and an optional icon. */
data class SectionItem(val key: String, val label: String, val icon: String? = null)

/**
 * A page's sections: a row of chips across the top on phones, and a list
 * down the side on wider windows, beside [content]. The console's hub
 * sections (a section rail) as a native control.
 */
@Composable
fun SectionNav(
  sections: List<SectionItem>,
  selected: String,
  onSelect: (String) -> Unit,
  modifier: Modifier = Modifier,
  header: (@Composable () -> Unit)? = null,
  /** The narrowest window the sections move to the side at; narrower ones show chips across the top. */
  sideFrom: WidthClass = WidthClass.EXPANDED,
  content: @Composable () -> Unit,
) {
  val wide = currentWidthClass() >= sideFrom
  if (wide) {
    Row(modifier.fillMaxSize()) {
      Column(
        Modifier.width(220.dp).fillMaxHeight().verticalScroll(rememberScrollState()).padding(space(1.5f)),
        verticalArrangement = Arrangement.spacedBy(space(0.5f)),
      ) {
        header?.invoke()
        for (section in sections) {
          val on = section.key == selected
          Surface(
            shape = MaterialTheme.shapes.extraLarge,
            color = if (on) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
            contentColor = if (on) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier
              .fillMaxWidth()
              .clip(MaterialTheme.shapes.extraLarge)
              .clickable { onSelect(section.key) }
              .semantics {
                this.selected = on
                role = Role.Tab
              }
              .testTag("section-${section.key}"),
          ) {
            Row(
              Modifier.heightIn(min = 48.dp).padding(horizontal = space(2f)),
              verticalAlignment = Alignment.CenterVertically,
              horizontalArrangement = Arrangement.spacedBy(space(1.5f)),
            ) {
              section.icon?.let { Icon(AglynIcons.named(it), contentDescription = null, Modifier.size(20.dp)) }
              Text(section.label, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
          }
        }
      }
      androidx.compose.material3.VerticalDivider()
      Box(Modifier.weight(1f).fillMaxHeight()) { content() }
    }
  } else {
    Column(modifier.fillMaxSize()) {
      header?.invoke()
      ChoiceChipRow(
        options = sections.map { ChipOption(it.key, it.label, it.icon) },
        selected = selected,
        onSelect = onSelect,
        modifier = Modifier.fillMaxWidth().padding(horizontal = space(2f), vertical = space(1f)),
      )
      HorizontalDivider()
      Box(Modifier.weight(1f, fill = true)) { content() }
    }
  }
}

/** Puts [text] on the platform clipboard. */
@Composable
fun rememberCopyToClipboard(): (String) -> Unit {
  @Suppress("DEPRECATION")
  val clipboard = LocalClipboardManager.current
  return remember(clipboard) { { text: String -> clipboard.setText(AnnotatedString(text)) } }
}

/** A dialog that offers a short list of choices, one tap each, and Cancel: a menu where there is no anchor for one. */
@Composable
fun ChoiceDialog(
  title: String,
  options: List<SelectOption>,
  onPick: (String) -> Unit,
  onDismiss: () -> Unit,
  modifier: Modifier = Modifier,
  dismissLabel: String = "Cancel",
) {
  androidx.compose.material3.AlertDialog(
    onDismissRequest = onDismiss,
    modifier = modifier.testTag("choice-dialog"),
    title = { Text(title) },
    text = {
      Column {
        for (option in options) {
          Row(
            Modifier
              .fillMaxWidth()
              .heightIn(min = 48.dp)
              .clip(MaterialTheme.shapes.small)
              .clickable(enabled = option.enabled) { onPick(option.value) }
              .padding(horizontal = space(1f))
              .testTag("choice-${option.value}"),
            verticalAlignment = Alignment.CenterVertically,
          ) { Text(option.label, style = MaterialTheme.typography.bodyLarge) }
        }
      }
    },
    confirmButton = {},
    dismissButton = { androidx.compose.material3.TextButton(onClick = onDismiss) { Text(dismissLabel) } },
  )
}
