package com.aglyn.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.sp

/**
 * A list's quick search: a search icon, the words, and a clear button once there are any. On the desktop (Compact) it is
 * Figma's list toolbar Search: 28 tall, radius 6, the sunken ground with a subtle border, a 14 icon and 13 text.
 */
@Composable
fun SearchField(
  query: String,
  onQuery: (String) -> Unit,
  placeholder: String,
  modifier: Modifier = Modifier,
  onSearch: (() -> Unit)? = null,
) {
  val metrics = LocalShellMetrics.current
  // The desktop and the tablet draw Figma's 28 list search (Mac 13:483, iPad 13:2167); phones keep the touch field.
  if (metrics.compact || currentWidthClass() != WidthClass.COMPACT) {
    CompactListSearch(query, onQuery, placeholder, modifier, onSearch, metrics)
    return
  }
  OutlinedTextField(
    value = query,
    onValueChange = onQuery,
    modifier = modifier.fillMaxWidth().testTag("search-field"),
    placeholder = { Text(placeholder, maxLines = 1, overflow = TextOverflow.Ellipsis) },
    leadingIcon = { Icon(AglynIcons.named("search"), contentDescription = null) },
    trailingIcon = {
      if (query.isNotEmpty()) {
        WithTooltip("Clear search") { IconButton(onClick = { onQuery("") }) { Icon(AglynIcons.named("close"), contentDescription = "Clear search") } }
      }
    },
    singleLine = true,
    shape = MaterialTheme.shapes.extraLarge,
    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
    keyboardActions = KeyboardActions(onSearch = { onSearch?.invoke() }),
  )
}

@Composable
private fun CompactListSearch(
  query: String,
  onQuery: (String) -> Unit,
  placeholder: String,
  modifier: Modifier,
  onSearch: (() -> Unit)?,
  metrics: ShellMetrics,
) {
  val shape = androidx.compose.foundation.shape.RoundedCornerShape(metrics.controlRadius)
  val muted = MaterialTheme.colorScheme.onSurfaceVariant
  androidx.compose.foundation.text.BasicTextField(
    value = query,
    onValueChange = onQuery,
    singleLine = true,
    textStyle = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.sp, lineHeight = 18.sp, color = MaterialTheme.colorScheme.onSurface),
    cursorBrush = androidx.compose.ui.graphics.SolidColor(MaterialTheme.colorScheme.primary),
    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
    keyboardActions = KeyboardActions(onSearch = { onSearch?.invoke() }),
    modifier = modifier.fillMaxWidth().testTag("search-field"),
    decorationBox = { field ->
      Row(
        Modifier.fillMaxWidth().heightIn(min = 28.dp).clip(shape).background(MaterialTheme.colorScheme.surfaceVariant)
          .border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape).padding(start = 10.dp, end = if (query.isEmpty()) 10.dp else 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
      ) {
        Icon(AglynIcons.named("search"), contentDescription = null, modifier = Modifier.size(14.dp), tint = muted)
        Box(Modifier.weight(1f)) {
          if (query.isEmpty()) Text(placeholder, fontSize = 13.sp, lineHeight = 18.sp, color = muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
          field()
        }
        if (query.isNotEmpty()) {
          WithTooltip("Clear search") {
            IconButton(onClick = { onQuery("") }, modifier = Modifier.size(24.dp)) {
              Icon(AglynIcons.named("close"), contentDescription = "Clear search", modifier = Modifier.size(14.dp), tint = muted)
            }
          }
        }
      }
    },
  )
}

/**
 * A dialog that asks before one action and then runs it: a title, what will
 * happen, optional fields, and the confirm button. While [busy] the buttons
 * hold still and confirm shows progress; [error] says why the last try failed
 * and leaves the dialog open to try again. A [destructive] action (cancel an
 * order, refund) confirms in the error color.
 */
@Composable
fun ActionDialog(
  title: String,
  confirmLabel: String,
  onConfirm: () -> Unit,
  onDismiss: () -> Unit,
  modifier: Modifier = Modifier,
  body: String? = null,
  icon: String? = null,
  busy: Boolean = false,
  error: String? = null,
  confirmEnabled: Boolean = true,
  destructive: Boolean = false,
  dismissLabel: String = "Cancel",
  content: (@Composable () -> Unit)? = null,
) {
  // A screen's error outlives its dialogs: one already showing when this dialog opened (a refused publish behind a
  // delete) is not this dialog's, so it waits for this dialog's own confirm before showing an error (AGL-3903).
  val openedWith = remember { error }
  var confirmed by remember { mutableStateOf(false) }
  val shownError = if (confirmed) error else error?.takeIf { it != openedWith }
  AlertDialog(
    onDismissRequest = { if (!busy) onDismiss() },
    modifier = modifier.testTag("action-dialog"),
    // The glyph says what kind of act it is: the error color for a destructive one, else the brand primary.
    icon = icon?.let { name -> { Icon(AglynIcons.named(name), contentDescription = null, tint = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary) } },
    title = { Text(title) },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
        if (body != null) Text(body, style = MaterialTheme.typography.bodyMedium)
        content?.invoke()
        if (shownError != null) NoticeBanner(shownError, StatusTone.ERROR, Modifier.testTag("action-dialog-error"))
      }
    },
    confirmButton = {
      // Material dialogs act through text buttons at the end; a destructive one is said in the error color, never as "OK".
      val tint = if (destructive) MaterialTheme.colorScheme.error else aglynAccentText
      TextButton(
        onClick = {
          confirmed = true
          onConfirm()
        },
        enabled = confirmEnabled && !busy,
        colors = ButtonDefaults.textButtonColors(contentColor = tint),
        modifier = Modifier.testTag("action-dialog-confirm"),
      ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = tint)
          Text(confirmLabel, fontWeight = FontWeight.SemiBold)
        }
      }
    },
    dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text(dismissLabel) } },
  )
}
