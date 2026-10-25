package com.aglyn.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.safeDrawingPadding
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
) = FormSheet(title, busy.busy, busy.error, onDismiss, onConfirm, modifier, confirmLabel, confirmEnabled, destructive, secondary, content)

/** [FormSheet] for a model that keeps its own [busy] flag and [error] (a screen model's write). */
@Composable
fun FormSheet(
  title: String,
  busy: Boolean,
  error: String?,
  onDismiss: () -> Unit,
  onConfirm: () -> Unit,
  modifier: Modifier = Modifier,
  confirmLabel: String = "Save",
  confirmEnabled: Boolean = true,
  destructive: Boolean = false,
  secondary: (@Composable () -> Unit)? = null,
  content: @Composable () -> Unit,
) {
  Dialog(onDismissRequest = { if (!busy) onDismiss() }, properties = sheetDialogProperties()) {
    Surface(
      // Clear of the keyboard and the system bars: the field being typed in scrolls into the room left above the keyboard.
      modifier.safeDrawingPadding().widthIn(max = 640.dp).fillMaxWidth(0.96f).heightIn(max = 860.dp).testTag("form-sheet"),
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
          TextButton(onClick = onDismiss, enabled = !busy) { Text("Cancel") }
          secondary?.invoke()
          Button(shape = controlShape(), 
            onClick = onConfirm,
            enabled = confirmEnabled && !busy,
            colors = if (destructive) ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error) else ButtonDefaults.buttonColors(),
            modifier = Modifier.testTag("form-sheet-confirm"),
          ) { Text(if (busy) "Saving…" else confirmLabel) }
        }
        HorizontalDivider()
        Column(Modifier.verticalScroll(rememberScrollState()).padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
          error?.let { NoticeBanner(it, StatusTone.ERROR) }
          content()
        }
      }
    }
  }
}

/**
 * A task with room to work in, above the screen it was opened from: full screen on a phone, a large rounded panel on a
 * tablet or desktop (Material's full-screen dialog). A close button with its tooltip starts the header, then the [title]
 * (and a quiet [subtitle]), then the panel's one primary [action]. The [content] scrolls beneath in a column at most
 * 720 dp wide. For a one-sentence confirm use [ActionDialog]; for a form with one Save, [FormSheet].
 */
@Composable
fun PanelSheet(
  title: String,
  onDismiss: () -> Unit,
  modifier: Modifier = Modifier,
  subtitle: String? = null,
  closeLabel: String = "Close",
  action: (@Composable RowScope.() -> Unit)? = null,
  /** False when the content scrolls on its own (a lazy list) or centers itself (an empty state). */
  scroll: Boolean = true,
  content: @Composable () -> Unit,
) {
  val compact = currentWidthClass() == WidthClass.COMPACT
  Dialog(onDismissRequest = onDismiss, properties = sheetDialogProperties()) {
    Surface(
      modifier.safeDrawingPadding().then(
        if (compact) Modifier.fillMaxSize() else Modifier.widthIn(max = 760.dp).fillMaxWidth(0.94f).heightIn(max = 920.dp).fillMaxHeight(0.92f),
      ).testTag("panel-sheet"),
      shape = if (compact) MaterialTheme.shapes.extraSmall else MaterialTheme.shapes.extraLarge,
      color = MaterialTheme.colorScheme.surface,
    ) {
      Column {
        Row(
          Modifier.fillMaxWidth().padding(start = space(1f), end = space(2f), top = space(1f), bottom = space(1f)),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(space(1f)),
        ) {
          AglynIconButton(AglynIcons.named("close"), closeLabel, onDismiss, Modifier.testTag("panel-sheet-close"))
          Column(Modifier.weight(1f)) {
            Text(title, Modifier.semantics { heading() }, style = MaterialTheme.typography.titleLarge, maxLines = 1)
            subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1) }
          }
          action?.invoke(this)
        }
        HorizontalDivider()
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
          Column(
            Modifier.widthIn(max = 720.dp).fillMaxWidth().then(if (scroll) Modifier.verticalScroll(rememberScrollState()) else Modifier.fillMaxHeight())
              .padding(space(2f)),
            verticalArrangement = Arrangement.spacedBy(space(1.5f)),
          ) { content() }
        }
      }
    }
  }
}
