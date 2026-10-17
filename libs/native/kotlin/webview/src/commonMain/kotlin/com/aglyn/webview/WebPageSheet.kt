package com.aglyn.webview

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.aglyn.ui.AglynIconButton
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.WithTooltip

/**
 * Where a plain web address the app opens goes (AGL-3893): a site's live address, a preview, a help page or a tracking
 * link opens in the app's own web sheet; a provider's sign-in or connect step (Google, Stripe) keeps the system's secure
 * browser tab, where the person's saved passwords and the provider's own protections live; and anything that is not a web
 * page (mail, phone, maps) goes to the app the system picks.
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

/** The host a sheet names under its title: `shop.example.com` for `https://shop.example.com/menu`. */
fun webPageHost(url: String): String = url.substringAfter("://").substringBefore('/').substringBefore('?').substringBefore('#').removePrefix("www.")

/** What a web view reports back to its sheet's bar, and how the bar drives it. */
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
 * One plain web page in a full-screen sheet over the app: close, the page's title over its host, back, forward and
 * reload, and an overflow with Open in browser, Copy link and Share. Back first walks the page's own history.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WebPageSheet(url: String, onDismiss: () -> Unit, openInBrowser: (String) -> Unit) {
  val state = remember(url) { WebPageState(url) }
  val clipboard = LocalClipboardManager.current
  val share = rememberLinkSharer()
  var menu by remember { mutableStateOf(false) }
  Dialog(
    onDismissRequest = { if (state.canGoBack) state.back() else onDismiss() },
    properties = DialogProperties(usePlatformDefaultWidth = false),
  ) {
    Scaffold(
      modifier = Modifier.fillMaxSize().testTag("web-page-sheet"),
      topBar = {
        Column {
          TopAppBar(
            navigationIcon = { AglynIconButton(AglynIcons.named("close"), "Close", onDismiss, Modifier.testTag("web-page-close")) },
            title = {
              Column {
                Text(
                  state.title?.takeIf { it.isNotBlank() } ?: webPageHost(state.url),
                  style = MaterialTheme.typography.titleMedium,
                  maxLines = 1,
                  overflow = TextOverflow.Ellipsis,
                )
                Text(
                  webPageHost(state.url),
                  style = MaterialTheme.typography.bodySmall,
                  color = MaterialTheme.colorScheme.onSurfaceVariant,
                  maxLines = 1,
                  overflow = TextOverflow.Ellipsis,
                )
              }
            },
            actions = {
              AglynIconButton(AglynIcons.named("arrow_back"), "Back", { state.back() }, Modifier.testTag("web-page-back"), enabled = state.canGoBack)
              AglynIconButton(AglynIcons.named("arrow_forward"), "Forward", { state.forward() }, Modifier.testTag("web-page-forward"), enabled = state.canGoForward)
              AglynIconButton(AglynIcons.named("refresh"), "Reload", { state.reload() }, Modifier.testTag("web-page-reload"))
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
            colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
          )
          if (state.progress in 0.01f..0.99f) {
            LinearProgressIndicator(progress = { state.progress }, modifier = Modifier.fillMaxWidth())
          } else {
            HorizontalDivider()
          }
        }
      },
    ) { padding ->
      Box(Modifier.fillMaxSize().padding(padding)) {
        PlainWebView(state, onLeave = openInBrowser, modifier = Modifier.fillMaxSize())
      }
    }
  }
}

/**
 * Routes every plain web address the screens below open ([LocalUriHandler]) through [webDestination]: in the app's web
 * sheet, the secure browser tab ([secureTab]), or the system. Screens keep calling `LocalUriHandler.current.openUri(…)`.
 */
@Composable
fun ProvideInAppBrowser(secureTab: (String) -> Unit, content: @Composable () -> Unit) {
  val system = LocalUriHandler.current
  var open by remember { mutableStateOf<String?>(null) }
  val handler = remember(system, secureTab) {
    object : UriHandler {
      override fun openUri(uri: String) {
        when (webDestination(uri)) {
          WebDestination.IN_APP -> open = uri
          WebDestination.SECURE_TAB -> secureTab(uri)
          WebDestination.SYSTEM -> runCatching { system.openUri(uri) }
        }
      }
    }
  }
  CompositionLocalProvider(LocalUriHandler provides handler) {
    content()
    open?.let { url -> WebPageSheet(url, onDismiss = { open = null }, openInBrowser = { runCatching { system.openUri(it) } }) }
  }
}
