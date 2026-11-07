package com.aglyn.webview

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/*
 * ANOTHER PLUGIN'S SCREEN ON A CUSTOMER DISPLAY (AGL-4042), as the console's display page opens it: a plugin's public
 * console page, full screen. [storage] goes into the page origin's `localStorage` before the page loads (core's seam keeps
 * the display's credential there for the page to read), and when the page navigates to [returnPath] the native display
 * takes over again ([onReturn]). No session, no bridge, no file access. The Apple kit's PosDisplayPluginScreen.swift.
 */

/** A display credential or key in the seam's shape: nothing else is handed to a page. */
private val STORAGE_VALUE = Regex("^[A-Za-z0-9_.~-]{1,512}$")

/** The script that puts [storage] into the page origin's `localStorage`; entries out of shape are left out. */
fun customerDisplayStorageScript(storage: Map<String, String>): String =
  storage.filter { (key, value) -> STORAGE_VALUE.matches(key) && STORAGE_VALUE.matches(value) }
    .entries.joinToString("") { (key, value) -> "try { window.localStorage.setItem('$key', '$value') } catch (e) {}\n" }

@Composable
expect fun CustomerDisplayWebView(
  origin: String,
  href: String,
  storage: Map<String, String>,
  returnPath: String,
  onReturn: () -> Unit,
  modifier: Modifier = Modifier,
)
