package com.aglyn.webview

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView

@SuppressLint("SetJavaScriptEnabled")
@Composable
actual fun PlainWebView(state: WebPageState, onLeave: (url: String) -> Unit, modifier: Modifier) {
  val leave = rememberUpdatedState(onLeave)
  AndroidView(
    modifier = modifier,
    factory = { context ->
      WebView(context).apply {
        // A published site needs scripts and storage; it never gets the console's session, a bridge or file access.
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false

        fun report(view: WebView) {
          state.canGoBack = view.canGoBack()
          state.canGoForward = view.canGoForward()
          view.url?.let { state.url = it }
        }
        webViewClient = object : WebViewClient() {
          override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (!request.isForMainFrame) return false
            val url = request.url.toString()
            // Web pages, and a provider's own sign-in on the same page, stay here; mail, phone and app links leave.
            return if (webDestination(url) == WebDestination.SYSTEM) {
              leave.value(url)
              true
            } else {
              false
            }
          }

          override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) = report(view)

          override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) = report(view)
        }
        webChromeClient = object : WebChromeClient() {
          override fun onReceivedTitle(view: WebView, title: String?) {
            state.title = title
          }

          override fun onProgressChanged(view: WebView, newProgress: Int) {
            state.progress = newProgress / 100f
          }
        }
        // A file the page offers (a PDF menu, a download) is the browser's to fetch and show.
        setDownloadListener { url, _, _, _, _ -> leave.value(url) }
        state.controls = object : WebPageControls {
          override fun back() { if (canGoBack()) goBack() }
          override fun forward() { if (canGoForward()) goForward() }
          override fun reload() = this@apply.reload()
        }
        loadUrl(state.url)
      }
    },
    onRelease = { view ->
      state.controls = null
      view.stopLoading()
      view.destroy()
    },
  )
}

@Composable
actual fun rememberLinkSharer(): ((url: String) -> Unit)? {
  val context = LocalContext.current
  return remember(context) {
    { url: String ->
      val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, url)
      }
      runCatching { context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
      Unit
    }
  }
}
