package com.aglyn.shell

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import com.aglyn.ui.WithTooltip
import kotlinx.coroutines.launch
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.backhandler.BackHandler
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.heading
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
 * Notifications and Settings in an adaptive navigation suite. Every area is
 * native; only the Besigner opens in the in-app web view.
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
    androidx.compose.runtime.CompositionLocalProvider(
      com.aglyn.ui.LocalImageLoader provides services.imageLoader,
      com.aglyn.ui.LocalMediaPicker provides (com.aglyn.ui.LocalMediaPicker.current ?: services.mediaPicker),
      com.aglyn.ui.LocalFileExporter provides (com.aglyn.ui.LocalFileExporter.current ?: services.fileExporter),
      com.aglyn.ui.LocalImageTransformer provides (com.aglyn.ui.LocalImageTransformer.current ?: platformImageTransformer()),
      com.aglyn.ui.LocalVideoProbe provides (com.aglyn.ui.LocalVideoProbe.current ?: platformVideoProbe()),
    ) {
    // A site's live address, a preview or a help page opens in the app's web sheet; a provider's sign-in keeps the secure tab.
    com.aglyn.webview.ProvideInAppBrowser(secureTab = services.openHostedPage) {
    val auth by services.auth.state.collectAsState()
    val impersonation by services.auth.impersonation.collectAsState()
    // A sign-up, sign-in, reset or verification link opens its own screen; any other link waits for the signed-in shell.
    LaunchedEffect(pendingLink, auth is AuthState.SignedIn) {
      val link = pendingLink ?: return@LaunchedEffect
      val signedIn = auth is AuthState.SignedIn
      val handled = services.authFlow.open(link, signedIn) { plan ->
        services.workspace.state.value.org?.slug?.let { services.authFlow.landingLink = plan.destination(it) }
      }
      if (handled) onLinkOpened()
    }
    when (val state = auth) {
      AuthState.Restoring -> Loading()
      AuthState.SignedOut -> SignedOutScreen(services, autoSignIn)
      // A sign-up that is still landing keeps its screen up: the account exists, its records are being written.
      is AuthState.SignedIn if services.authFlow.landing -> SignedOutScreen(services, autoSignIn)
      // Every console route refuses an unconfirmed address, so it is confirmed first (`/verify-email`).
      is AuthState.SignedIn if !state.user.emailVerified && impersonation == null -> VerifyEmailScreen(services, state.user.email)
      is AuthState.SignedIn -> SignedInShell(services, navigator, state.user.uid, pendingLink, onLinkOpened)
    }
    }
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
  val impersonation by services.auth.impersonation.collectAsState()
  // A support session reads the customer's workspaces but never registers this device's notifications under their account.
  LaunchedEffect(uid) { if (services.auth.impersonation.value == null) services.push.register(uid) }
  // Entering or leaving a support session starts from home: nothing open belonged to the other person.
  val supporting = impersonation != null
  var wasSupporting by remember { mutableStateOf(supporting) }
  LaunchedEffect(supporting) {
    if (supporting != wasSupporting) {
      wasSupporting = supporting
      navigator.select(ShellNavigator.HOME)
    }
  }
  val exitScope = rememberCoroutineScope()
  val workspace by services.workspace.state.collectAsState()
  val version by services.registry.version.collectAsState()
  val widthClass = currentWidthClass()
  // Every plugin place gets its own row only in the permanent drawer (840 dp and up); a rail holds a handful of
  // destinations (Material: 3 to 7), so a medium window keeps the phone's Home, Apps, Notifications and Settings.
  val wide = widthClass == WidthClass.EXPANDED || widthClass == WidthClass.LARGE

  // The plugins' places (their tabs, then the quick actions that open a screen) become top-level destinations on wide windows.
  val topLevel = remember(version) {
    shellPlaces(services.registry, NativeApp.AGLYN).mapNotNull { place -> services.registry.screen(place.screen)?.let { it to place.icon } }
  }
  val context = ShellPluginContext(uid, workspace, services, navigator, if (wide) topLevel.map { it.first.id }.toSet() else emptySet())

  val destinations = buildList {
    add(NavDestination(ShellNavigator.HOME, "Home", AglynIcons.named("home")))
    if (wide) {
      // The Mac app's order: Home and Notifications, the site's areas under its name, then Settings.
      add(NavDestination(ShellNavigator.NOTIFICATIONS, "Notifications", AglynIcons.named("notifications")))
      topLevel.forEachIndexed { i, (screen, icon) ->
        add(NavDestination(ShellNavigator.screenKey(screen.id), screen.title, AglynIcons.named(icon), section = if (i == 0) (workspace.site?.name ?: "Site") else null))
      }
    } else {
      add(NavDestination(ShellNavigator.MORE, "Apps", AglynIcons.named("apps")))
    }
    if (!wide) add(NavDestination(ShellNavigator.NOTIFICATIONS, "Notifications", AglynIcons.named("notifications")))
    add(NavDestination(ShellNavigator.SETTINGS, "Settings", AglynIcons.named("settings"), section = if (wide) "" else null))
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
    if (pendingLink != null && workspace.ready && !AuthFlow.isAuthLink(pendingLink)) {
      context.openLink(pendingLink)
      onLinkOpened()
    }
  }
  // The first verified session of an account with no workspace creates the one its sign-up asked for; a new workspace with a
  // plan lands on billing with it.
  LaunchedEffect(uid, workspace.ready) { services.settleFirstRun(workspace) }
  val landingLink = services.authFlow.landingLink
  LaunchedEffect(landingLink, workspace.ready, workspace.org?.slug) {
    val link = landingLink ?: return@LaunchedEffect
    val slug = link.removePrefix("/").substringBefore('/')
    if (workspace.ready && workspace.orgs.any { it.slug == slug }) {
      workspace.orgs.firstOrNull { it.slug == slug }?.let { services.workspace.selectOrg(it.id) }
      services.authFlow.landingLink = null
      context.openLink(link)
    }
  }

  BackHandler(enabled = navigator.stack.isNotEmpty()) { navigator.back() }
  val entries = rememberSaveableStateHolder()
  // A popped screen's saved state goes with it: opening it again starts it fresh.
  val liveKeys = navigator.keys
  val pushedKeys = remember { mutableSetOf<String>() }
  LaunchedEffect(liveKeys) {
    pushedKeys.filter { it !in liveKeys }.forEach(entries::removeState)
    pushedKeys.retainAll(liveKeys.toSet())
    pushedKeys += liveKeys.filter { ShellNavigator.isPushedKey(it) }
  }

  // The token's claims gate the staff section; read from the token itself, as the console does.
  var claims by remember(uid) { mutableStateOf(com.aglyn.core.TokenClaims()) }
  LaunchedEffect(uid) { claims = com.aglyn.core.TokenClaims.fromIdToken(runCatching { services.auth.idToken(false) }.getOrNull()) }
  val authState by services.auth.state.collectAsState()
  val user = (authState as? AuthState.SignedIn)?.user
  // A passkey can be made where the app is configured for one and the platform bound a creator.
  val passkeyRelyingParty = services.config.passkeyRelyingParty.takeIf { com.aglyn.screens.LocalPasskeyCreator.current != null }
  // Google can be connected where the platform bound a way to sign in to it.
  val googleSource = com.aglyn.screens.LocalGoogleCredentialSource.current
  val screenSession = com.aglyn.screens.ScreenSession(
    passkeyRelyingParty = passkeyRelyingParty,
    googleConfigured = googleSource != null,
    email = user?.email,
    displayName = user?.displayName,
    orgName = workspace.org?.name,
    orgRole = workspace.org?.role,
    siteName = workspace.site?.name,
    claims = claims,
    origin = services.config.consoleOrigin,
    reauthenticate = { password -> services.auth.signInWithEmail(user?.email.orEmpty(), password) },
    impersonate = { token, tenantId -> services.auth.beginImpersonation(token, tenantId) },
    refreshClaims = { claims = com.aglyn.core.TokenClaims.fromIdToken(runCatching { services.auth.idToken(true) }.getOrNull()) },
    openHostedPage = services.openHostedPage,
    back = { navigator.back() },
    account = com.aglyn.screens.AccountOperations(
      changePassword = { current, new -> services.auth.changePassword(current, new) },
      updateDisplayName = { name -> services.auth.updateDisplayName(name) },
      linkGoogle = {
        val source = googleSource ?: throw com.aglyn.core.GoogleLinkError("Connecting Google is not set up in this build.")
        services.auth.linkGoogle(source.idToken(user?.email))
        claims = com.aglyn.core.TokenClaims.fromIdToken(runCatching { services.auth.idToken(true) }.getOrNull())
      },
      unlinkProvider = { provider ->
        services.auth.unlinkProvider(provider)
        claims = com.aglyn.core.TokenClaims.fromIdToken(runCatching { services.auth.idToken(true) }.getOrNull())
      },
    ),
  )

  androidx.compose.runtime.CompositionLocalProvider(com.aglyn.screens.LocalScreenSession provides screenSession) {
  val inDrawer = widthClass == WidthClass.EXPANDED || widthClass == WidthClass.LARGE
  AglynNavigationSuite(
    destinations, navigator.top, onSelect = navigator::select,
    drawerHeader = {
      AglynLogo(
        Modifier.padding(start = 26.dp, end = 24.dp, top = 24.dp, bottom = 12.dp).height(28.dp).semantics { heading() },
        contentDescription = services.config.brandName,
      )
    },
    drawerFooter = { WorkspaceFooter(workspace) { navigator.push(Route.Switcher) } },
  ) {
    val route = navigator.current
    val title = when (route) {
      is Route.Screen -> services.registry.screen(route.screenId)?.title ?: "Not found"
      is Route.Besigner -> "Besigner"
      Route.Analytics -> "Analytics"
      Route.Switcher -> "Switch workspace or site"
      Route.NotificationSettings -> "Notifications"
      null -> destinations.firstOrNull { it.key == navigator.top }?.label ?: ""
    }
    Scaffold(
      containerColor = MaterialTheme.colorScheme.background,
      topBar = {
        Column {
        impersonation?.let { ImpersonationBanner(it, onExit = { exitScope.launch { services.auth.endImpersonation() } }) }
        TopAppBar(
          title = {
            if (route == null && navigator.top == ShellNavigator.HOME) {
              if (!inDrawer) AglynLogo(Modifier.height(28.dp), contentDescription = services.config.brandName)
            } else {
              Text(title)
            }
          },
          navigationIcon = {
            if (route != null) {
              WithTooltip("Back") { IconButton(onClick = { navigator.back() }) {
                Icon(AglynIcons.named("arrow_back"), contentDescription = "Back")
              } }
            }
          },
          actions = {
            if (route == null && navigator.top != ShellNavigator.HOME && !inDrawer) {
              WorkspaceChip(workspace) { navigator.push(Route.Switcher) }
            }
          },
          colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
        )
        }
      },
    ) { padding ->
      Box(Modifier.padding(padding).fillMaxSize()) {
        // Each destination and each pushed screen keeps its own saved state (selection, scroll, filters), so Back returns to
        // the screen below as it was left, and a destination never inherits the one before it.
        entries.SaveableStateProvider(navigator.currentKey) {
        when (route) {
          is Route.Screen -> PluginScreenHost(services, context, route.screenId, route.params, workspace.site != null) { navigator.back() }
          is Route.Besigner -> services.besigner(route.path, { navigator.back() }) { link -> navigator.back(); context.openLink(link) }
          Route.Analytics -> AnalyticsScreen(services, context)
          Route.Switcher -> SwitcherScreen(services.workspace, workspace) { navigator.back() }
          Route.NotificationSettings -> NotificationSettingsScreen(services, uid)
          null -> when {
            navigator.top == ShellNavigator.HOME -> HomeScreen(services, context, workspace, widthClass, navigator)
            navigator.top == ShellNavigator.MORE -> MoreScreen(services, context, workspace.site?.name) { navigator.push(Route.Analytics) }
            navigator.top == ShellNavigator.NOTIFICATIONS -> NotificationsScreen(services, uid, context)
            navigator.top == ShellNavigator.SETTINGS -> SettingsScreen(services, context, screenSession.claims.isStaff) { navigator.push(Route.NotificationSettings) }
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
}
}
