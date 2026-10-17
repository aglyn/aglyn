package com.aglyn.pluginhost

/**
 * How the apps' web view enters and leaves the Besigner (AGL-3850).
 *
 * The web view never loads a Besigner page directly. It opens the console's
 * `/auth/besigner?continue=<path>`, which signs the web view in from the
 * session cookie the app minted and only then moves on to the editor; a
 * Besigner page loaded straight from the cookie met a signed-out web view and
 * was sent to the web sign-in page first.
 *
 * Leaving goes the other way: whatever the Besigner navigates to that is not
 * the editor (its back arrow, its logo, a console link) returns the person to
 * the app's own screens instead of showing a console page in the web view.
 * The Swift kit's `BesignerEntry` is the same rules.
 */
object BesignerEntry {
  /** The console page that signs the web view in, then opens the Besigner. */
  const val PATH = "/auth/besigner"

  /** The sign-in wall's pages: the web view reaching one means the session it was opened with has ended. */
  private val AUTH_WALL = listOf("/signin", "/signup", "/sso", "/signout", "/verify-email", "/account-recovery", "/reset-password")

  /** The entry page for a Besigner [besignerPath], or null when it is not a Besigner page. */
  fun url(origin: String, besignerPath: String): String? {
    if (!BesignerPaths.isBesignerPath(besignerPath)) return null
    return "${origin.trimEnd('/')}$PATH?continue=${encodeComponent(besignerPath)}"
  }

  /** Where a main-frame navigation inside the web view leaves the person. */
  sealed interface Exit {
    /** Another Besigner page, or the entry page: it shows in the web view. */
    data object Stay : Exit

    /** Back to the app's screen the Besigner was opened from. */
    data object Leave : Exit

    /** Back to the app, then to the app's own screen for this console path. */
    data class Open(val path: String) : Exit

    /** The web view reached the sign-in wall: its session ended. */
    data object SessionEnded : Exit
  }

  /** Decides a navigation from the editor at [current] to [next]; both are whole console paths. */
  fun exit(current: String, next: String): Exit {
    val bare = bareOf(next)
    if (bare == PATH) return Exit.Stay
    if (AUTH_WALL.any { bare == it || bare.startsWith("$it/") }) return Exit.SessionEnded
    if (!BesignerPaths.isBesignerPath(next)) return Exit.Open(next)
    // The editor's own back arrow goes to the page's read-only view: in the app that is the screen it came from.
    val editor = bareOf(current)
    if (editor.endsWith("/besigner") && bare == editor.removeSuffix("/besigner") + "/view") return Exit.Leave
    return Exit.Stay
  }

  private fun bareOf(path: String): String = path.substringBefore('#').substringBefore('?')

  /**
   * The product token the web view adds to its user agent (AGL-3894).
   *
   * The console reads `AglynApp/<version> (<platform>)` to leave out what a
   * browser tab needs and an app screen does not: the web notification
   * prompt, the editor's back arrow, the unread count and brand in the page
   * title. It is there from the first request, whichever page the view opens
   * first. Presentation only: the console never grants anything on it. The
   * Swift kit's `BesignerEntry` appends the same marker.
   */
  const val USER_AGENT_PRODUCT = "AglynApp"

  /** `AglynApp/<version> (<platform>)`. */
  fun userAgentMarker(version: String?, platform: String): String {
    val shown = version.orEmpty().filterNot { it.isWhitespace() }.ifEmpty { "0" }
    return "$USER_AGENT_PRODUCT/$shown ($platform)"
  }

  /** The web view's whole user agent: the engine's own [base] kept, the marker after it. */
  fun userAgent(base: String?, version: String?, platform: String): String {
    val kept = base.orEmpty().trim()
    if ("$USER_AGENT_PRODUCT/" in kept) return kept
    val marker = userAgentMarker(version, platform)
    return if (kept.isEmpty()) marker else "$kept $marker"
  }

  /** `encodeURIComponent`: everything but the unreserved characters is percent-encoded as UTF-8. */
  private fun encodeComponent(value: String): String = buildString {
    for (byte in value.encodeToByteArray()) {
      val char = (byte.toInt() and 0xFF).toChar()
      if (char.isLetterOrDigit() && char.code < 0x80 || char in "-_.!~*'()") append(char)
      else append('%').append(HEX[(byte.toInt() shr 4) and 0xF]).append(HEX[byte.toInt() and 0xF])
    }
  }

  private const val HEX = "0123456789ABCDEF"
}
