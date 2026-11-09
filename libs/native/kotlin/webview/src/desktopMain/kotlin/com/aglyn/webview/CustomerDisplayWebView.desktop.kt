package com.aglyn.webview

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier

/** The desktop is never a customer display; a screen sent to one says where it runs. */
@Composable
actual fun CustomerDisplayWebView(
  origin: String,
  href: String,
  storage: Map<String, String>,
  returnPath: String,
  onReturn: () -> Unit,
  modifier: Modifier,
) {
  Box(modifier, contentAlignment = Alignment.Center) { Text("This screen opens on a tablet set up as the customer display.") }
}
