package com.aglyn.webview

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.backhandler.BackHandler
import androidx.compose.ui.viewinterop.AndroidView
import com.aglyn.core.AuthSession
import com.aglyn.core.defaultHttpClient
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.EmptyState
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

@SuppressLint("SetJavaScriptEnabled")
@OptIn(ExperimentalComposeUiApi::class)
@Composable
actual fun ConsoleView(origin: String, path: String, auth: AuthSession, brandName: String, onExit: () -> Unit) {
  var ready by remember(path) { mutableStateOf(false) }
  var error by remember(path) { mutableStateOf<String?>(null) }
  var webView by remember { mutableStateOf<WebView?>(null) }
  var canGoBack by remember { mutableStateOf(false) }

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
      is ConsoleSessionResult.Failed -> error = result.error
    }
    http.close()
  }

  BackHandler(enabled = canGoBack) { webView?.goBack() }

  when {
    error != null -> EmptyState("The console did not open", body = error, icon = AglynIcons.named("error"))
    !ready -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
    else -> AndroidView(
      modifier = Modifier.fillMaxSize(),
      factory = { context ->
        WebView(context).apply {
          settings.javaScriptEnabled = true
          settings.domStorageEnabled = true
          webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
              val url = request.url
              // Pages on the console stay here; anything else opens in the browser.
              if (originOf(url.toString()) == originOf(origin)) return false
              runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, url)) }
              return true
            }

            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
              canGoBack = view.canGoBack()
            }
          }
          loadUrl(origin.trimEnd('/') + path)
          webView = this
        }
      },
      onRelease = { it.destroy() },
    )
  }
}

private fun originOf(url: String): String? = runCatching {
  val uri = Uri.parse(url)
  val port = if (uri.port == -1) "" else ":${uri.port}"
  "${uri.scheme}://${uri.host}$port".lowercase()
}.getOrNull()
