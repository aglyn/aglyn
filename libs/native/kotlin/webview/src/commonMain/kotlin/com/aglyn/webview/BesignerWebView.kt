package com.aglyn.webview

import androidx.compose.runtime.Composable
import com.aglyn.core.AuthSession
import com.aglyn.pluginhost.BesignerPaths

/**
 * The Besigner at [path] (a whole console path, e.g.
 * `/acme/hosts/shop/screens/s1/versions/v2/besigner`), inside the app and
 * signed in as the current person. It is the apps' only web content: a path
 * that is not a Besigner page ([BesignerPaths]) is never loaded, and a link
 * inside the Besigner to any other console page leaves the view through
 * [onConsoleLink], so the shell opens its native screen. [onExit] leaves the
 * view (native back at the first page). A [bridge] lets the Besigner call the
 * app, on the console's origin only.
 */
@Composable
expect fun BesignerWebView(
  origin: String,
  path: String,
  auth: AuthSession,
  brandName: String,
  onExit: () -> Unit,
  onConsoleLink: (path: String) -> Unit,
  bridge: ConsoleBridge? = null,
)

/** Where a navigation inside the Besigner view goes. */
sealed interface BesignerNavigation {
  /** Another Besigner page: it loads in the view. */
  data object Stay : BesignerNavigation

  /** A console page that is not the Besigner: the app opens it natively. */
  data class Native(val path: String) : BesignerNavigation

  /** Another site altogether: the person's browser. */
  data object External : BesignerNavigation
}

/** Decides a navigation to [url] from a Besigner view on [origin]. */
fun besignerNavigation(url: String, origin: String): BesignerNavigation {
  if (originOf(url) != originOf(origin)) return BesignerNavigation.External
  val path = url.removePrefix(originOf(url) ?: "").ifEmpty { "/" }
  return if (BesignerPaths.isBesignerPath(path)) BesignerNavigation.Stay else BesignerNavigation.Native(path)
}
