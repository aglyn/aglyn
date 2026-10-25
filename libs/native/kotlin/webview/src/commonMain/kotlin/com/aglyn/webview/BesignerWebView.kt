package com.aglyn.webview

import androidx.compose.runtime.Composable
import com.aglyn.core.AuthSession
import com.aglyn.pluginhost.BesignerEntry

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
  /** Another Besigner page, or the entry page that signs the view in: it loads in the view. */
  data object Stay : BesignerNavigation

  /** The editor's own way back (its back arrow): the view closes. */
  data object Leave : BesignerNavigation

  /** A console page that is not the Besigner: the app opens it natively. */
  data class Native(val path: String) : BesignerNavigation

  /** The sign-in wall: the session the view was opened with has ended. */
  data object SessionEnded : BesignerNavigation

  /** Another site altogether, from a link the person clicked: the person's browser. */
  data object External : BesignerNavigation

  /**
   * Another site, reached by a page script or a redirect nobody clicked (the console's once-a-day editor-hint bounce
   * to `console.aglyn.app`): dropped, never the browser (AGL-4002).
   */
  data object Ignore : BesignerNavigation
}

/**
 * Decides a navigation to [url] from a Besigner view on [origin] showing the editor at [current] (AGL-3850).
 * [userActivated] says whether a person clicked a link to it: only then does another site open in the browser.
 */
fun besignerNavigation(url: String, origin: String, current: String = "", userActivated: Boolean = false): BesignerNavigation {
  if (originOf(url) != originOf(origin)) return if (userActivated) BesignerNavigation.External else BesignerNavigation.Ignore
  val path = url.removePrefix(originOf(url) ?: "").ifEmpty { "/" }
  return when (val exit = BesignerEntry.exit(current, path)) {
    BesignerEntry.Exit.Stay -> BesignerNavigation.Stay
    BesignerEntry.Exit.Leave -> BesignerNavigation.Leave
    BesignerEntry.Exit.SessionEnded -> BesignerNavigation.SessionEnded
    is BesignerEntry.Exit.Open -> BesignerNavigation.Native(exit.path)
  }
}

/** The path a console [url] shows, for tracking which editor the view is on. */
internal fun consolePathOf(url: String): String = url.removePrefix(originOf(url) ?: "").ifEmpty { "/" }
