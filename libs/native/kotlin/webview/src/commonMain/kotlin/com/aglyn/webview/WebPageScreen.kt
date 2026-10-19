package com.aglyn.webview

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.BottomAppBar
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.backhandler.BackHandler
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import com.aglyn.ui.AglynIconButton
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.WidthClass
import com.aglyn.ui.WithTooltip
import com.aglyn.ui.currentWidthClass

/**
 * Where a plain web address the app opens goes (AGL-3893): a site's live address, a preview, a help page or a tracking
 * link opens in the app's own browser screen; a provider's sign-in or connect step (Google, Stripe) keeps the system's
 * secure browser tab, where the person's saved passwords and the provider's own protections live; and anything that is not
 * a web page (mail, phone, maps) goes to the app the system picks.
 */
enum class WebDestination { IN_APP, SECURE_TAB, SYSTEM }

/** Hosts whose pages are a provider's sign-in, consent or account step: never inside the app's web view. */
private val SECURE_TAB_HOSTS = listOf("accounts.google.com", "google.com", "stripe.com", "appleid.apple.com", "login.microsoftonline.com")

/** Decides [WebDestination] for [url]. */
fun webDestination(url: String): WebDestination {
  val scheme = url.substringBefore(':', "").lowercase()
  if (scheme != "http" && scheme != "https") return WebDestination.SYSTEM
  val host = url.substringAfter("://").substringBefore('/').substringBefore('?').substringBefore('#').substringAfter('@').substringBefore(':').lowercase()
  if (host.isEmpty()) return WebDestination.SYSTEM
  if (SECURE_TAB_HOSTS.any { host == it || host.endsWith(".$it") }) return WebDestination.SECURE_TAB
  return WebDestination.IN_APP
}

/** The host a page is named by until it has a title: `shop.example.com` for `https://shop.example.com/menu`. */
fun webPageHost(url: String): String = url.substringAfter("://").substringBefore('/').substringBefore('?').substringBefore('#').removePrefix("www.")

/**
 * The address the browser's bar names under the title: the host and path, without the scheme, `www.`, the query or a
 * trailing slash (`juniper-street.aglyn.app/menu`).
 */
fun webPageAddress(url: String): String {
  val rest = url.substringAfter("://")
  val path = rest.substringBefore('?').substringBefore('#').substringAfter('/', "").trimEnd('/')
  return if (path.isEmpty()) webPageHost(url) else "${webPageHost(url)}/$path"
}

/** The browser's title: the page's own once it has one, its host until then. */
fun webPageTitle(title: String?, url: String): String = title?.trim()?.takeIf { it.isNotEmpty() } ?: webPageHost(url)

/** What a web view reports back to its screen's bar, and how the bar drives it. */
@Stable
class WebPageState(initialUrl: String) {
  var url by mutableStateOf(initialUrl)
  var title by mutableStateOf<String?>(null)
  var progress by mutableStateOf(0f)
  var canGoBack by mutableStateOf(false)
  var canGoForward by mutableStateOf(false)
  internal var controls: WebPageControls? = null

  fun back() = controls?.back()
  fun forward() = controls?.forward()
  fun reload() = controls?.reload()
}

/** The calls a platform's web view answers. */
interface WebPageControls {
  fun back()
  fun forward()
  fun reload()
}

/**
 * The platform's web view for one plain page: no session, no bridge. It reports its title, progress and history to
 * [state]; a link to anything that is not a web page leaves through [onLeave] (the system's mail or phone app), and a
 * file the page offers to download leaves the same way, to the browser.
 */
@Composable
expect fun PlainWebView(state: WebPageState, onLeave: (url: String) -> Unit, modifier: Modifier = Modifier)

/** Sharing a link: the system share sheet where there is one; null where the platform has none (the desktop). */
@Composable
expect fun rememberLinkSharer(): ((url: String) -> Unit)?

/**
 * The system's own link handler, under every [ProvideInAppBrowser]: "Open in browser" and mail, phone and app links go
 * to it, never back into the app's browser.
 */
val LocalSystemUriHandler = staticCompositionLocalOf<UriHandler?> { null }

/** Opens an address in the system's browser (the browser screen's "Open in browser"). */
@Composable
fun rememberSystemBrowser(): (String) -> Unit {
  val system = LocalSystemUriHandler.current ?: LocalUriHandler.current
  return remember(system) { { url: String -> runCatching { system.openUri(url) }; Unit } }
}

/**
 * One plain web page as a screen of its own (AGL-3935), pushed onto the stack it was opened from: on a phone it takes the
 * screen and the system back gesture walks the page's own history, then leaves; on a tablet or a desktop window it fills
 * the main area beside the navigation. Its bar holds Back to the screen below, the page's title over its address, and an
 * overflow with Open in browser, Copy link and Share; Previous page, Next page and Reload sit at the foot of a phone,
 * where a thumb reaches them, and in the bar on anything wider. [header] sits above the bar (a support session's banner).
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalComposeUiApi::class)
@Composable
fun WebPageScreen(
  url: String,
  onClose: () -> Unit,
  openInBrowser: (String) -> Unit,
  modifier: Modifier = Modifier,
  header: @Composable () -> Unit = {},
) {
  val state = remember(url) { WebPageState(url) }
  val clipboard = LocalClipboardManager.current
  val share = rememberLinkSharer()
  val compact = currentWidthClass() == WidthClass.COMPACT
  var menu by remember { mutableStateOf(false) }
  BackHandler { if (state.canGoBack) state.back() else onClose() }

  @Composable
  fun history() {
    AglynIconButton(AglynIcons.named("chevron_left"), "Previous page", { state.back() }, Modifier.testTag("web-page-back"), enabled = state.canGoBack)
    AglynIconButton(AglynIcons.named("chevron_right"), "Next page", { state.forward() }, Modifier.testTag("web-page-forward"), enabled = state.canGoForward)
  }

  @Composable
  fun reload() {
    AglynIconButton(AglynIcons.named("refresh"), "Reload", { state.reload() }, Modifier.testTag("web-page-reload"))
  }

  Scaffold(
    modifier = modifier.fillMaxSize().testTag("web-page-screen"),
    containerColor = MaterialTheme.colorScheme.background,
    topBar = {
      Column {
        header()
        TopAppBar(
          navigationIcon = { AglynIconButton(AglynIcons.named("arrow_back"), "Back", onClose, Modifier.testTag("web-page-close")) },
          title = {
            Column(Modifier.semantics(mergeDescendants = true) { heading() }.testTag("web-page-heading")) {
              Text(
                webPageTitle(state.title, state.url),
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
              )
              Text(
                webPageAddress(state.url),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
              )
            }
          },
          actions = {
            if (!compact) {
              history()
              reload()
            }
            Box {
              WithTooltip("More options") {
                IconButton(onClick = { menu = true }, modifier = Modifier.testTag("web-page-menu")) {
                  Icon(AglynIcons.named("more_vert"), contentDescription = "More options")
                }
              }
              DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(
                  text = { Text("Open in browser") },
                  leadingIcon = { Icon(AglynIcons.named("open_in_new"), null) },
                  onClick = { menu = false; openInBrowser(state.url) },
                  modifier = Modifier.testTag("web-page-open-browser"),
                )
                DropdownMenuItem(
                  text = { Text("Copy link") },
                  leadingIcon = { Icon(AglynIcons.named("link"), null) },
                  onClick = { menu = false; clipboard.setText(AnnotatedString(state.url)) },
                  modifier = Modifier.testTag("web-page-copy"),
                )
                if (share != null) {
                  DropdownMenuItem(
                    text = { Text("Share") },
                    leadingIcon = { Icon(AglynIcons.named("share"), null) },
                    onClick = { menu = false; share(state.url) },
                    modifier = Modifier.testTag("web-page-share"),
                  )
                }
              }
            }
          },
          colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
        )
        if (state.progress in 0.01f..0.99f) {
          LinearProgressIndicator(progress = { state.progress }, modifier = Modifier.fillMaxWidth())
        } else {
          HorizontalDivider()
        }
      }
    },
    bottomBar = {
      if (compact) {
        BottomAppBar(containerColor = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.testTag("web-page-toolbar")) {
          history()
          Spacer(Modifier.weight(1f))
          reload()
        }
      }
    },
  ) { padding ->
    Box(Modifier.fillMaxSize().padding(padding)) {
      PlainWebView(state, onLeave = openInBrowser, modifier = Modifier.fillMaxSize())
    }
  }
}

/**
 * Routes every plain web address the screens below open ([LocalUriHandler]) through [webDestination]: a web page to
 * [openPage] (the shell pushes it onto its stack as a [WebPageScreen]), a provider's sign-in to the secure browser tab
 * ([secureTab]), anything else to the system. Screens keep calling `LocalUriHandler.current.openUri(…)`. Without
 * [openPage] (before there is a shell: the sign-in) the page covers the content below until it is closed.
 */
@Composable
fun ProvideInAppBrowser(secureTab: (String) -> Unit, openPage: ((String) -> Unit)? = null, content: @Composable () -> Unit) {
  val system = LocalSystemUriHandler.current ?: LocalUriHandler.current
  var standalone by remember { mutableStateOf<String?>(null) }
  val open by rememberUpdatedState(openPage ?: { url: String -> standalone = url })
  val secure by rememberUpdatedState(secureTab)
  val handler = remember(system) {
    object : UriHandler {
      override fun openUri(uri: String) {
        when (webDestination(uri)) {
          WebDestination.IN_APP -> open(uri)
          WebDestination.SECURE_TAB -> secure(uri)
          WebDestination.SYSTEM -> runCatching { system.openUri(uri) }
        }
      }
    }
  }
  CompositionLocalProvider(LocalUriHandler provides handler, LocalSystemUriHandler provides system) {
    if (openPage != null) {
      content()
    } else {
      Box(Modifier.fillMaxSize()) {
        // The screen below keeps what was typed into it; it is out of reach until the page is closed.
        Box(Modifier.fillMaxSize().then(if (standalone != null) Modifier.clearAndSetSemantics {} else Modifier)) { content() }
        standalone?.let { url ->
          WebPageScreen(url, onClose = { standalone = null }, openInBrowser = { runCatching { system.openUri(it) } })
        }
      }
    }
  }
}
