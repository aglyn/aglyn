package com.aglyn.shell

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.core.AglynConfig
import com.aglyn.core.AuthSession
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreReader
import com.aglyn.core.WorkspaceStore
import com.aglyn.core.WorkspaceState
import com.aglyn.pluginhost.BesignerPaths
import com.aglyn.pluginhost.ConsoleScope
import com.aglyn.pluginhost.DeepLinks
import com.aglyn.pluginhost.NativeApp
import com.aglyn.pluginhost.NativeLinkTarget
import com.aglyn.pluginhost.NativeParams
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.NativePluginRegistry
import com.aglyn.pluginhost.scopedConsolePath

/** Everything a shell needs, built once per process by the platform entry point. */
class ShellServices(
  val app: NativeApp,
  val config: AglynConfig,
  val auth: AuthSession,
  val firestore: FirestoreReader,
  val api: ConsoleApiClient,
  val workspace: WorkspaceStore,
  /** Small per-install settings (the POS store this device sells for). */
  val prefs: com.aglyn.core.KeyValueStore,
  val registry: NativePluginRegistry,
  /**
   * Shows a Besigner page (a whole console path) in the authenticated web
   * view inside the app, the apps' only web content. [onConsoleLink] hears a
   * link from it to any other console page, which the shell opens natively.
   */
  val besigner: @Composable (path: String, onExit: () -> Unit, onConsoleLink: (String) -> Unit) -> Unit,
  /** Test credentials a debug build fills the sign-in form with; null in release. */
  val debugSignIn: Pair<String, String>? = null,
  /** The register's printers, card reader and scanner; in the Aglyn app, only the device's print sheet. */
  val peripherals: com.aglyn.hardware.Peripherals = com.aglyn.hardware.NoPeripherals,
  /** This install's push registration; desktop has none in v1. */
  val push: com.aglyn.core.PushRegistrar = com.aglyn.core.NoPush,
  /** Writes as the signed-in person, under the same rules as the console's own writes. */
  val writer: com.aglyn.core.FirestoreWriter = com.aglyn.core.NoFirestoreWrites,
  /**
   * Opens a page someone else hosts (Stripe Checkout, the Customer Portal)
   * in the platform's secure in-app browser: Custom Tabs on Android, the
   * system browser on desktop. Never a web view of ours.
   */
  val openHostedPage: (url: String) -> Unit = {},
  /** Remote images for every screen ([com.aglyn.ui.LocalImageLoader]). */
  val imageLoader: com.aglyn.ui.ImageLoader? = HttpImageLoader(com.aglyn.core.defaultHttpClient()),
  /** The device's photo, camera and file pickers ([com.aglyn.ui.LocalMediaPicker]); the entry point binds them. */
  val mediaPicker: com.aglyn.ui.MediaPicker? = null,
  /** Where an export goes ([com.aglyn.ui.LocalFileExporter]); the entry point binds it. */
  val fileExporter: com.aglyn.ui.FileExporter? = null,
  /**
   * How this platform signs in through the console (AGL-3816): Custom Tabs returning to the app's scheme on Android, the
   * system browser and a loopback listener on the desktop. Null hides single sign-on.
   */
  val consoleHandoff: com.aglyn.core.ConsoleHandoffTransport? = null,
  /**
   * Whether every sign-in and sign-up goes through the console: the Windows build against a project that enforces App Check,
   * which Compose Desktop cannot attest to (Zach, 2026-10-15).
   */
  val signInThroughConsoleOnly: Boolean = false,
  /** The Windows build's console-minted App Check (AGL-3816): seeded by the hand-off, dropped on sign-out. */
  val consoleAppCheck: com.aglyn.core.ConsoleMintedAppCheck? = null,
  /** The home-screen icon picker (Theme ▸ App icon): Android's launcher aliases in the Aglyn app; null where there is none. */
  val appIcons: AppIconSwitcher? = null,
) {
  /** The signed-out screens and what a sign-up carries across them. */
  val authFlow = AuthFlow()

  /** What each workspace's plan includes (`/api/orgs/entitlements`), read once per workspace and shared. */
  val entitlements = com.aglyn.core.OrgEntitlementsCache(api)

  /** Every account signed in on this device (Add account), when the platform keeps more than one. */
  val accounts: com.aglyn.core.AccountSessions? get() = auth as? com.aglyn.core.AccountSessions

  /** What the person keeps on their account: pins, recent workspaces, starred, recents, workspace colors, the theme. */
  val accountPrefs: com.aglyn.core.AccountPreferencesStore by lazy {
    com.aglyn.core.AccountPreferencesStore(
      kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Default),
      auth, firestore, writer, prefs,
    )
  }

  /** The console routes and account writes every sign-up door makes. */
  val signUp: com.aglyn.core.SignUpService by lazy { com.aglyn.core.SignUpService(api, writer, firestore) }

  /** The signed-in person's invitations, joined on their own (AGL-4023): never an Accept step. */
  val inviteJoin: com.aglyn.core.InviteAutoJoin by lazy { com.aglyn.core.InviteAutoJoin(signUp) }

  /** Removes this install's device row, then signs out, so no push follows the person out. */
  suspend fun signOut() {
    (auth.state.value as? com.aglyn.core.AuthState.SignedIn)?.let { push.unregister(it.user.uid) }
    auth.signOut()
    consoleAppCheck?.clear()
    authFlow.reset()
    authFlow.pendingVerificationCode = null
  }
}

/** Where the shell is: a top-level destination plus a stack of pushed routes. */
sealed interface Route {
  data class Screen(val screenId: String, val params: NativeParams = emptyMap()) : Route
  /** The Besigner on a whole console path that [com.aglyn.pluginhost.BesignerPaths] accepts. */
  data class Besigner(val path: String) : Route
  /** The site's Analytics page. */
  data object Analytics : Route
  data object Switcher : Route
  data object NotificationSettings : Route
  /** Account ▸ Theme: appearance, theme, accent, density and the rest. */
  data object ThemeSettings : Route
  /** A plain web page (a live site, a preview, a docs or legal page) in the in-app browser screen. */
  data class Web(val url: String) : Route
  /** The one box's full results for a query ("See all results"), grouped, with filters. */
  data class SearchResults(val query: String) : Route
}

/**
 * The platform's own content screens (sites, pages, media, setup…), which are
 * core rather than a plugin's: loaded before the generated plugin manifest,
 * through the same registrar and declaration check.
 */
val PLATFORM_ENTRIES: List<com.aglyn.pluginhost.NativePluginManifestEntry> = listOf(com.aglyn.site.SitePlatformEntry, com.aglyn.screens.CoreScreens.manifestEntry)

/** The site's Pages screen, which the site registration (libs/native/kotlin/site) contributes. */
const val SITE_PAGES_SCREEN_ID = "site.pages"

/** What the desktop's menu bar can ask of the shell. */
enum class ShellCommand {
  FIND, SWITCH_WORKSPACE, SWITCH_SITE, SETTINGS, TOGGLE_SIDEBAR, TOGGLE_RAIL, ADD_ACCOUNT, SHORTCUTS, AI_PANEL, HELP_DOCS,
  HOME, NOTIFICATIONS, BACK, NEW_TAB, CLOSE_TAB, REOPEN_TAB, TAB_OVERVIEW,
  PIN_1, PIN_2, PIN_3, PIN_4, PIN_5,
}

class ShellNavigator(initialTop: String = HOME) {
  var top by mutableStateOf(initialTop)
  val stack = mutableStateListOf<Route>()

  /** A command from outside the shell's own controls (the desktop's menu bar), handled once by the shell. */
  var command by mutableStateOf<ShellCommand?>(null)

  /** The account the shell last showed: a different one starts at Home. */
  internal var shownUid: String? = null

  /** A link waiting for the workspace and site it belongs to to come on screen (`openLink`), with where that is. */
  internal var deferredLink by mutableStateOf<Pair<String, LinkScope>?>(null)

  val current: Route? get() = stack.lastOrNull()

  /**
   * The saved-state key of every place on the way to [current]: the destination, then each pushed screen by its depth and
   * route, so the same screen pushed twice holds two states and a popped one leaves its key behind.
   */
  val keys: List<String> get() = listOf(baseKey(top)) + stack.mapIndexed { depth, route -> "${baseKey(top)}/$depth:$route" }

  /** The saved-state key of what is showing. */
  val currentKey: String get() = keys.last()

  /** The destinations visited, for the title bar's back and forward (Mac, iPad, tablets and desktop). */
  private val history = mutableStateListOf(initialTop)
  private var historyAt by mutableStateOf(0)
  val canGoBackInHistory: Boolean get() = historyAt > 0
  val canGoForwardInHistory: Boolean get() = historyAt < history.lastIndex

  fun select(key: String) {
    top = key
    stack.clear()
    if (history.getOrNull(historyAt) != key) {
      while (history.lastIndex > historyAt) history.removeAt(history.lastIndex)
      history.add(key)
      if (history.size > 50) history.removeAt(0)
      historyAt = history.lastIndex
    }
  }

  /** The destination before this one in the history, as the title bar's back arrow goes. */
  fun historyBack() {
    if (!canGoBackInHistory) return
    historyAt -= 1
    top = history[historyAt]
    stack.clear()
  }

  fun historyForward() {
    if (!canGoForwardInHistory) return
    historyAt += 1
    top = history[historyAt]
    stack.clear()
  }

  fun push(route: Route) {
    stack.add(route)
  }

  /**
   * Opens a plain web page in the in-app browser screen, pushed over what is showing: the whole screen on a phone, the main
   * area beside the navigation on anything wider. Every page the shell opens comes through here, so this is where a
   * new-tab request will branch once the shell has tabs.
   */
  fun openWeb(url: String) = push(Route.Web(url))

  /** True when something was popped; false at a top-level destination. */
  fun back(): Boolean = if (stack.isEmpty()) false else { stack.removeAt(stack.lastIndex); true }

  companion object {
    const val HOME = "home"
    const val MORE = "more"
    /** The phone's Menu tab: the scope's grouped list, as the sidebar shows it. */
    const val MENU = "menu"
    const val NOTIFICATIONS = "notifications"
    const val SETTINGS = "settings"
    fun screenKey(screenId: String) = "screen:$screenId"
    private fun baseKey(top: String) = "top:$top"
    /** A pushed screen's key, which is dropped when the screen is popped (a destination's is kept). */
    fun isPushedKey(key: String) = key.contains('/')
  }
}

/**
 * The context a device screen is handed: nobody is signed in, so it holds no member, no workspace and no site, and
 * calls the console anonymously with its own pairing token. [leave] returns the tablet to sign-in.
 */
internal class DeviceContext(
  private val services: ShellServices,
  private val leave: () -> Unit,
) : NativePluginContext {
  override val uid: String = ""
  override val orgId: String? = null
  override val hostId: String? = null
  override val orgSlug: String? = null
  override val hostSlug: String? = null
  override val firestore get() = services.firestore
  override val api get() = services.api
  override val deviceStore get() = services.prefs

  // This tablet's own card reader, for a kiosk's Tap to Pay. A device screen holds no site, so nothing here is scoped to one.
  override val peripherals get() = services.peripherals

  override fun navigate(screenId: String, params: NativeParams) = Unit

  override fun back() = leave()

  override fun openBesigner(path: String, scope: ConsoleScope): Boolean = false
}

internal class ShellPluginContext(
  override val uid: String,
  private val workspace: WorkspaceState,
  private val services: ShellServices,
  private val navigator: ShellNavigator,
  private val topLevelScreens: Set<String>,
) : NativePluginContext {
  override val orgId get() = workspace.org?.id
  override val hostId get() = workspace.site?.id
  override val orgSlug get() = workspace.org?.slug
  override val hostSlug get() = workspace.site?.subdomain?.ifEmpty { null }
  override val firestore get() = services.firestore
  override val api get() = services.api
  override val writer get() = services.writer
  override val peripherals get() = services.peripherals
  override val deviceStore get() = services.prefs
  override val siteRole get() = workspace.site?.role
  override val orgRole get() = workspace.org?.role

  override fun slotWidgets(slot: String) = services.registry.widgets(services.app, slot)

  override fun selectSite(hostId: String) = services.workspace.selectSite(hostId)

  override fun back() {
    navigator.back()
  }

  override fun navigate(screenId: String, params: NativeParams) {
    if (screenId == NavKeys.HOME_SCREEN) {
      navigator.select(ShellNavigator.HOME)
    } else if (screenId in topLevelScreens && params.isEmpty()) {
      navigator.select(ShellNavigator.screenKey(screenId))
    } else {
      navigator.push(Route.Screen(screenId, params))
    }
  }

  override fun openBesigner(path: String, scope: ConsoleScope): Boolean {
    val whole = scopedConsolePath(path, scope, orgSlug, hostSlug)
    if (!BesignerPaths.isBesignerPath(whole)) return false
    navigator.push(Route.Besigner(whole))
    return true
  }

  /**
   * A link from a notification, an App Link or the Besigner: a plugin's native
   * screen, the Besigner, or (for a console page nothing answers natively yet)
   * Home. Never a console page.
   */
  fun showNotifications() = navigator.select(ShellNavigator.NOTIFICATIONS)

  /** The workspace a notification is about, by name, when the person holds it. */
  fun workspaceName(row: FeedNotification): String? {
    val org = row.orgId?.let { id -> workspace.orgs.firstOrNull { it.id == id } }
    val site = row.hostId?.let { id -> workspace.sites.firstOrNull { it.id == id } }
    return listOfNotNull(org?.name, site?.name).joinToString(" · ").ifEmpty { null }
  }

  /**
   * Follows a notification: first onto the workspace and site it is about
   * (a booking at another site opens that site's bookings), then its link.
   */
  fun openNotification(row: FeedNotification) {
    val link = row.link
    val orgId = row.orgId ?: workspace.sites.firstOrNull { it.id == row.hostId }?.orgId
    if (orgId == null) {
      if (link != null) openLink(link)
      return
    }
    val scope = LinkScope(orgId, row.hostId ?: workspace.site?.id?.takeIf { orgId == workspace.org?.id })
    if (link == null) {
      if (!linkScopeSettled(scope, workspace)) services.workspace.select(scope.orgId, scope.hostId)
      return
    }
    openIn(scope, link)
  }

  /**
   * Opens a link where it belongs: a link naming another workspace or site the person holds switches there first and
   * opens once that workspace is on screen (`settleDeferredLink`), so its screen reads that site, not the one before.
   */
  override fun openLink(link: String): Boolean {
    val scope = linkScopeOf(link, workspace) ?: return openHere(link)
    openIn(scope, link)
    return true
  }

  private fun openIn(scope: LinkScope, link: String) {
    // A workspace the person no longer holds cannot come on screen; the link opens where they are.
    if (linkScopeSettled(scope, workspace) || workspace.orgs.none { it.id == scope.orgId }) {
      openHere(link)
      return
    }
    navigator.deferredLink = link to scope
    linkScopePick(scope, workspace)?.let { (orgId, hostId) -> services.workspace.select(orgId, hostId) }
  }

  /** Called as the workspace changes: picks the next step toward a deferred link's site, and opens the link once there. */
  fun settleDeferredLink() {
    val (link, scope) = navigator.deferredLink ?: return
    if (!workspace.ready) return
    if (linkScopeSettled(scope, workspace)) {
      navigator.deferredLink = null
      openHere(link)
      return
    }
    linkScopePick(scope, workspace)?.let { (orgId, hostId) -> services.workspace.select(orgId, hostId) }
  }

  private fun openHere(link: String): Boolean {
    when (val target = DeepLinks.resolve(withAiJobPath(link), services.registry.deepLinks())) {
      is NativeLinkTarget.Screen -> navigator.push(Route.Screen(target.screen, target.params))
      is NativeLinkTarget.Besigner -> navigator.push(Route.Besigner(target.path))
      is NativeLinkTarget.Unmatched -> nativeFor(target.path)
      null -> return false
    }
    return true
  }

  /** The shell's own native answer to a console page no plugin claims. */
  private fun nativeFor(path: String) {
    val rest = DeepLinks.splitConsoleScope(path.substringBefore('?')).rest
    when {
      rest == "/screens" || rest.startsWith("/screens/") -> navigator.push(Route.Screen(SITE_PAGES_SCREEN_ID))
      rest == "/analytics" || rest.startsWith("/analytics/") -> navigator.push(Route.Analytics)
      rest.startsWith("/manage/notifications/settings") -> {
        navigator.select(ShellNavigator.SETTINGS)
        navigator.push(Route.NotificationSettings)
      }
      rest.startsWith("/notifications") || rest.startsWith("/manage/notifications") -> navigator.select(ShellNavigator.NOTIFICATIONS)
      rest.startsWith("/settings") -> navigator.select(ShellNavigator.SETTINGS)
      else -> navigator.select(ShellNavigator.HOME)
    }
  }
}
