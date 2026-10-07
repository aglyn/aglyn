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
  val registry: NativePluginRegistry,
  /** Shows an absolute console path: the authenticated WebView on Android, the browser on desktop. */
  val console: @Composable (path: String, onExit: () -> Unit) -> Unit,
  /** Test credentials a debug build fills the sign-in form with; null in release. */
  val debugSignIn: Pair<String, String>? = null,
)

/** Where the shell is: a top-level destination plus a stack of pushed routes. */
sealed interface Route {
  data class Screen(val screenId: String, val params: NativeParams = emptyMap()) : Route
  data class Console(val path: String) : Route
  data object Switcher : Route
}

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
    const val CONSOLE = "console"
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

  override fun navigate(screenId: String, params: NativeParams) {
    if (screenId in topLevelScreens && params.isEmpty()) {
      navigator.select(ShellNavigator.screenKey(screenId))
    } else {
      navigator.push(Route.Screen(screenId, params))
    }
  }

  override fun openConsolePath(path: String, scope: ConsoleScope) {
    navigator.push(Route.Console(scopedConsolePath(path, scope, orgSlug, hostSlug)))
  }

  /** A link from a notification or an App Link: a native screen when a plugin answers it. */
  fun openLink(link: String) {
    when (val target = DeepLinks.resolve(link, services.registry.deepLinks())) {
      is NativeLinkTarget.Screen -> navigator.push(Route.Screen(target.screen, target.params))
      is NativeLinkTarget.Console -> navigator.push(Route.Console(target.path))
      null -> Unit
    }
  }
}
