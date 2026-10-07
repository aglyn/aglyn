package com.aglyn.webview

import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import com.aglyn.core.AuthSession
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.EmptyState

/**
 * The desktop Besigner: embedded in the app window (WebView2 on Windows),
 * never the system browser. Until the embedded view lands, a native state
 * says so; nothing opens a browser.
 */
@Composable
actual fun BesignerWebView(
  origin: String,
  path: String,
  auth: AuthSession,
  brandName: String,
  onExit: () -> Unit,
  onConsoleLink: (path: String) -> Unit,
  bridge: ConsoleBridge?,
) {
  EmptyState(
    "The Besigner opens in the $brandName desktop app soon",
    body = "Until then, design pages in the $brandName app on a phone or tablet.",
    icon = AglynIcons.named("web"),
    action = { OutlinedButton(onClick = onExit) { Text("Back") } },
  )
}
