package com.aglyn.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/** A list's quick search: a search icon, the words, and a clear button once there are any. */
@Composable
fun SearchField(
  query: String,
  onQuery: (String) -> Unit,
  placeholder: String,
  modifier: Modifier = Modifier,
  onSearch: (() -> Unit)? = null,
) {
  OutlinedTextField(
    value = query,
    onValueChange = onQuery,
    modifier = modifier.fillMaxWidth().testTag("search-field"),
    placeholder = { Text(placeholder, maxLines = 1, overflow = TextOverflow.Ellipsis) },
    leadingIcon = { Icon(AglynIcons.named("search"), contentDescription = null) },
    trailingIcon = {
      if (query.isNotEmpty()) {
        IconButton(onClick = { onQuery("") }) { Icon(AglynIcons.named("close"), contentDescription = "Clear search") }
      }
    },
    singleLine = true,
    shape = MaterialTheme.shapes.extraLarge,
    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
    keyboardActions = KeyboardActions(onSearch = { onSearch?.invoke() }),
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
  dismissLabel: String = "Not now",
  content: (@Composable () -> Unit)? = null,
) {
  AlertDialog(
    onDismissRequest = { if (!busy) onDismiss() },
    modifier = modifier.testTag("action-dialog"),
    icon = icon?.let { name -> { Icon(AglynIcons.named(name), contentDescription = null) } },
    title = { Text(title) },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
        if (body != null) Text(body, style = MaterialTheme.typography.bodyMedium)
        content?.invoke()
        if (error != null) NoticeBanner(error, StatusTone.ERROR)
      }
    },
    confirmButton = {
      Button(
        onClick = onConfirm,
        enabled = confirmEnabled && !busy,
        colors = if (destructive) {
          ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error, contentColor = MaterialTheme.colorScheme.onError)
        } else {
          ButtonDefaults.buttonColors()
        },
        modifier = Modifier.testTag("action-dialog-confirm"),
      ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
          Text(confirmLabel)
        }
      }
    },
    dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text(dismissLabel) } },
  )
}
