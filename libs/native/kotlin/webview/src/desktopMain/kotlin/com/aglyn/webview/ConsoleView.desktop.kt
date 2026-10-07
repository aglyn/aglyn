package com.aglyn.webview

import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import com.aglyn.core.AuthSession
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.EmptyState
import java.awt.Desktop
import java.net.URI

/** The JVM has no first-party web view, so the console opens in the system browser. */
@Composable
actual fun ConsoleView(origin: String, path: String, auth: AuthSession, brandName: String, onExit: () -> Unit) {
  val url = origin.trimEnd('/') + path
  fun open() = runCatching {
    if (Desktop.isDesktopSupported()) Desktop.getDesktop().browse(URI(url))
  }
  LaunchedEffect(url) { open() }
  EmptyState(
    "The console opened in your browser",
    body = url,
    icon = AglynIcons.named("open_in_new"),
    action = { Button(onClick = { open() }) { Text("Open again") } },
  )
}
