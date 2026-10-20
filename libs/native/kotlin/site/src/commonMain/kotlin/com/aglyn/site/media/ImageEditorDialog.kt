package com.aglyn.site.media

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.aglyn.contracts.imageEditAspects
import com.aglyn.contracts.imageEditContentType
import com.aglyn.contracts.imageEditCopyName
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.ImageEditSession
import com.aglyn.ui.LocalImageTransformer
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.PickedFile
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.TextButton
import com.aglyn.ui.space
import com.aglyn.ui.toImageBitmapOrNull
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** The image's state in the editor: being fetched and opened, readable, or why not. */
private sealed interface EditorSource {
  data object Loading : EditorSource
  data class Ready(val session: ImageEditSession) : EditorSource
  data class Failed(val message: String) : EditorSource
}

/**
 * The media library's image editor, the native side of the console's:
 * rotate, flip, a crop you drag (optionally locked to a ratio) and a max
 * width, then replace the original or save a copy. The pixels are the
 * device's ([LocalImageTransformer]); every number is the console's own
 * arithmetic ([ImageEditSettings]).
 *
 * [loadOriginal] fetches the file itself, not the display copy the library
 * shows; [onSave] is handed the edited file and whether it is a copy.
 */
@Composable
fun ImageEditorDialog(
  fileName: String,
  loadOriginal: suspend () -> ByteArray?,
  busy: Boolean,
  error: String?,
  onDismiss: () -> Unit,
  onSave: (file: PickedFile, asCopy: Boolean) -> Unit,
) {
  Dialog(onDismissRequest = { if (!busy) onDismiss() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
    Surface(
      Modifier.widthIn(max = 720.dp).fillMaxWidth(0.98f).heightIn(max = 900.dp).testTag("image-editor"),
      shape = MaterialTheme.shapes.extraLarge,
      color = MaterialTheme.colorScheme.surface,
    ) {
      ImageEditorContent(fileName, loadOriginal, busy, error, onDismiss, onSave)
    }
  }
}

/** The editor itself, without the dialog around it: the title, the picture with its controls, and the ways to save. */
@Composable
fun ImageEditorContent(
  fileName: String,
  loadOriginal: suspend () -> ByteArray?,
  busy: Boolean,
  error: String?,
  onDismiss: () -> Unit,
  onSave: (file: PickedFile, asCopy: Boolean) -> Unit,
) {
  val transformer = LocalImageTransformer.current
  var source by remember { mutableStateOf<EditorSource>(EditorSource.Loading) }
  val opened = remember { arrayOfNulls<ImageEditSession>(1) }
  LaunchedEffect(Unit) {
    val bytes = runCatching { loadOriginal() }.getOrNull()
    val session = if (bytes == null || transformer == null) null else withContext(Dispatchers.Default) { transformer.open(bytes) }
    opened[0] = session
    source = when {
      session != null -> EditorSource.Ready(session)
      bytes == null -> EditorSource.Failed("The image could not be loaded. Check the connection and try again.")
      else -> EditorSource.Failed("This image's format cannot be edited here. Replace it with a new file instead.")
    }
  }
  DisposableEffect(Unit) { onDispose { opened[0]?.close() } }

  Column {
    Row(Modifier.padding(horizontal = space(2f), vertical = space(1.5f)), verticalAlignment = Alignment.CenterVertically) {
      Text("Edit image", Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.titleLarge)
      TextButton(onClick = onDismiss, enabled = !busy, modifier = Modifier.testTag("image-edit-cancel")) { Text("Cancel") }
    }
    HorizontalDivider()
    when (val state = source) {
      EditorSource.Loading -> Box(Modifier.fillMaxWidth().padding(space(6f)), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(Modifier.semantics { contentDescription = "Loading image" })
      }
      is EditorSource.Failed -> Column(Modifier.padding(space(2f))) { NoticeBanner(state.message, StatusTone.ERROR, Modifier.testTag("image-edit-failed")) }
      is EditorSource.Ready -> EditorBody(fileName, state.session, busy, error, onSave)
    }
  }
}

@Composable
private fun EditorBody(
  fileName: String,
  session: ImageEditSession,
  busy: Boolean,
  error: String?,
  save: (PickedFile, Boolean) -> Unit,
) {
  var settings by remember(session) { mutableStateOf(ImageEditSettings()) }
  var rendering by remember { mutableStateOf(false) }
  var problem by remember { mutableStateOf<String?>(null) }
  val coroutines = rememberCoroutineScope()
  val (previewW, previewH) = settings.previewSize(session.width, session.height)
  val preview: ImageBitmap? by produceState<ImageBitmap?>(null, session, settings.rotation, settings.flipH, settings.flipV) {
    value = withContext(Dispatchers.Default) { session.render(settings.previewPlan(session.width, session.height))?.toImageBitmapOrNull() }
  }

  Column(Modifier.fillMaxWidth()) {
    Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
      Box(
        Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.shapes.medium).padding(space(1f)),
        contentAlignment = Alignment.Center,
      ) {
        val shown = preview
        if (shown == null) {
          Box(Modifier.heightIn(min = 160.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        } else {
          var start by remember { mutableStateOf(Offset.Zero) }
          Box(
            Modifier
              .widthIn(max = 480.dp)
              .heightIn(max = 420.dp)
              .aspectRatio(previewW.toFloat() / previewH.toFloat())
              .testTag("image-edit-surface")
              .pointerInput(settings.rotation, settings.aspect, previewW, previewH) {
                // A drag on the picture draws the crop, in preview pixels like the console's.
                fun toPreview(point: Offset) = Offset(point.x / size.width * previewW, point.y / size.height * previewH)
                detectDragGestures(
                  onDragStart = { point -> start = toPreview(point) },
                  onDrag = { change, _ ->
                    change.consume()
                    val now = toPreview(change.position)
                    settings = settings.dragged(start.x.toDouble(), start.y.toDouble(), now.x.toDouble(), now.y.toDouble(), previewW, previewH)
                  },
                )
              },
          ) {
            Image(shown, "Preview of $fileName", Modifier.fillMaxSize(), contentScale = ContentScale.FillBounds)
            Canvas(Modifier.fillMaxSize()) {
              val crop = settings.crop ?: return@Canvas
              val kx = size.width / previewW
              val ky = size.height / previewH
              val left = (crop.x * kx).toFloat()
              val top = (crop.y * ky).toFloat()
              val width = (crop.w * kx).toFloat()
              val height = (crop.h * ky).toFloat()
              val dim = Color.Black.copy(alpha = 0.45f)
              drawRect(dim, Offset.Zero, Size(size.width, top))
              drawRect(dim, Offset(0f, top + height), Size(size.width, size.height - top - height))
              drawRect(dim, Offset(0f, top), Size(left, height))
              drawRect(dim, Offset(left + width, top), Size(size.width - left - width, height))
              drawRect(Color.White, Offset(left, top), Size(width, height), style = Stroke(width = 1.5f))
            }
          }
        }
      }
      Text(
        "Drag on the picture to set a crop. Pick a ratio first to lock its proportions.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
        OutlinedButton(onClick = { settings = settings.turned(clockwise = false) }, modifier = Modifier.testTag("image-edit-rotate-left")) {
          Icon(AglynIcons.named("rotate_left"), contentDescription = null)
          Text("Rotate left", Modifier.padding(start = space(1f)))
        }
        OutlinedButton(onClick = { settings = settings.turned(clockwise = true) }, modifier = Modifier.testTag("image-edit-rotate-right")) {
          Icon(AglynIcons.named("rotate_right"), contentDescription = null)
          Text("Rotate right", Modifier.padding(start = space(1f)))
        }
      }
      SwitchRow("Flip horizontally", settings.flipH, { settings = settings.copy(flipH = it) }, modifier = Modifier.testTag("image-edit-flip-h"))
      SwitchRow("Flip vertically", settings.flipV, { settings = settings.copy(flipV = it) }, modifier = Modifier.testTag("image-edit-flip-v"))
      Text("Crop ratio", style = MaterialTheme.typography.titleSmall)
      val ratios = imageEditAspects
      ChoiceChipRow(
        ratios.map { ChipOption(it.label, it.label) },
        ratios.firstOrNull { it.ratio == settings.aspect }?.label,
        { label -> settings = settings.withAspect(ratios.first { it.label == label }.ratio) },
        wrap = true,
      )
      if (settings.crop != null) {
        TextButton(onClick = { settings = settings.copy(crop = null) }, modifier = Modifier.testTag("image-edit-clear-crop")) { Text("Clear crop") }
      }
      OutlinedTextField(
        settings.maxWidth,
        { settings = settings.withMaxWidth(it) },
        label = { Text("Max width (px)") },
        supportingText = { Text("Blank keeps the size.") },
        singleLine = true,
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Number),
        modifier = Modifier.fillMaxWidth().testTag("image-edit-max-width"),
      )
      (problem ?: error)?.let { NoticeBanner(it, StatusTone.ERROR, Modifier.testTag("image-edit-error")) }
    }
    // The ways to save stay in view while the controls scroll.
    HorizontalDivider()
    Row(Modifier.fillMaxWidth().padding(space(2f)), horizontalArrangement = Arrangement.spacedBy(space(1f), Alignment.End)) {
      val working = busy || rendering
      fun finish(asCopy: Boolean) {
        rendering = true
        problem = null
        coroutines.launch {
          val plan = settings.savePlan(session.width, session.height, fileName)
          val bytes = withContext(Dispatchers.Default) { session.render(plan) }
          rendering = false
          if (bytes == null) {
            problem = "The edited image could not be saved. It may be too large for this device."
          } else {
            save(PickedFile(if (asCopy) imageEditCopyName(fileName) else fileName, imageEditContentType(fileName), bytes), asCopy)
          }
        }
      }
      OutlinedButton(onClick = { finish(asCopy = true) }, enabled = !working, modifier = Modifier.testTag("image-edit-save-copy")) { Text("Save as copy") }
      Button(onClick = { finish(asCopy = false) }, enabled = !working, modifier = Modifier.testTag("image-edit-replace")) {
        Text(if (working) "Saving…" else "Replace original")
      }
    }
  }
}
