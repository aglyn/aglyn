package com.aglyn.core

import kotlin.concurrent.Volatile
import kotlinx.coroutines.CancellationException

// Crash reporting and product analytics (AGL-4067): one hook every screen and store reports through, so a swallowed
// error, a screen change or a key flow is told to Crashlytics and Analytics from one place. Nothing reaches either until
// `Telemetry.start` is told collection is on, which only a release build pointed at production does
// (`AglynConfig.telemetry`); a debug or emulator build reports nothing, and the desktop app installs no sink at all, so
// there every call is a no-op. The Apple kit's `Telemetry.swift`.
//
// What it may carry is narrow on purpose: the Firebase uid (never an email or a name), screen KEYS such as "site.pages"
// (never a site, page or person name), and event parameters that are identifiers such as a tender type, never an amount
// or anything about a customer.

/** Where telemetry goes: Firebase Crashlytics and Analytics on Android (`FirebaseTelemetrySink`), a recorder in tests. */
interface TelemetrySink {
  /** A non-fatal error, with where it was caught. */
  fun record(error: Throwable, context: String)
  /** A breadcrumb in the next crash report. */
  fun breadcrumb(message: String)
  /** The signed-in person's Firebase uid; null when nobody is signed in. */
  fun setUser(uid: String?)
  /** A custom key on every later crash report. */
  fun setValue(key: String, value: String)
  /** An Analytics event. */
  fun log(event: String, parameters: Map<String, String>)
  /** What kind of error this is, for sending each kind once per place: the class, and a code where the SDK has one. */
  fun kind(error: Throwable): String = error::class.simpleName ?: "error"
  /** Whether an error is not a fault on this platform (a device that is offline). */
  fun isNoise(error: Throwable): Boolean = false
}

/** The events the apps log. Names follow Firebase's (`screen_view`, `sign_up`) where Firebase has one. */
enum class TelemetryEvent(val id: String) {
  SCREEN_VIEW("screen_view"),
  SIGN_IN("sign_in"),
  SIGN_UP("sign_up"),
  WORKSPACE_SWITCH("workspace_switch"),
  SITE_OPEN("site_open"),
  POS_SALE_COMPLETED("pos_sale_completed"),
}

/** The one telemetry hook (see the file comment). */
object Telemetry {
  @Volatile private var sink: TelemetrySink? = null
  @Volatile private var lastScreen: String? = null
  @Volatile private var recorded: Set<String> = emptySet()

  private val IDENTIFIER = Regex("^[A-Za-z0-9._:-]{1,100}$")
  private val OFFLINE = setOf("UnknownHostException", "SocketTimeoutException", "ConnectException", "NoRouteToHostException")

  /** Installs the sink. With [collecting] false nothing is ever handed to it: every call below is a no-op. */
  fun start(collecting: Boolean, sink: TelemetrySink, app: AglynAppId? = null, version: String? = null, build: String? = null) {
    lastScreen = null
    recorded = emptySet()
    this.sink = if (collecting) sink else null
    if (!collecting) return
    sink.setValue("app_version", version ?: "0")
    sink.setValue("app_build", build ?: "0")
    app?.let { sink.setValue("app", it.wire) }
  }

  /** Turns every call into a no-op again (a test's tear-down). */
  fun stop() {
    sink = null
    lastScreen = null
    recorded = emptySet()
  }

  /** Whether anything is collected in this process. */
  val isCollecting: Boolean get() = sink != null

  /**
   * A non-fatal error that was caught and handled (a card that shows "could not load", a listener that failed): sent once
   * per kind and place per launch, so a listener failing on every change cannot crowd out the rest. A cancellation or a
   * dropped connection is not a fault and is never sent.
   */
  fun record(error: Throwable, context: String) {
    val sink = sink ?: return
    if (isNoise(error) || sink.isNoise(error)) return
    val place = identifier(context)
    val key = "$place|${sink.kind(error)}"
    if (key in recorded) return
    recorded = recorded + key
    sink.record(error, place)
  }

  /**
   * The screen on show, by its KEY ("site.pages", "home"): a `screen_view` event, the `screen` key on later crash reports
   * and a breadcrumb. A repeat of the screen already on show is ignored.
   */
  fun screen(key: String) {
    val sink = sink ?: return
    val clean = identifier(key)
    if (clean == lastScreen) return
    lastScreen = clean
    sink.setValue("screen", clean)
    sink.breadcrumb("screen $clean")
    sink.log(TelemetryEvent.SCREEN_VIEW.id, mapOf("screen_name" to clean, "screen_class" to clean))
  }

  /** A key flow. Parameter values must be identifiers (a tender type, a sign-in method); anything else is dropped. */
  fun event(event: TelemetryEvent, parameters: Map<String, String> = emptyMap()) {
    val sink = sink ?: return
    sink.breadcrumb(event.id)
    sink.log(event.id, parameters.filter { (name, value) -> isIdentifier(name) && isIdentifier(value) })
  }

  /** The signed-in person: their Firebase uid only. */
  fun user(uid: String?) {
    sink?.setUser(uid?.ifEmpty { null })
  }

  /**
   * Where a Firestore call failed, as [record] names it: the operation and the collection's name
   * ("firestore.listen:hostMemberships"), never a document id. [path] is a collection's (odd segments) or a document's.
   */
  fun firestoreContext(operation: String, path: String): String {
    val segments = path.trim('/').split('/').filter { it.isNotEmpty() }
    val collection = if (segments.size % 2 == 1) segments.lastOrNull() else segments.dropLast(1).lastOrNull()
    return "firestore.$operation:${collection ?: ""}"
  }

  /** Errors that are not faults on any platform: a cancelled coroutine and a device that is offline, at any depth. */
  fun isNoise(error: Throwable): Boolean {
    var cause: Throwable? = error
    var depth = 0
    while (cause != null && depth < 8) {
      if (cause is CancellationException || cause::class.simpleName in OFFLINE) return true
      cause = cause.cause
      depth += 1
    }
    return false
  }

  internal fun isIdentifier(value: String): Boolean = IDENTIFIER.matches(value)

  /** [value] when it is an identifier, else "other". */
  internal fun identifier(value: String): String = if (isIdentifier(value)) value else "other"
}
