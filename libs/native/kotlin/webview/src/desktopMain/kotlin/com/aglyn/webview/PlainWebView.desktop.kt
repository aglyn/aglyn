package com.aglyn.webview

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.awt.SwingPanel
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.EmptyState
import com.aglyn.ui.OutlinedButton
import com.aglyn.webview.webview2.NavigationVerdict
import com.aglyn.webview.webview2.WebView2Listener
import com.aglyn.webview.webview2.WebView2View
import com.aglyn.webview.webview2.webView2RuntimeVersion
import com.aglyn.webview.webview2.webView2Supported
import com.sun.jna.Native
import java.awt.Canvas
import java.awt.event.ComponentAdapter
import java.awt.event.ComponentEvent
import kotlinx.coroutines.launch

/**
 * The desktop's plain web view: Microsoft Edge WebView2 inside the window on Windows. A computer without it (a Windows
 * missing the runtime, or a development run on macOS or Linux) offers the page in the browser instead.
 */
@Composable
actual fun PlainWebView(state: WebPageState, onLeave: (url: String) -> Unit, modifier: Modifier) {
  val leave by rememberUpdatedState(onLeave)
  if (!webView2Supported || webView2RuntimeVersion() == null) {
    EmptyState(
      "This page opens in your browser",
      body = webPageHost(state.url),
      icon = AglynIcons.named("open_in_new"),
      action = { OutlinedButton(onClick = { leave(state.url) }) { Text("Open in browser") } },
      modifier = modifier,
    )
    return
  }
  val scope = rememberCoroutineScope()
  var view by remember { mutableStateOf<WebView2View?>(null) }
  val listener = remember(state) {
    WebView2Listener(
      onNavigation = { uri, _ ->
        if (webDestination(uri) == WebDestination.SYSTEM) {
          scope.launch { leave(uri) }
          NavigationVerdict.CANCEL
        } else {
          scope.launch { state.url = uri; state.canGoBack = true }
          NavigationVerdict.ALLOW
        }
      },
      onSourceChanged = { uri -> scope.launch { state.url = uri } },
      onReady = { scope.launch { state.progress = 1f } },
      onFailed = { _ -> scope.launch { leave(state.url) } },
    )
  }
  DisposableEffect(Unit) {
    onDispose {
      state.controls = null
      view?.close()
    }
  }
  SwingPanel(
    modifier = modifier,
    factory = {
      object : Canvas() {
        override fun addNotify() {
          super.addNotify()
          val made = WebView2View(Native.getComponentPointer(this), listener)
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
          state.controls = object : WebPageControls {
            override fun back() = made.goBack {}
            override fun forward() = made.executeScript("history.forward()")
            override fun reload() = made.executeScript("location.reload()")
          }
          state.canGoForward = true
          made.start(state.url, emptyList())
        }

        override fun removeNotify() {
          view?.close()
          super.removeNotify()
        }
      }
    },
  )
}

/** The desktop has no system share sheet: Copy link stands in for it. */
@Composable
actual fun rememberLinkSharer(): ((url: String) -> Unit)? = null
