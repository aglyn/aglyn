package com.aglyn.shell

import com.aglyn.ui.FileExporter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.awt.FileDialog
import java.awt.Frame
import java.io.File

/** An export saved where the person picks, through the desktop's own Save dialog. */
object DesktopFileExporter : FileExporter {
  override suspend fun export(name: String, mimeType: String, bytes: ByteArray): Boolean {
    val target = withContext(Dispatchers.Main) {
      val dialog = FileDialog(null as Frame?, "Save $name", FileDialog.SAVE)
      dialog.file = name
      dialog.isVisible = true
      dialog.file?.let { File(dialog.directory, it) }
    } ?: return false
    withContext(Dispatchers.IO) { target.writeBytes(bytes) }
    return true
  }
}
