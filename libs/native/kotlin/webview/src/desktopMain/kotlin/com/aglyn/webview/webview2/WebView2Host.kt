package com.aglyn.webview.webview2

import com.aglyn.webview.SessionCookie
import com.sun.jna.Library
import com.sun.jna.Memory
import com.sun.jna.Native
import com.sun.jna.NativeLibrary
import com.sun.jna.Pointer
import com.sun.jna.ptr.PointerByReference
import java.io.File
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch

/*
 * Microsoft Edge WebView2 on Windows, for the Besigner (approved 2026-10-07).
 * The Evergreen runtime ships with Windows 11 and current Windows 10 and is
 * kept updated by Microsoft; the app carries only WebView2Loader.dll.
 *
 * WebView2 wants a single-threaded apartment with a message loop, so every
 * call runs on one thread of our own ("aglyn-webview2"), which pumps Win32
 * messages and drains a queue of work the Compose side posts to it.
 */

private const val IID_ENVIRONMENT_COMPLETED = "4e8a3389-c9d8-4bd2-b6b5-124fee6cc14d"
private const val IID_CONTROLLER_COMPLETED = "6c4819f3-c9b7-4260-8127-c9f5bde7f68c"
private const val IID_NAVIGATION_STARTING = "9adbe429-f36d-432b-9ddc-f8881fbd76e3"
private const val IID_NEW_WINDOW_REQUESTED = "d4c185fe-c81c-4989-97af-2d3fa7ab5651"
private const val IID_WEB_MESSAGE_RECEIVED = "57213f19-00e6-49fa-8e07-898ea01ecbd2"
private const val IID_ADD_SCRIPT_COMPLETED = "b99369f3-9b11-47b5-bc6f-8e7895fcea17"
private const val IID_EXECUTE_SCRIPT_COMPLETED = "49511172-cc67-4bca-9923-137112f4c4cc"
private val IID_ICOREWEBVIEW2_2 = guidBytes("9E8F0CF8-E670-4B5E-B2BC-73E061E3184C")

/** Vtable slots, from WebView2.h. */
private object Slot {
  // ICoreWebView2Environment
  const val CREATE_CONTROLLER = 3
  // ICoreWebView2Controller
  const val PUT_IS_VISIBLE = 4
  const val PUT_BOUNDS = 6
  const val NOTIFY_PARENT_MOVED = 23
  const val CLOSE = 24
  const val GET_CORE_WEBVIEW2 = 25
  // ICoreWebView2
  const val GET_SETTINGS = 3
  const val NAVIGATE = 5
  const val ADD_NAVIGATION_STARTING = 7
  const val ADD_SCRIPT_ON_DOCUMENT_CREATED = 27
  const val EXECUTE_SCRIPT = 29
  const val ADD_WEB_MESSAGE_RECEIVED = 34
  const val GET_CAN_GO_BACK = 38
  const val GO_BACK = 40
  const val ADD_NEW_WINDOW_REQUESTED = 44
  // ICoreWebView2_2
  const val GET_COOKIE_MANAGER = 66
  // ICoreWebView2Settings
  const val PUT_IS_STATUS_BAR_ENABLED = 10
  const val PUT_ARE_DEV_TOOLS_ENABLED = 12
  // ICoreWebView2NavigationStartingEventArgs
  const val NAV_GET_URI = 3
  const val NAV_PUT_CANCEL = 8
  // ICoreWebView2NewWindowRequestedEventArgs
  const val NEW_WINDOW_GET_URI = 3
  const val NEW_WINDOW_PUT_HANDLED = 6
  // ICoreWebView2WebMessageReceivedEventArgs
  const val MESSAGE_GET_SOURCE = 3
  const val MESSAGE_TRY_GET_STRING = 5
  // ICoreWebView2CookieManager
  const val CREATE_COOKIE = 3
  const val ADD_OR_UPDATE_COOKIE = 6
  // ICoreWebView2Cookie
  const val COOKIE_PUT_EXPIRES = 9
  const val COOKIE_PUT_HTTP_ONLY = 11
  const val COOKIE_PUT_SAME_SITE = 13
  const val COOKIE_PUT_SECURE = 15
}

private interface WebView2Loader : Library {
  fun CreateCoreWebView2EnvironmentWithOptions(browserFolder: Pointer?, userDataFolder: com.sun.jna.WString, options: Pointer?, handler: Pointer): Int
  fun GetAvailableCoreWebView2BrowserVersionString(browserFolder: Pointer?, versionInfo: PointerByReference): Int
}

private interface User32 : Library {
  fun GetMessageW(msg: Pointer, hwnd: Pointer?, min: Int, max: Int): Int
  fun TranslateMessage(msg: Pointer): Boolean
  fun DispatchMessageW(msg: Pointer): Pointer?
  fun PostThreadMessageW(threadId: Int, msg: Int, wParam: Pointer?, lParam: Pointer?): Boolean
}

private interface Kernel32 : Library {
  fun GetCurrentThreadId(): Int
}

private const val WM_APP_WORK = 0x8000 + 0x51

/** Where WebView2 keeps its profile: per user, beside nothing else of ours. */
fun webView2DataFolder(localAppData: String? = System.getenv("LOCALAPPDATA")): String =
  File(localAppData ?: System.getProperty("user.home"), "Aglyn${File.separator}WebView2").path

/** Finds and loads WebView2Loader.dll: beside the packaged app, else on jna.library.path. */
private val loader: WebView2Loader? by lazy {
  runCatching {
    val packaged = System.getProperty("compose.application.resources.dir")?.let { File(it, "WebView2Loader.dll") }?.takeIf { it.isFile }
    val library = if (packaged != null) NativeLibrary.getInstance(packaged.absolutePath) else NativeLibrary.getInstance("WebView2Loader")
    Native.load(library.file?.absolutePath ?: library.name, WebView2Loader::class.java)
  }.getOrNull()
}

/** Whether this is Windows with the loader packaged. */
val webView2Supported: Boolean get() = System.getProperty("os.name").orEmpty().startsWith("Windows") && loader != null

/** The installed Evergreen runtime's version, or null when Windows has none. */
fun webView2RuntimeVersion(): String? {
  val load = loader ?: return null
  val out = PointerByReference()
  if (load.GetAvailableCoreWebView2BrowserVersionString(null, out) < 0) return null
  return out.value?.let { text -> text.getWideString(0).also { Ole32.INSTANCE.CoTaskMemFree(text) } }
}

/** Microsoft's Evergreen bootstrapper, for a Windows without the runtime. */
const val WEBVIEW2_RUNTIME_DOWNLOAD = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"

/** What the page asked of the host, decided by the Compose side. */
enum class NavigationVerdict { ALLOW, CANCEL }

/** The callbacks a view hears; all run on the WebView2 thread. */
class WebView2Listener(
  /** A navigation to [uri] is about to start: allow it, or cancel it (the caller routes it elsewhere). */
  val onNavigation: (uri: String) -> NavigationVerdict,
  /** A web message from the page: its source URL and string payload. */
  val onMessage: (source: String, data: String) -> Unit = { _, _ -> },
  /** The view is ready, or failed with a reason. */
  val onReady: () -> Unit = {},
  val onFailed: (reason: String) -> Unit = {},
)

/** The one WebView2 thread: an STA with a message loop and a work queue. */
private object WebView2Thread {
  private val work = ConcurrentLinkedQueue<() -> Unit>()
  private val started = CountDownLatch(1)
  @Volatile private var threadId = 0

  private val thread = Thread({
    Ole32.INSTANCE.CoInitializeEx(null, Ole32.COINIT_APARTMENTTHREADED)
    val user32 = Native.load("user32", User32::class.java)
    threadId = Native.load("kernel32", Kernel32::class.java).GetCurrentThreadId()
    val msg = Memory(64)
    started.countDown()
    while (user32.GetMessageW(msg, null, 0, 0) > 0) {
      if (msg.getInt(Native.POINTER_SIZE.toLong()) == WM_APP_WORK) {
        while (true) work.poll()?.let { job -> runCatching(job) } ?: break
      } else {
        user32.TranslateMessage(msg)
        user32.DispatchMessageW(msg)
      }
    }
  }, "aglyn-webview2").apply { isDaemon = true }

  fun post(job: () -> Unit) {
    if (!thread.isAlive) synchronized(this) { if (!thread.isAlive) thread.start() }
    started.await()
    work += job
    Native.load("user32", User32::class.java).PostThreadMessageW(threadId, WM_APP_WORK, null, null)
  }
}

/**
 * One WebView2 view, a child of [parentHwnd] (a heavyweight AWT canvas).
 * [start] signs it in with [cookies] and opens [url]; the other calls move,
 * show and close it. Every call is posted to the WebView2 thread.
 */
class WebView2View(
  private val parentHwnd: Pointer,
  private val listener: WebView2Listener,
  private val bridgeScript: String? = null,
) {
  private var controller: ComRef? = null
  private var webview: ComRef? = null
  private var pendingBounds: Rect? = null
  @Volatile var closed = false
    private set

  fun start(url: String, cookies: List<SessionCookie>) = WebView2Thread.post {
    val load = loader ?: return@post listener.onFailed("WebView2Loader.dll is missing from this install.")
    val environmentDone = resultHandler(IID_ENVIRONMENT_COMPLETED) { hresult, environment ->
      if (hresult < 0 || environment == null) return@resultHandler listener.onFailed("WebView2 did not start (0x${hresult.toUInt().toString(16)}).")
      val controllerDone = resultHandler(IID_CONTROLLER_COMPLETED) { created, controllerPointer ->
        if (created < 0 || controllerPointer == null || closed) {
          return@resultHandler listener.onFailed("The Besigner view could not be created (0x${created.toUInt().toString(16)}).")
        }
        val made = ComRef(controllerPointer)
        made.call(1) // AddRef: the handler's pointer is borrowed.
        controller = made
        val view = made.get(Slot.GET_CORE_WEBVIEW2, "get_CoreWebView2")
        webview = view
        configure(view)
        signIn(view, cookies)
        pendingBounds?.let { made.call(Slot.PUT_BOUNDS, it) }
        made.call(Slot.PUT_IS_VISIBLE, 1)
        view.call(Slot.NAVIGATE, wide(url)).check("Navigate")
        listener.onReady()
      }
      ComRef(environment).call(Slot.CREATE_CONTROLLER, parentHwnd, controllerDone).check("CreateCoreWebView2Controller")
    }
    load.CreateCoreWebView2EnvironmentWithOptions(null, wide(webView2DataFolder()), null, environmentDone)
      .check("CreateCoreWebView2EnvironmentWithOptions")
  }

  private fun configure(view: ComRef) {
    view.get(Slot.GET_SETTINGS, "get_Settings").also { settings ->
      settings.call(Slot.PUT_IS_STATUS_BAR_ENABLED, 0)
      settings.call(Slot.PUT_ARE_DEV_TOOLS_ENABLED, 0)
      settings.release()
    }
    val navigating = eventHandler(IID_NAVIGATION_STARTING) { args ->
      val uri = args.string(Slot.NAV_GET_URI, "get_Uri").orEmpty()
      if (listener.onNavigation(uri) == NavigationVerdict.CANCEL) args.call(Slot.NAV_PUT_CANCEL, 1)
    }
    view.call(Slot.ADD_NAVIGATION_STARTING, navigating, eventToken()).check("add_NavigationStarting")
    // A new window (target=_blank, window.open) never opens: it is routed like a navigation.
    val newWindow = eventHandler(IID_NEW_WINDOW_REQUESTED) { args ->
      args.call(Slot.NEW_WINDOW_PUT_HANDLED, 1)
      val uri = args.string(Slot.NEW_WINDOW_GET_URI, "get_Uri").orEmpty()
      if (listener.onNavigation(uri) == NavigationVerdict.ALLOW) webview?.call(Slot.NAVIGATE, wide(uri))
    }
    view.call(Slot.ADD_NEW_WINDOW_REQUESTED, newWindow, eventToken()).check("add_NewWindowRequested")
    if (bridgeScript != null) {
      view.call(Slot.ADD_SCRIPT_ON_DOCUMENT_CREATED, wide(bridgeScript), resultHandler(IID_ADD_SCRIPT_COMPLETED) { _, _ -> })
      val message = eventHandler(IID_WEB_MESSAGE_RECEIVED) { args ->
        val source = args.string(Slot.MESSAGE_GET_SOURCE, "get_Source").orEmpty()
        val data = runCatching { args.string(Slot.MESSAGE_TRY_GET_STRING, "TryGetWebMessageAsString") }.getOrNull() ?: return@eventHandler
        listener.onMessage(source, data)
      }
      view.call(Slot.ADD_WEB_MESSAGE_RECEIVED, message, eventToken()).check("add_WebMessageReceived")
    }
  }

  /** Puts the session cookies `/api/auth/session` set into the view's own store. */
  private fun signIn(view: ComRef, cookies: List<SessionCookie>) {
    if (cookies.isEmpty()) return
    val two = view.queryInterface(IID_ICOREWEBVIEW2_2) ?: throw ComException(E_NOINTERFACE, "ICoreWebView2_2")
    val manager = two.get(Slot.GET_COOKIE_MANAGER, "get_CookieManager")
    for (cookie in cookies) {
      val out = PointerByReference()
      manager.call(Slot.CREATE_COOKIE, wide(cookie.name), wide(cookie.value), wide(cookie.domain), wide(cookie.path), out).check("CreateCookie")
      val made = ComRef(out.value)
      made.call(Slot.COOKIE_PUT_HTTP_ONLY, if (cookie.httpOnly) 1 else 0)
      made.call(Slot.COOKIE_PUT_SECURE, if (cookie.secure) 1 else 0)
      cookie.sameSite?.let { made.call(Slot.COOKIE_PUT_SAME_SITE, sameSiteKind(it)) }
      cookie.expiresEpochSeconds?.let { made.call(Slot.COOKIE_PUT_EXPIRES, it) }
      manager.call(Slot.ADD_OR_UPDATE_COOKIE, made.pointer).check("AddOrUpdateCookie")
      made.release()
    }
    manager.release()
    two.release()
  }

  /** The view's bounds in the parent's client pixels. */
  fun resize(width: Int, height: Int) = WebView2Thread.post {
    val bounds = Rect(0, 0, width, height)
    pendingBounds = bounds
    controller?.call(Slot.PUT_BOUNDS, bounds)
  }

  /** The parent window moved; WebView2 repositions its popups. */
  fun parentMoved() = WebView2Thread.post { controller?.call(Slot.NOTIFY_PARENT_MOVED) }

  fun executeScript(script: String) = WebView2Thread.post {
    webview?.call(Slot.EXECUTE_SCRIPT, wide(script), resultHandler(IID_EXECUTE_SCRIPT_COMPLETED) { _, _ -> })
  }

  /** Native back: one page back in the view when it can, else [orElse] on the caller's side. */
  fun goBack(orElse: () -> Unit) = WebView2Thread.post {
    val view = webview
    val can = Memory(4).apply { setInt(0, 0) }
    if (view != null && view.call(Slot.GET_CAN_GO_BACK, can) == S_OK && can.getInt(0) != 0) view.call(Slot.GO_BACK) else orElse()
  }

  fun close() {
    closed = true
    WebView2Thread.post {
      controller?.call(Slot.CLOSE)
      webview?.release()
      controller?.release()
      webview = null
      controller = null
    }
  }
}

/** COREWEBVIEW2_COOKIE_SAME_SITE_KIND: NONE 0, LAX 1, STRICT 2. */
fun sameSiteKind(sameSite: String): Int = when (sameSite.lowercase()) {
  "none" -> 0
  "strict" -> 2
  else -> 1
}
