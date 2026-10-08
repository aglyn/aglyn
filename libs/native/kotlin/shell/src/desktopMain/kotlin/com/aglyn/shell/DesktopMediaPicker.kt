package com.aglyn.shell

import com.aglyn.ui.MediaPicker
import com.aglyn.ui.PickSource
import com.aglyn.ui.PickedFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.awt.FileDialog
import java.awt.Frame
import java.io.File
import java.nio.file.Files

/**
 * The desktop's own file dialog as the kit's [MediaPicker]. A desktop has no
 * camera source; "Photo library" opens the same dialog filtered to images and
 * video.
 */
object DesktopMediaPicker : MediaPicker {
  override val sources = listOf(PickSource.FILES, PickSource.PHOTOS)

  private val MEDIA = Regex("(?i).*\\.(png|jpe?g|gif|webp|avif|svg|heic|mp4|mov|webm)$")

  override suspend fun pick(source: PickSource, multiple: Boolean): List<PickedFile> {
    val chosen = withContext(Dispatchers.Main) {
      val dialog = FileDialog(null as Frame?, if (source == PickSource.PHOTOS) "Choose photos or videos" else "Choose files", FileDialog.LOAD)
      dialog.isMultipleMode = multiple
      if (source == PickSource.PHOTOS) dialog.setFilenameFilter { _, name -> MEDIA.matches(name) }
      dialog.isVisible = true
      dialog.files.toList()
    }
    return withContext(Dispatchers.IO) { chosen.map(::read) }
  }

  private fun read(file: File): PickedFile =
    PickedFile(file.name, Files.probeContentType(file.toPath()) ?: guess(file.name), file.readBytes())

  private fun guess(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
    "png" -> "image/png"
    "jpg", "jpeg" -> "image/jpeg"
    "gif" -> "image/gif"
    "webp" -> "image/webp"
    "svg" -> "image/svg+xml"
    "mp4" -> "video/mp4"
    "mov" -> "video/quicktime"
    "webm" -> "video/webm"
    "pdf" -> "application/pdf"
    else -> "application/octet-stream"
  }
}
