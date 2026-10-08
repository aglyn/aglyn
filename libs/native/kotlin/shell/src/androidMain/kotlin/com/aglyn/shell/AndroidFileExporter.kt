package com.aglyn.shell

import android.content.Context
import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.FileProvider
import com.aglyn.ui.FileExporter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/** An export written to the app's cache and offered through the share sheet (save to Files, mail it, …). */
@Composable
fun rememberAndroidFileExporter(): FileExporter {
  val context = LocalContext.current
  return remember(context) { AndroidFileExporter(context) }
}

private class AndroidFileExporter(private val context: Context) : FileExporter {
  override suspend fun export(name: String, mimeType: String, bytes: ByteArray): Boolean {
    val file = withContext(Dispatchers.IO) {
      val dir = File(context.cacheDir, "aglyn_exports").apply { mkdirs() }
      File(dir, name.replace(Regex("[^A-Za-z0-9._ -]"), "_")).apply { writeBytes(bytes) }
    }
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
    val send = Intent(Intent.ACTION_SEND).apply {
      type = mimeType
      putExtra(Intent.EXTRA_STREAM, uri)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(Intent.createChooser(send, name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    return true
  }
}
