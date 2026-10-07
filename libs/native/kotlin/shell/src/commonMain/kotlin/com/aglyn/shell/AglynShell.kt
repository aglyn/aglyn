package com.aglyn.shell

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.backhandler.BackHandler
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import com.aglyn.core.AuthState
import com.aglyn.pluginhost.NativeApp
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynLogo
import androidx.compose.foundation.layout.height
import androidx.compose.ui.unit.dp
import com.aglyn.ui.AglynNavigationSuite
import com.aglyn.ui.AglynTheme
import com.aglyn.ui.NavDestination
import com.aglyn.ui.WidthClass
import com.aglyn.ui.currentWidthClass

/**
 * The "Aglyn" app: sign-in, then the workspace with Home, plugin screens,
 * Notifications, the console and Settings in an adaptive navigation suite.
 */
@Composable
fun AglynShell(
  services: ShellServices,
  navigator: ShellNavigator = remember { ShellNavigator() },
  /** A debug launch's request to sign in with the build's test credentials at once. */
  autoSignIn: Boolean = false,
  /** A link to open once signed in: a tapped notification's, or an App Link / aglyn:// URL. */
  pendingLink: String? = null,
  onLinkOpened: () -> Unit = {},
  /** Light or dark regardless of the system's; null follows the system. */
  dark: Boolean? = null,
) {
  AglynTheme(dark = dark ?: isSystemInDarkTheme()) {
    val auth by services.auth.state.collectAsState()
    when (val state = auth) {
      AuthState.Restoring -> Loading()
      AuthState.SignedOut -> SignInScreen(services, autoSignIn)
      is AuthState.SignedIn -> SignedInShell(services, navigator, state.user.uid, pendingLink, onLinkOpened)
    }
  }
}

@Composable
internal fun Loading() {
  Box(Modifier.fillMaxSize().semantics { contentDescription = "Loading" }, contentAlignment = Alignment.Center) {
    CircularProgressIndicator()
  }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalComposeUiApi::class)
@Composable
private fun SignedInShell(services: ShellServices, navigator: ShellNavigator, uid: String, pendingLink: String?, onLinkOpened: () -> Unit) {
  LaunchedEffect(uid) { services.push.register(uid) }
  val workspace by services.workspace.state.collectAsState()
  val version by services.registry.version.collectAsState()
  val widthClass = currentWidthClass()
  val wide = widthClass != WidthClass.COMPACT

  // Plugin screens with a quick action become top-level destinations on wide windows.
  val actions = remember(version) { services.registry.quickActions(NativeApp.AGLYN) }
  val topLevel = remember(version) {
    actions.mapNotNull { action -> action.screen?.let { services.registry.screen(it) }?.let { it to action.icon } }
      .distinctBy { it.first.id }
  }
  val context = ShellPluginContext(uid, workspace, services, navigator, if (wide) topLevel.map { it.first.id }.toSet() else emptySet())

  val destinations = buildList {
    add(NavDestination(ShellNavigator.HOME, "Home", AglynIcons.named("home")))
    if (wide) {
      for ((screen, icon) in topLevel) add(NavDestination(ShellNavigator.screenKey(screen.id), screen.title, AglynIcons.named(icon)))
    } else {
      add(NavDestination(ShellNavigator.MORE, "Apps", AglynIcons.named("apps")))
    }
    add(NavDestination(ShellNavigator.NOTIFICATIONS, "Notifications", AglynIcons.named("notifications")))
    add(NavDestination(ShellNavigator.CONSOLE, "Console", AglynIcons.named("language")))
    add(NavDestination(ShellNavigator.SETTINGS, "Settings", AglynIcons.named("settings")))
  }
  // A top-level key that is not a destination at this width moves to its equivalent.
  val keys = destinations.map { it.key }
  LaunchedEffect(keys, navigator.top) {
    if (navigator.top in keys) return@LaunchedEffect
    val screenId = navigator.top.removePrefix("screen:")
    if (navigator.top.startsWith("screen:")) {
      navigator.select(ShellNavigator.MORE)
      navigator.push(Route.Screen(screenId))
    } else if (navigator.top == ShellNavigator.MORE) {
      navigator.select(ShellNavigator.HOME)
    }
  }

  LaunchedEffect(pendingLink, workspace.ready) {
    if (pendingLink != null && workspace.ready) {
      context.openLink(pendingLink)
      onLinkOpened()
    }
  }

  BackHandler(enabled = navigator.stack.isNotEmpty()) { navigator.back() }

  AglynNavigationSuite(destinations, navigator.top, onSelect = navigator::select) {
    val route = navigator.current
    val title = when (route) {
      is Route.Screen -> services.registry.screen(route.screenId)?.title ?: "Not found"
      is Route.Console -> "Console"
      Route.Switcher -> "Switch site"
      Route.NotificationSettings -> "Notifications"
      null -> destinations.firstOrNull { it.key == navigator.top }?.label ?: ""
    }
    Scaffold(
      containerColor = MaterialTheme.colorScheme.background,
      topBar = {
        TopAppBar(
          title = {
            if (route == null && navigator.top == ShellNavigator.HOME) {
              AglynLogo(Modifier.height(28.dp), contentDescription = services.config.brandName)
            } else {
              Text(title)
            }
          },
          navigationIcon = {
            if (route != null) {
              IconButton(onClick = { navigator.back() }) {
                Icon(AglynIcons.named("arrow_back"), contentDescription = "Back")
              }
            }
          },
          actions = {
            if (route == null && navigator.top != ShellNavigator.HOME) {
              WorkspaceChip(workspace) { navigator.push(Route.Switcher) }
            }
          },
          colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
        )
      },
    ) { padding ->
      Box(Modifier.padding(padding).fillMaxSize()) {
        when (route) {
          is Route.Screen -> PluginScreenHost(services, context, route.screenId, route.params, workspace.site != null) { navigator.back() }
          is Route.Console -> services.console(route.path) { navigator.back() }
          Route.Switcher -> SwitcherScreen(services.workspace, workspace) { navigator.back() }
          Route.NotificationSettings -> NotificationSettingsScreen(services, uid)
          null -> when {
            navigator.top == ShellNavigator.HOME -> HomeScreen(services, context, workspace, widthClass, navigator)
            navigator.top == ShellNavigator.MORE -> MoreScreen(services, context)
            navigator.top == ShellNavigator.NOTIFICATIONS -> NotificationsScreen(services, uid, context)
            navigator.top == ShellNavigator.CONSOLE -> services.console(
              com.aglyn.pluginhost.scopedConsolePath("/", com.aglyn.pluginhost.ConsoleScope.SITE, context.orgSlug, context.hostSlug),
            ) { navigator.select(ShellNavigator.HOME) }
            navigator.top == ShellNavigator.SETTINGS -> SettingsScreen(services) { navigator.push(Route.NotificationSettings) }
            navigator.top.startsWith("screen:") ->
              PluginScreenHost(services, context, navigator.top.removePrefix("screen:"), emptyMap(), workspace.site != null) {
                navigator.select(ShellNavigator.HOME)
              }
            else -> HomeScreen(services, context, workspace, widthClass, navigator)
          }
        }
      }
    }
  }
}
