package com.aglyn.shell

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.core.AglynConfig
import com.aglyn.core.AuthSession
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreReader
import com.aglyn.core.WorkspaceStore
import com.aglyn.core.WorkspaceState
import com.aglyn.pluginhost.BesignerPaths
import com.aglyn.pluginhost.ConsoleScope
import com.aglyn.pluginhost.DeepLinks
import com.aglyn.pluginhost.NativeApp
import com.aglyn.pluginhost.NativeLinkTarget
import com.aglyn.pluginhost.NativeParams
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.NativePluginRegistry
import com.aglyn.pluginhost.scopedConsolePath

/** Everything a shell needs, built once per process by the platform entry point. */
class ShellServices(
  val app: NativeApp,
  val config: AglynConfig,
  val auth: AuthSession,
  val firestore: FirestoreReader,
  val api: ConsoleApiClient,
  val workspace: WorkspaceStore,
  /** Small per-install settings (the POS store this device sells for). */
  val prefs: com.aglyn.core.KeyValueStore,
  val registry: NativePluginRegistry,
  /**
   * Shows a Besigner page (a whole console path) in the authenticated web
   * view inside the app, the apps' only web content. [onConsoleLink] hears a
   * link from it to any other console page, which the shell opens natively.
   */
  val besigner: @Composable (path: String, onExit: () -> Unit, onConsoleLink: (String) -> Unit) -> Unit,
  /** Test credentials a debug build fills the sign-in form with; null in release. */
  val debugSignIn: Pair<String, String>? = null,
  /** The register's printers, card reader and scanner; none in the Aglyn app. */
  val peripherals: com.aglyn.hardware.Peripherals = com.aglyn.hardware.NoPeripherals,
  /** This install's push registration; desktop has none in v1. */
  val push: com.aglyn.core.PushRegistrar = com.aglyn.core.NoPush,
  /** Writes as the signed-in person, under the same rules as the console's own writes. */
  val writer: com.aglyn.core.FirestoreWriter = com.aglyn.core.NoFirestoreWrites,
  /**
   * Opens a page someone else hosts (Stripe Checkout, the Customer Portal)
   * in the platform's secure in-app browser: Custom Tabs on Android, the
   * system browser on desktop. Never a web view of ours.
   */
  val openHostedPage: (url: String) -> Unit = {},
  /** Remote images for every screen ([com.aglyn.ui.LocalImageLoader]). */
  val imageLoader: com.aglyn.ui.ImageLoader? = HttpImageLoader(com.aglyn.core.defaultHttpClient()),
  /** The device's photo, camera and file pickers ([com.aglyn.ui.LocalMediaPicker]); the entry point binds them. */
  val mediaPicker: com.aglyn.ui.MediaPicker? = null,
  /** Where an export goes ([com.aglyn.ui.LocalFileExporter]); the entry point binds it. */
  val fileExporter: com.aglyn.ui.FileExporter? = null,
) {
  /** Removes this install's device row, then signs out, so no push follows the person out. */
  suspend fun signOut() {
    (auth.state.value as? com.aglyn.core.AuthState.SignedIn)?.let { push.unregister(it.user.uid) }
    auth.signOut()
  }
}

/** Where the shell is: a top-level destination plus a stack of pushed routes. */
sealed interface Route {
  data class Screen(val screenId: String, val params: NativeParams = emptyMap()) : Route
  /** The Besigner on a whole console path that [com.aglyn.pluginhost.BesignerPaths] accepts. */
  data class Besigner(val path: String) : Route
  data object Switcher : Route
  data object NotificationSettings : Route
}

/**
 * The platform's own content screens (sites, pages, media, setup…), which are
 * core rather than a plugin's: loaded before the generated plugin manifest,
 * through the same registrar and declaration check.
 */
val PLATFORM_ENTRIES: List<com.aglyn.pluginhost.NativePluginManifestEntry> = listOf(com.aglyn.site.SitePlatformEntry, com.aglyn.screens.CoreScreens.manifestEntry)

/** The site's Pages screen, which the site registration (libs/native/kotlin/site) contributes. */
const val SITE_PAGES_SCREEN_ID = "site.pages"

class ShellNavigator(initialTop: String = HOME) {
  var top by mutableStateOf(initialTop)
  val stack = mutableStateListOf<Route>()

  val current: Route? get() = stack.lastOrNull()

  fun select(key: String) {
    top = key
    stack.clear()
  }

  fun push(route: Route) {
    stack.add(route)
  }

  /** True when something was popped; false at a top-level destination. */
  fun back(): Boolean = if (stack.isEmpty()) false else { stack.removeAt(stack.lastIndex); true }

  companion object {
    const val HOME = "home"
    const val MORE = "more"
    const val NOTIFICATIONS = "notifications"
    const val SETTINGS = "settings"
    fun screenKey(screenId: String) = "screen:$screenId"
  }
}

internal class ShellPluginContext(
  override val uid: String,
  private val workspace: WorkspaceState,
  private val services: ShellServices,
  private val navigator: ShellNavigator,
  private val topLevelScreens: Set<String>,
) : NativePluginContext {
  override val orgId get() = workspace.org?.id
  override val hostId get() = workspace.site?.id
  override val orgSlug get() = workspace.org?.slug
  override val hostSlug get() = workspace.site?.subdomain?.ifEmpty { null }
  override val firestore get() = services.firestore
  override val api get() = services.api
  override val writer get() = services.writer
  override val peripherals get() = services.peripherals
  override val deviceStore get() = services.prefs
  override val siteRole get() = workspace.site?.role
  override val orgRole get() = workspace.org?.role

  override fun selectSite(hostId: String) = services.workspace.selectSite(hostId)

  override fun back() {
    navigator.back()
  }

  override fun navigate(screenId: String, params: NativeParams) {
    if (screenId in topLevelScreens && params.isEmpty()) {
      navigator.select(ShellNavigator.screenKey(screenId))
    } else {
      navigator.push(Route.Screen(screenId, params))
    }
  }

  override fun openBesigner(path: String, scope: ConsoleScope): Boolean {
    val whole = scopedConsolePath(path, scope, orgSlug, hostSlug)
    if (!BesignerPaths.isBesignerPath(whole)) return false
    navigator.push(Route.Besigner(whole))
    return true
  }

  /**
   * A link from a notification, an App Link or the Besigner: a plugin's native
   * screen, the Besigner, or (for a console page nothing answers natively yet)
   * Home. Never a console page.
   */
  fun openLink(link: String) {
    when (val target = DeepLinks.resolve(link, services.registry.deepLinks())) {
      is NativeLinkTarget.Screen -> navigator.push(Route.Screen(target.screen, target.params))
      is NativeLinkTarget.Besigner -> navigator.push(Route.Besigner(target.path))
      is NativeLinkTarget.Unmatched -> nativeFor(target.path)
      null -> Unit
    }
  }

  /** The shell's own native answer to a console page no plugin claims. */
  private fun nativeFor(path: String) {
    val rest = DeepLinks.splitConsoleScope(path.substringBefore('?')).rest
    when {
      rest == "/screens" || rest.startsWith("/screens/") -> navigator.push(Route.Screen(SITE_PAGES_SCREEN_ID))
      rest.startsWith("/notifications") -> navigator.select(ShellNavigator.NOTIFICATIONS)
      rest.startsWith("/settings") -> navigator.select(ShellNavigator.SETTINGS)
      else -> navigator.select(ShellNavigator.HOME)
    }
  }
}
