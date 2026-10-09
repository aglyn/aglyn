package com.aglyn.site.setup

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.aglyn.core.ConsoleApiError
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.LocalMediaPicker
import com.aglyn.ui.MenuAction
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OverflowMenu
import com.aglyn.ui.PickSource
import com.aglyn.ui.PickedFile
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

enum class FontJobStep(val label: String) {
  QUEUED("Waiting"),
  CHECKING("Checking the license"),
  SAVING("Saving to your media library"),
  INSTALLED("Installed"),
  FAILED("Failed"),
}

/** One file on its way in. */
class FontJob(val fileName: String, val bytes: Long, step: FontJobStep) {
  var step by mutableStateOf(step)
  var family by mutableStateOf<String?>(null)
  var weightLabel by mutableStateOf<String?>(null)
  var replaced by mutableStateOf(false)
  var warnings by mutableStateOf<List<String>>(emptyList())
  var error by mutableStateOf<String?>(null)
}

private fun failure(error: Throwable, fallback: String) = (error as? ConsoleApiError)?.message ?: fallback

/**
 * A site's own fonts: the installed families with their role, category and
 * files, and the file chooser that adds more. Part of Setup > Theme. Files
 * are installed one at a time, so two files for the same slot picked
 * together never both see no face there and store two copies.
 */
@Composable
internal fun FontInstallerCard(context: NativePluginContext, hostId: String, canEdit: Boolean) {
  val api = remember(hostId, context.api) { FontsApi(context.api, hostId) }
  val scope = rememberCoroutineScope()
  val picker = LocalMediaPicker.current
  var installed by remember(hostId) { mutableStateOf<com.aglyn.ui.Load<List<InstalledFont>>>(com.aglyn.ui.Load.Loading) }
  val jobs = remember(hostId) { mutableStateListOf<FontJob>() }
  var error by remember { mutableStateOf<String?>(null) }
  var notice by remember { mutableStateOf<String?>(null) }
  var removing by remember { mutableStateOf<InstalledFont?>(null) }
  var queue by remember(hostId) { mutableStateOf(emptyList<Pair<FontJob, PickedFile>>()) }
  var running by remember(hostId) { mutableStateOf(false) }

  LaunchedEffect(hostId) {
    installed = try {
      com.aglyn.ui.Load.Ready(api.installed())
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
      com.aglyn.ui.Load.Failed(failure(failure, "Your fonts could not be loaded."))
    }
  }

  LaunchedEffect(queue, running) {
    if (running || queue.isEmpty()) return@LaunchedEffect
    running = true
    val (job, file) = queue.first()
    queue = queue.drop(1)
    try {
      job.step = FontJobStep.CHECKING
      val prepared = api.prepare(file)
      job.step = FontJobStep.SAVING
      job.family = prepared.family
      job.weightLabel = prepared.weightLabel
      job.warnings = prepared.warnings
      val stored = api.store(prepared, api.plan(prepared))
      installed = com.aglyn.ui.Load.Ready(api.install(prepared, stored.mediaId, stored.version))
      job.replaced = stored.replaced
      job.step = FontJobStep.INSTALLED
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
      job.step = FontJobStep.FAILED
      job.error = failure(failure, "The font could not be installed. Try again.")
    } finally {
      running = false
    }
  }

  fun add(files: List<PickedFile>) {
    val added = files.map { file ->
      val ok = isFontFileName(file.name)
      FontJob(file.name, file.size, if (ok) FontJobStep.QUEUED else FontJobStep.FAILED).also {
        if (!ok) it.error = "This is not a font file. Upload a .woff2, .woff, .ttf or .otf file."
      } to file
    }
    jobs.addAll(0, added.map { it.first })
    queue = queue + added.filter { it.first.step == FontJobStep.QUEUED }
  }

  fun change(success: String?, block: suspend () -> List<InstalledFont>) {
    error = null
    notice = null
    scope.launch {
      try {
        installed = com.aglyn.ui.Load.Ready(block())
        notice = success
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        error = failure(failure, "That did not go through. Check the connection and try again.")
      }
    }
  }

  SectionCard("Your fonts") {
    Text(
      "Upload your own fonts: .woff2, .woff, .ttf or .otf, up to ${FONT_UPLOAD_MAX_BYTES / 1024 / 1024} MB each. A font that forbids embedding is refused.",
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    error?.let { NoticeBanner(it, StatusTone.ERROR) }
    notice?.let { NoticeBanner(it, StatusTone.SUCCESS) }
    when (val live = installed) {
      com.aglyn.ui.Load.Loading -> SkeletonList(rows = 1)
      is com.aglyn.ui.Load.Failed -> Text(live.message, color = MaterialTheme.colorScheme.onSurfaceVariant)
      is com.aglyn.ui.Load.Ready -> {
        if (live.value.isEmpty()) Text("None yet. Add a font file to use it in your theme.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        live.value.forEach { font -> InstalledFontRow(font, canEdit, { success, block -> change(success) { block(api) } }, { removing = font }) }
      }
    }
    OutlinedButton(
      onClick = {
        val device = picker ?: return@OutlinedButton
        scope.launch {
          val files = runCatching { device.pick(PickSource.FILES, multiple = true) }.getOrDefault(emptyList())
          if (files.isNotEmpty()) add(files)
        }
      },
      enabled = canEdit && picker != null,
      modifier = Modifier.testTag("add-font-files"),
    ) {
      Icon(AglynIcons.named("add"), contentDescription = null)
      Text("Add font files", Modifier.padding(start = space(1f)))
    }
    jobs.forEach { job -> FontJobRow(job, onDismiss = { jobs.remove(job) }) }
  }
  removing?.let { font ->
    ActionDialog(
      title = "Remove ${font.family}?",
      body = "Text styles using it go back to what they inherit. The files stay in your media library.",
      icon = "delete",
      confirmLabel = "Remove",
      destructive = true,
      onDismiss = { removing = null },
      onConfirm = {
        removing = null
        change("Removed ${font.family}.") { api.remove(font.family) }
      },
    )
  }
}

@Composable
private fun InstalledFontRow(
  font: InstalledFont,
  canEdit: Boolean,
  change: (String?, suspend (FontsApi) -> List<InstalledFont>) -> Unit,
  onRemove: () -> Unit,
) {
  var open by remember { mutableStateOf(false) }
  val category = font.category?.let { c -> FONT_CATEGORIES.firstOrNull { it.first == c }?.second ?: c }
  AglynListItem(
    title = font.family,
    supporting = listOfNotNull(category, if (font.faces.size == 1) "1 file" else "${font.faces.size} files").joinToString(" · "),
    icon = AglynIcons.named("text_fields"),
    trailing = {
      Row(verticalAlignment = Alignment.CenterVertically) {
        font.roles.forEach { StatusChip(it.label, StatusTone.INFO) }
        OverflowMenu(
          buildList {
            FontRole.entries.forEach { role ->
              val used = role in font.roles
              add(
                MenuAction("role-${role.key}", if (used) "Used for ${role.label.lowercase()}" else "Use for ${role.label.lowercase()}", if (used) "check" else "text_fields", enabled = canEdit && !used) {
                  change("${font.family} is set for ${role.label.lowercase()}.") { it.setRole(font.family, role) }
                },
              )
            }
            FONT_CATEGORIES.forEach { (value, label) ->
              add(MenuAction("category-$value", "Category: $label", if (font.category == value) "check" else "category", enabled = canEdit && font.category != value) {
                change("Saved.") { it.setCategory(font.family, value) }
              })
            }
            add(MenuAction("files", if (open) "Hide files" else "Show files", "description") { open = !open })
            add(MenuAction("remove", "Remove font", "delete", destructive = true, enabled = canEdit, onClick = onRemove))
          },
          contentDescription = "Actions for ${font.family}",
        )
      }
    },
    modifier = Modifier.testTag("font-${font.family}"),
  )
  if (open) {
    font.faces.forEach { face ->
      Row(Modifier.fillMaxWidth().padding(start = space(2f)), verticalAlignment = Alignment.CenterVertically) {
        Text(face.label, Modifier.padding(end = space(1f)), style = MaterialTheme.typography.bodyMedium)
        Text(face.style, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
        IconButton(onClick = { change("Removed that file.") { it.remove(face, font.family) } }, enabled = canEdit) {
          Icon(AglynIcons.named("delete"), contentDescription = "Remove ${face.label} of ${font.family}")
        }
      }
    }
  }
}

@Composable
private fun FontJobRow(job: FontJob, onDismiss: () -> Unit) {
  Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Text(job.family?.let { "$it ${job.weightLabel.orEmpty()}" } ?: job.fileName, Modifier.weight(1f), maxLines = 1)
      when (job.step) {
        FontJobStep.CHECKING, FontJobStep.SAVING -> CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
        FontJobStep.INSTALLED -> StatusChip(if (job.replaced) "Replaced" else "Installed", StatusTone.SUCCESS)
        FontJobStep.FAILED -> StatusChip("Failed", StatusTone.ERROR)
        FontJobStep.QUEUED -> StatusChip("Waiting")
      }
      if (job.step == FontJobStep.INSTALLED || job.step == FontJobStep.FAILED) {
        IconButton(onClick = onDismiss) { Icon(AglynIcons.named("close"), contentDescription = "Dismiss") }
      }
    }
    Text(
      job.error ?: "${job.step.label} · ${fontFileSize(job.bytes)}",
      style = MaterialTheme.typography.bodySmall,
      color = if (job.error == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error,
    )
    job.warnings.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.tertiary) }
  }
}
