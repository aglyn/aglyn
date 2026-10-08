package com.aglyn.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/** The words a failure shows on screen: its own message, or a plain "try again". */
fun problemMessage(error: Throwable): String = error.message?.takeIf { it.isNotBlank() } ?: "Something went wrong. Try again."

/**
 * One act in flight: [busy] while it runs, [error] when it failed. A sheet or
 * dialog holds still while busy and shows the error in place, so a failed
 * save can be tried again without losing what was typed.
 */
class Busy {
  var busy by mutableStateOf(false)
  var error by mutableStateOf<String?>(null)

  fun run(scope: CoroutineScope, onDone: () -> Unit = {}, block: suspend () -> Unit) {
    busy = true
    error = null
    scope.launch {
      try {
        block()
        onDone()
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        error = problemMessage(failure)
      } finally {
        busy = false
      }
    }
  }
}

/**
 * A titled form in a full-height sheet: Cancel and a confirm in its header,
 * the content scrolling beneath, and [busy]'s error above it. The Apple kit's
 * `AglynFormSheet`. [onConfirm] runs the save; the caller closes the sheet
 * when it succeeds (usually `busy.run(scope, onDone = onDismiss) { … }`).
 */
@Composable
fun FormSheet(
  title: String,
  busy: Busy,
  onDismiss: () -> Unit,
  onConfirm: () -> Unit,
  modifier: Modifier = Modifier,
  confirmLabel: String = "Save",
  confirmEnabled: Boolean = true,
  destructive: Boolean = false,
  secondary: (@Composable () -> Unit)? = null,
  content: @Composable () -> Unit,
) {
  Dialog(onDismissRequest = { if (!busy.busy) onDismiss() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
    Surface(
      modifier.widthIn(max = 640.dp).fillMaxWidth(0.96f).heightIn(max = 860.dp).testTag("form-sheet"),
      shape = MaterialTheme.shapes.extraLarge,
      color = MaterialTheme.colorScheme.surface,
    ) {
      Column {
        Row(
          Modifier.padding(horizontal = space(2f), vertical = space(1.5f)),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(space(1f)),
        ) {
          Text(title, Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.titleLarge)
          TextButton(onClick = onDismiss, enabled = !busy.busy) { Text("Cancel") }
          secondary?.invoke()
          Button(
            onClick = onConfirm,
            enabled = confirmEnabled && !busy.busy,
            colors = if (destructive) ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error) else ButtonDefaults.buttonColors(),
            modifier = Modifier.testTag("form-sheet-confirm"),
          ) { Text(if (busy.busy) "Saving…" else confirmLabel) }
        }
        HorizontalDivider()
        Column(Modifier.verticalScroll(rememberScrollState()).padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
          busy.error?.let { NoticeBanner(it, StatusTone.ERROR) }
          content()
        }
      }
    }
  }
}

/** One entry of an [OverflowMenu]: its label, whether it destroys something (drawn in the error color), and what it does. */
data class MenuAction(val label: String, val destructive: Boolean = false, val onClick: () -> Unit)

/** A row's "more" button opening its actions; nothing is drawn when there are none. */
@Composable
fun OverflowMenu(actions: List<MenuAction>, modifier: Modifier = Modifier, description: String = "More actions") {
  if (actions.isEmpty()) return
  var open by remember { mutableStateOf(false) }
  androidx.compose.foundation.layout.Box(modifier) {
    IconButton(onClick = { open = true }) { Icon(AglynIcons.named("more_vert"), contentDescription = description) }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
      for (action in actions) {
        DropdownMenuItem(
          text = { Text(action.label, color = if (action.destructive) MaterialTheme.colorScheme.error else androidx.compose.ui.graphics.Color.Unspecified) },
          onClick = {
            open = false
            action.onClick()
          },
        )
      }
    }
  }
}
