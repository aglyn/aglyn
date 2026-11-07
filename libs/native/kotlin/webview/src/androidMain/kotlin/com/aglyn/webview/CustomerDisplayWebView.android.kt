package com.aglyn.webview

import android.annotation.SuppressLint
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView

/**
 * Primes the page origin's storage first: a blank document at the console's origin (`loadDataWithBaseURL`) shares that
 * origin's `localStorage`, so the values are there before the plugin's page runs a line.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
actual fun CustomerDisplayWebView(
  origin: String,
  href: String,
  storage: Map<String, String>,
  returnPath: String,
  onReturn: () -> Unit,
  modifier: Modifier,
) {
  val back = rememberUpdatedState(onReturn)
  val base = origin.trimEnd('/') + "/"
  AndroidView(
    modifier = modifier,
    factory = { context ->
      WebView(context).apply {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        var primed = false
        webViewClient = object : WebViewClient() {
          override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (!request.isForMainFrame) return false
            // The page is done: back to the native display, never to the console's own display page.
            if (request.url.path == returnPath) {
              back.value()
              return true
            }
            return false
          }

          override fun onPageFinished(view: WebView, url: String?) {
            if (primed) return
            primed = true
            view.evaluateJavascript(customerDisplayStorageScript(storage)) { view.loadUrl(origin.trimEnd('/') + href) }
          }
        }
        loadDataWithBaseURL(base, "<!doctype html><html><body></body></html>", "text/html", "utf-8", null)
      }
    },
  )
}

