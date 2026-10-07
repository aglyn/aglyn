package com.aglyn.webview

import androidx.compose.runtime.Composable
import com.aglyn.core.AuthSession

/**
 * The console at [path] (absolute, e.g. `/acme/hosts/shop/redirects`), signed
 * in as the current person. [onExit] leaves the view (native back at the
 * first page, or a link the app should handle itself).
 */
@Composable
expect fun ConsoleView(origin: String, path: String, auth: AuthSession, brandName: String, onExit: () -> Unit)
