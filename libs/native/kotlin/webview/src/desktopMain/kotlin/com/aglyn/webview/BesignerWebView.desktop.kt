package com.aglyn.webview

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.awt.SwingPanel
import com.aglyn.core.AuthSession
import com.aglyn.core.defaultHttpClient
import com.aglyn.pluginhost.BesignerPaths
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.EmptyState
import com.aglyn.webview.webview2.NavigationVerdict
import com.aglyn.webview.webview2.WEBVIEW2_RUNTIME_DOWNLOAD
import com.aglyn.webview.webview2.WebView2Listener
import com.aglyn.webview.webview2.WebView2View
import com.aglyn.webview.webview2.webView2RuntimeVersion
import com.aglyn.webview.webview2.webView2Supported
import com.sun.jna.Native
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.awt.Canvas
import java.awt.Desktop
import java.awt.event.ComponentAdapter
import java.awt.event.ComponentEvent
import java.net.URI

/** The JavaScript object the page posts bridge calls to; on WebView2 it forwards to chrome.webview. */
private const val BRIDGE_TRANSPORT = "AglynNativeBridge"
private const val WEBVIEW2_TRANSPORT_SHIM =
  "window.$BRIDGE_TRANSPORT={postMessage:function(d){window.chrome.webview.postMessage(String(d))}};"

/**
 * The desktop Besigner, embedded in the app window: Microsoft Edge WebView2
 * on Windows, never the system browser. A Windows without the WebView2
 * runtime gets a native screen with Microsoft's installer; macOS and Linux
 * (development runs of the JVM app; the Mac ships the SwiftUI app) get a
 * native state.
 */
@Composable
actual fun BesignerWebView(
  origin: String,
  path: String,
  auth: AuthSession,
  brandName: String,
  onExit: () -> Unit,
  onConsoleLink: (path: String) -> Unit,
  bridge: ConsoleBridge?,
) {
  if (!BesignerPaths.isBesignerPath(path)) {
    LaunchedEffect(path) { onConsoleLink(path) }
    return
  }
  when {
    !webView2Supported -> EmptyState(
      "The Besigner opens in the $brandName desktop app on Windows",
      body = "On this computer, design pages in the $brandName app on a phone or tablet.",
      icon = AglynIcons.named("web"),
      action = { OutlinedButton(onClick = onExit) { Text("Back") } },
    )
    webView2RuntimeVersion() == null -> EmptyState(
      "Install Microsoft Edge WebView2",
      body = "The Besigner runs on Microsoft's WebView2, which this copy of Windows is missing. Install it, then open the Besigner again.",
      icon = AglynIcons.named("web"),
      action = {
        Button(onClick = { runCatching { Desktop.getDesktop().browse(URI(WEBVIEW2_RUNTIME_DOWNLOAD)) } }) { Text("Get WebView2 from Microsoft") }
      },
    )
    else -> WebView2Besigner(origin, path, auth, brandName, onConsoleLink, bridge)
  }
}

@Composable
private fun WebView2Besigner(
  origin: String,
  path: String,
  auth: AuthSession,
  brandName: String,
  onConsoleLink: (path: String) -> Unit,
  bridge: ConsoleBridge?,
) {
  val scope = rememberCoroutineScope()
  val leave by rememberUpdatedState(onConsoleLink)
  var error by remember(path) { mutableStateOf<String?>(null) }
  var ready by remember(path) { mutableStateOf(false) }
  val nonce = remember { createBridgeNonce() }
  val bridgeScript = remember(bridge, nonce) {
    bridge?.let { WEBVIEW2_TRANSPORT_SHIM + bridgeInjectionScript(it.globalName, nonce, it.handlers.keys.toList(), listOf(origin), BRIDGE_TRANSPORT, it.info) }
  }
  var view by remember { mutableStateOf<WebView2View?>(null) }

  val listener = remember(origin, bridge) {
    WebView2Listener(
      onNavigation = { uri ->
        when (val next = besignerNavigation(uri, origin)) {
          BesignerNavigation.Stay -> NavigationVerdict.ALLOW
          is BesignerNavigation.Native -> {
            scope.launch { leave(next.path) }
            NavigationVerdict.CANCEL
          }
          BesignerNavigation.External -> {
            runCatching { Desktop.getDesktop().browse(URI(uri)) }
            NavigationVerdict.CANCEL
          }
        }
      },
      onMessage = { source, data ->
        val offered = bridge ?: return@WebView2Listener
        when (val parsed = parseBridgeMessage(data, source, listOf(origin), nonce, offered.handlers.keys.toList())) {
          is ParsedBridgeMessage.Rejected -> parsed.id?.let { id ->
            view?.executeScript(bridgeReplyScript(offered.globalName, BridgeReply.Error(id, "The app does not offer that.")))
          }
          is ParsedBridgeMessage.Accepted -> scope.launch {
            val request = parsed.request
            val reply = try {
              BridgeReply.Ok(request.id, offered.handlers.getValue(request.method)(request.params))
            } catch (failure: Exception) {
              BridgeReply.Error(request.id, failure.message ?: "The app could not do that.")
            }
            view?.executeScript(bridgeReplyScript(offered.globalName, reply))
          }
        }
      },
      onReady = { scope.launch { ready = true } },
      onFailed = { reason -> scope.launch { error = reason } },
    )
  }

  DisposableEffect(Unit) { onDispose { view?.close() } }

  if (error != null) {
    EmptyState("The Besigner did not open", body = error, icon = AglynIcons.named("error"))
    return
  }
  Box(Modifier.fillMaxSize()) {
    SwingPanel(
      modifier = Modifier.fillMaxSize(),
      factory = {
        object : Canvas() {
          override fun addNotify() {
            super.addNotify()
            val hwnd = Native.getComponentPointer(this)
            val made = WebView2View(hwnd, listener, bridgeScript)
            view = made
            val scale = graphicsConfiguration?.defaultTransform?.scaleX ?: 1.0
            made.resize((width * scale).toInt(), (height * scale).toInt())
            addComponentListener(object : ComponentAdapter() {
              override fun componentResized(e: ComponentEvent) {
                val s = graphicsConfiguration?.defaultTransform?.scaleX ?: 1.0
                made.resize((width * s).toInt(), (height * s).toInt())
              }

              override fun componentMoved(e: ComponentEvent) = made.parentMoved()
            })
            scope.launch {
              val cookies = signInCookies(origin, auth, brandName)
              if (cookies == null) error = "Sign in to continue." else cookies.fold({ made.start(origin.trimEnd('/') + path, it) }, { error = it.message })
            }
          }

          override fun removeNotify() {
            view?.close()
            super.removeNotify()
          }
        }
      },
    )
    if (!ready) CircularProgressIndicator(Modifier.align(Alignment.Center))
  }
}

/** The console session the Besigner signs in with: `/api/auth/session`'s cookies, parsed for WebView2's cookie store. */
private suspend fun signInCookies(origin: String, auth: AuthSession, brandName: String): Result<List<SessionCookie>>? = withContext(Dispatchers.IO) {
  val token = auth.idToken(false) ?: return@withContext null
  val http = defaultHttpClient()
  try {
    when (val result = mintConsoleSession(http, origin, token, brandName)) {
      is ConsoleSessionResult.Ok -> {
        val host = URI(origin).host.orEmpty()
        val now = System.currentTimeMillis() / 1000.0
        Result.success(result.setCookies.mapNotNull { parseSetCookie(it, host, now) })
      }
      is ConsoleSessionResult.Failed -> Result.failure(IllegalStateException(result.error))
    }
  } finally {
    http.close()
  }
}
