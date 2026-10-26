package com.aglyn.webview

import android.annotation.SuppressLint
import android.content.Intent
import android.util.Log
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.backhandler.BackHandler
import androidx.compose.ui.viewinterop.AndroidView
import com.aglyn.core.AuthSession
import com.aglyn.pluginhost.BesignerEntry
import com.aglyn.pluginhost.BesignerPaths
import com.aglyn.core.defaultHttpClient
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.EmptyState
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

@SuppressLint("SetJavaScriptEnabled")
@OptIn(ExperimentalComposeUiApi::class)
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
  // The Besigner is the only web content: any other console page is native.
  if (!BesignerPaths.isBesignerPath(path)) {
    LaunchedEffect(path) { onConsoleLink(path) }
    return
  }
  val scope = rememberCoroutineScope()
  // One nonce per view; each page load is injected with it.
  val nonce = remember { createBridgeNonce() }
  var ready by remember(path) { mutableStateOf(false) }
  var error by remember(path) { mutableStateOf<String?>(null) }
  var webView by remember { mutableStateOf<WebView?>(null) }
  var canGoBack by remember { mutableStateOf(false) }
  // The editor the view shows, and whether it has handed the person back to the app (AGL-3850).
  val current = remember(path) { arrayOf(path) }
  val left = remember(path) { booleanArrayOf(false) }

  /** Acts on a navigation the view does not show; true when it was not [BesignerNavigation.Stay]. */
  fun handle(next: BesignerNavigation, url: String, open: (android.net.Uri) -> Unit): Boolean {
    if (left[0]) return true
    when (next) {
      BesignerNavigation.Stay -> {
        val shown = consolePathOf(url)
        if (!shown.startsWith(BesignerEntry.PATH)) current[0] = shown
        return false
      }
      BesignerNavigation.Leave -> { left[0] = true; onExit() }
      is BesignerNavigation.Native -> { left[0] = true; onConsoleLink(next.path) }
      BesignerNavigation.SessionEnded -> error = "Your session ended. Open the Besigner again to keep editing."
      BesignerNavigation.External -> open(android.net.Uri.parse(url))
      // A script or redirect leaving the console: dropped (AGL-4002).
      BesignerNavigation.Ignore -> Unit
    }
    return true
  }

  LaunchedEffect(origin, path) {
    val token = auth.idToken(false)
    if (token == null) {
      error = "Sign in to continue."
      return@LaunchedEffect
    }
    val http = defaultHttpClient()
    when (val result = mintConsoleSession(http, origin, token, brandName)) {
      is ConsoleSessionResult.Ok -> {
        val cookies = CookieManager.getInstance()
        cookies.setAcceptCookie(true)
        for (cookie in result.setCookies) {
          suspendCancellableCoroutine { done -> cookies.setCookie(origin, cookie) { done.resume(Unit) } }
        }
        cookies.flush()
        ready = true
      }
      is ConsoleSessionResult.Failed -> {
        com.aglyn.core.Telemetry.record(IllegalStateException("The Besigner's console session was not made."), "webview.console_session")
        error = result.error
      }
    }
    http.close()
  }

  BackHandler(enabled = canGoBack) { webView?.goBack() }

  when {
    error != null -> EmptyState("The Besigner did not open", body = error, icon = AglynIcons.named("error"))
    !ready -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
    else -> AndroidView(
      modifier = Modifier.fillMaxSize(),
      factory = { context ->
        WebView(context).apply {
          // AndroidView gives a view WRAP_CONTENT, and a WebView laid out that way resolves CSS `vh`/`dvh` to 0, so the
          // Besigner's full-height shell (height: 100dvh, overflow: hidden) collapsed and the editor showed blank (AGL-3850).
          layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
          settings.javaScriptEnabled = true
          settings.domStorageEnabled = true
          // The console leaves its browser-only chrome out of the app (AGL-3894).
          val version = runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull()
          settings.userAgentString = BesignerEntry.userAgent(settings.userAgentString, version, "android")
          if (bridge != null) {
            addJavascriptInterface(
              object {
                @JavascriptInterface
                fun postMessage(data: String) {
                  // Called on a WebView thread: read the page's URL, and answer, on the main thread.
                  post {
                    val parsed = parseBridgeMessage(data, url, listOf(origin), nonce, bridge.handlers.keys.toList())
                    val reply: suspend () -> BridgeReply? = when (parsed) {
                      is ParsedBridgeMessage.Rejected -> {
                        Log.w("AglynBridge", "dropped a bridge message: ${parsed.reason.wire}")
                        com.aglyn.core.Telemetry.record(
                          IllegalStateException("The app refused a bridge call."), "webview.bridge_refused:${parsed.reason.wire}",
                        )
                        parsed.id?.let { id -> { BridgeReply.Error(id, "The app does not offer that.") } }
                      }
                      is ParsedBridgeMessage.Accepted -> {
                        {
                          val request = parsed.request
                          try {
                            BridgeReply.Ok(request.id, bridge.handlers.getValue(request.method)(request.params))
                          } catch (error: Exception) {
                            com.aglyn.core.Telemetry.record(error, "webview.bridge:${request.method}")
                            BridgeReply.Error(request.id, error.message ?: "The app could not do that.")
                          }
                        }
                      }
                    } ?: return@post
                    scope.launch {
                      val answer = reply() ?: return@launch
                      evaluateJavascript(bridgeReplyScript(bridge.globalName, answer), null)
                    }
                  }
                }
              },
              BRIDGE_TRANSPORT,
            )
          }
          webViewClient = object : WebViewClient() {
            // A Besigner page that did not load is told to Telemetry (AGL-4067); the page shows WebView's own error.
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: android.webkit.WebResourceError) {
              val offline = error.errorCode in setOf(ERROR_HOST_LOOKUP, ERROR_CONNECT, ERROR_TIMEOUT)
              if (request.isForMainFrame && !offline) {
                com.aglyn.core.Telemetry.record(
                  IllegalStateException("A Besigner page did not load (WebView error ${error.errorCode})."), "webview.navigation:${error.errorCode}",
                )
              }
            }

            override fun onPageFinished(view: WebView, url: String?) {
              // The script itself defines nothing on a page from another origin.
              if (bridge != null && isTrustedUrl(url, listOf(origin))) {
                view.evaluateJavascript(
                  bridgeInjectionScript(bridge.globalName, nonce, bridge.handlers.keys.toList(), listOf(origin), BRIDGE_TRANSPORT, bridge.info),
                  null,
                )
              }
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
              // Frames inside the page (the Besigner's canvas, Firebase's auth frame, reCAPTCHA) load where they are.
              if (!request.isForMainFrame) return false
              val url = request.url.toString()
              // Besigner pages stay here; any other console page is a native screen; another site opens in the browser
              // only from a link the person tapped (a script or redirect leaving the console is dropped, AGL-4002).
              return handle(besignerNavigation(url, origin, current[0], userActivated = request.hasGesture()), url) { uri ->
                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, uri)) }
              }
            }

            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
              canGoBack = view.canGoBack()
              // The console's client-side router never reaches shouldOverrideUrlLoading; its history entries land here.
              if (url != null && isTrustedUrl(url, listOf(origin))) handle(besignerNavigation(url, origin, current[0]), url) {}
            }
          }
          // The Besigner's canvas and Firebase's auth frame live on other origins and need their cookies.
          CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
          // The entry page signs this view in from the cookie, then opens the editor (AGL-3850).
          loadUrl(BesignerEntry.url(origin, path) ?: return@apply)
          webView = this
        }
      },
      onRelease = { it.destroy() },
    )
  }
}

/** The JavaScript object the page posts bridge calls to. */
private const val BRIDGE_TRANSPORT = "AglynNativeBridge"
