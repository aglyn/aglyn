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
import androidx.compose.runtime.movableContentOf
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
import androidx.compose.ui.graphics.graphicsLayer
import com.aglyn.core.AuthState
import com.aglyn.pluginhost.NativeApp
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynLogo
import androidx.compose.foundation.layout.height
import androidx.compose.ui.unit.dp
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
  /** The desktop's first window, and Android's first launch (on from its splash), play the launch intro. */
  playIntro: Boolean = false,
  /** The intro has handed over to the destination (the desktop's window grows then). */
  onIntroRevealed: () -> Unit = {},
  /** Android: the splash screen's mark size the intro starts from, and whether the splash has gone (the intro then moves). */
  launchMark: androidx.compose.ui.unit.Dp? = null,
  launchScreenGone: () -> Boolean = { true },
) {
  AccountTheme(services, dark) {
    androidx.compose.runtime.CompositionLocalProvider(
      com.aglyn.ui.LocalImageLoader provides services.imageLoader,
      com.aglyn.ui.LocalMediaPicker provides (com.aglyn.ui.LocalMediaPicker.current ?: services.mediaPicker),
      com.aglyn.ui.LocalFileExporter provides (com.aglyn.ui.LocalFileExporter.current ?: services.fileExporter),
      com.aglyn.ui.LocalImageTransformer provides (com.aglyn.ui.LocalImageTransformer.current ?: platformImageTransformer()),
      com.aglyn.ui.LocalVideoProbe provides (com.aglyn.ui.LocalVideoProbe.current ?: platformVideoProbe()),
    ) {
    // A site's live address, a preview, a docs or legal page opens in the app's browser screen (over the sign-in until there
    // is a shell; the signed-in shell pushes it onto its own stack); a provider's sign-in keeps the secure tab.
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
    val state = auth
    val authScreen = state is AuthState.SignedOut ||
      (state is AuthState.SignedIn && (services.authFlow.landing || (!state.user.emailVerified && impersonation == null)))
    ReportAuthScreen(state, services.authFlow.landing, impersonation != null)
    // One signed-out screen, moved rather than rebuilt when the account appears mid sign-up: rebuilding it cancelled the
    // sign-up's own coroutine, so its acceptance, names and held workspace could go unwritten.
    val signedOutScreen = remember(services, autoSignIn) { movableContentOf { SignedOutScreen(services, autoSignIn) } }
    LaunchHost(
      services, ready = state !is AuthState.Restoring, backdrop = authScreen, playIntro = playIntro, onRevealed = onIntroRevealed,
      launchMark = launchMark, mayStart = launchScreenGone,
    ) { reveal ->
      when (state) {
        AuthState.Restoring -> Unit
        AuthState.SignedOut -> AddAccountFrame(services) { signedOutScreen() }
        // A sign-up that is still landing keeps its screen up: the account exists, its records are being written.
        is AuthState.SignedIn if services.authFlow.landing -> AddAccountFrame(services) { signedOutScreen() }
        // Every console route refuses an unconfirmed address, so it is confirmed first (`/verify-email`).
        is AuthState.SignedIn if !state.user.emailVerified && impersonation == null -> VerifyEmailScreen(services, state.user.email)
        // Keyed by the account: switching accounts starts the shell over, so nothing of one account's shows in the other's.
        is AuthState.SignedIn -> androidx.compose.runtime.key(state.user.uid) {
          Box(Modifier.graphicsLayer { alpha = reveal.alpha; translationY = reveal.rise.dp.toPx() }) {
            AccountSwitchReset(navigator, state.user.uid)
            SignedInShell(services, navigator, state.user.uid, pendingLink, onLinkOpened)
          }
        }
      }
    }
    }
    }
  }
}

/**
 * The account's theme over the whole app (its appearance, theme, accent, density and, on the desktop, text size), the
 * device's own when "Apply to this device only" is on; [dark] forces light or dark (tests, snapshots).
 */
@Composable
internal fun AccountTheme(services: ShellServices, dark: Boolean? = null, brand: androidx.compose.ui.graphics.Color? = null, content: @Composable () -> Unit) {
  val prefs by services.accountPrefs.state.collectAsState()
  val theme = prefs.theme
  // The home-screen icon follows the account's choice, set on another device too.
  LaunchedEffect(theme.appIcon, prefs.loaded) { if (prefs.loaded) services.appIcons?.apply(theme.appIcon) }
  AglynTheme(
    dark = dark ?: appearanceDark(services),
    appTheme = theme,
    brand = brand,
    textScale = if (appSetsTextSize) com.aglyn.ui.textScaleOf(theme.textSize) else 1f,
  ) {
    // The desktop is Compact everywhere (sign-in, dialogs and the shell): its sizes and its radii.
    if (LocalUsesCompactChrome.current) {
      MaterialTheme(colorScheme = MaterialTheme.colorScheme, typography = MaterialTheme.typography, shapes = com.aglyn.ui.CompactShapes) {
        androidx.compose.runtime.CompositionLocalProvider(com.aglyn.ui.LocalShellMetrics provides com.aglyn.ui.CompactShellMetrics, content = content)
      }
    } else {
      content()
    }
  }
}

/** Dark or light as the account's appearance says (Light, Dark, Match system), the system's until it is read. */
@Composable
internal fun appearanceDark(services: ShellServices): Boolean {
  val appearance = services.accountPrefs.state.collectAsState().value.theme.appearance
  val system = isSystemInDarkTheme()
  return when (appearance) {
    com.aglyn.contracts.AppAppearance.DARK -> true
    com.aglyn.contracts.AppAppearance.LIGHT -> false
    else -> system
  }
}

@Composable
internal fun Loading() {
  Box(Modifier.fillMaxSize().semantics { contentDescription = "Loading" }, contentAlignment = Alignment.Center) {
    CircularProgressIndicator()
  }
}
