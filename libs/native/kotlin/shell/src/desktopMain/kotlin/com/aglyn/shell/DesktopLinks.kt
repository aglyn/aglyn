package com.aglyn.shell

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.pluginhost.DeepLinks
import java.awt.Desktop

/**
 * Links from outside the desktop app (AGL-4059): an `aglyn://` link the system hands it, or one passed on the command line
 * (a packaged app started for its scheme, or a development run). Each opens as a new tab of the window in front, as the
 * console's link opens a new browser tab, through the same resolver as every other way in.
 */
class DesktopLinks {
  /** The link waiting for the signed-in shell; cleared once it has opened. */
  var pending by mutableStateOf<String?>(null)
    private set

  /** Takes a link the app was handed; anything but an `aglyn://` console link is ignored. */
  fun receive(link: String?) {
    val value = link?.trim().orEmpty()
    if (!isLink(value)) return
    pending = value
  }

  fun opened() {
    pending = null
  }

  /**
   * Listens for `aglyn://` links the system opens the app with (macOS's open-URL event: the packaged app declares the
   * scheme), and takes any link in [args]. Where the platform has no such event (Windows, Linux), a link arrives on the
   * command line of the app started for it.
   */
  fun install(args: Array<String>) {
    args.forEach(::receive)
    runCatching {
      if (Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.APP_OPEN_URI)) {
        Desktop.getDesktop().setOpenURIHandler { event -> receive(event.uri.toString()) }
      }
    }
  }

  companion object {
    /**
     * Whether [value] is a link the app opens: an `aglyn://` console link. The desktop app claims no web domain, so a
     * console page reaches it only in that form (and a web-only one, such as sign-in, never).
     */
    fun isLink(value: String): Boolean =
      value.startsWith("aglyn://", ignoreCase = true) && DeepLinks.consolePathOf(value) != null && DeepLinks.opensInApp(value)
  }
}
