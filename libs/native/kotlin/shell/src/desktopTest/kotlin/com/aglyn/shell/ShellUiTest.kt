package com.aglyn.shell

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assert as assertMatches
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.platform.testTag
import com.aglyn.core.AglynAppId
import com.aglyn.core.AglynConfig
import com.aglyn.core.AglynEnv
import com.aglyn.core.AuthError
import com.aglyn.core.AuthSession
import com.aglyn.core.AuthState
import com.aglyn.core.AuthUser
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestorePage
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.Impersonation
import com.aglyn.core.InMemoryKeyValueStore
import com.aglyn.core.Live
import com.aglyn.core.WorkspaceStore
import com.aglyn.core.nowMillis
import com.aglyn.pluginhost.NativeApp
import com.aglyn.pluginhost.NativePluginRegistry
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.respondOk
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlin.test.Test
import kotlin.test.assertEquals

/** An in-memory person with one password. */
internal class FakeAuth(private val uid: String = "u1") : AuthSession {
  private val mutable = MutableStateFlow<AuthState>(AuthState.SignedOut)
  override val state: StateFlow<AuthState> = mutable
  val support = MutableStateFlow<Impersonation?>(null)
  var ended = 0
  override val impersonation: StateFlow<Impersonation?> = support
  override suspend fun endImpersonation() {
    ended++
    support.value = null
  }
  override suspend fun idToken(forceRefresh: Boolean) = if (mutable.value is AuthState.SignedIn) "token" else null
  override suspend fun signInWithEmail(email: String, password: String) {
    if (password != "right") throw AuthError("That email and password do not match.")
    mutable.value = AuthState.SignedIn(AuthUser(uid, email, "Dana"))
  }
  override suspend fun signUpWithEmail(email: String, password: String): AuthUser {
    val created = AuthUser("u2", email, null, emailVerified = false)
    mutable.value = AuthState.SignedIn(created)
    return created
  }
  override suspend fun signOut() {
    mutable.value = AuthState.SignedOut
  }
}

/** Documents by collection path, answered at once; a [live] collection answers again each time a test changes it. */
internal class FakeFirestore(
  private val collections: Map<String, List<FirestoreDoc>>,
  private val docs: Map<String, FirestoreDoc>,
  private val live: Map<String, StateFlow<List<FirestoreDoc>>> = emptyMap(),
) : FirestoreReader {
  override suspend fun get(path: String) = docs[path]
  override suspend fun page(query: FirestoreQuery) = FirestorePage(live[query.collectionPath]?.value ?: collections[query.collectionPath].orEmpty(), null)
  override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = flowOf(Live.Ready(docs[path]))
  override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> =
    live[query.collectionPath]?.let { flow -> flow.map { Live.Ready(it) } } ?: flowOf(Live.Ready(collections[query.collectionPath].orEmpty()))
}

/** The shell's services over the fakes: one workspace (Acme) with one site (Acme Shop) and one unread order notification. */
internal fun testServices(
  userDoc: Map<String, Any?>? = null,
  writer: com.aglyn.core.FirestoreWriter = com.aglyn.core.NoFirestoreWrites,
  apiCalls: MutableList<String> = java.util.concurrent.CopyOnWriteArrayList(),
  /** The session the shell runs on; one person by default, or several accounts (Add account). */
  authFor: (com.aglyn.core.KeyValueStore) -> AuthSession = { FakeAuth() },
  /** The workspace's own document (`orgs/o1`), when a test needs its plan or brand. */
  orgDoc: Map<String, Any?>? = null,
  /** A JSON body a route answers with (by path); an empty 200 otherwise. */
  apiBody: (String) -> String? = { null },
  /** Collections a test changes while the shell runs (a site deleted), by path; they replace the fixed ones. */
  liveCollections: Map<String, StateFlow<List<FirestoreDoc>>> = emptyMap(),
  /** Plugins loaded beside the platform's, for a test that needs one's contributions (the AI panel's slot). */
  plugins: List<com.aglyn.pluginhost.NativePluginManifestEntry> = emptyList(),
): ShellServices {
  val prefs = InMemoryKeyValueStore()
  val auth = authFor(prefs)
  val firestore = FakeFirestore(
    collections = mapOf(
      "users/u1/orgs" to listOf(FirestoreDoc("o1", "users/u1/orgs/o1", mapOf("orgName" to "Acme", "slug" to "acme", "role" to "owner"))),
      "users/u1/hostMemberships" to listOf(
        FirestoreDoc("h1", "users/u1/hostMemberships/h1", mapOf("orgId" to "o1", "displayName" to "Acme Shop", "subdomain" to "shop", "role" to "admin")),
      ),
      "users/u1/notifications" to listOf(
        FirestoreDoc(
          "n1", "users/u1/notifications/n1",
          mapOf("title" to "New order #1042", "body" to "Jordan Lee ordered 2 items.", "read" to false, "type" to "content.order",
            "createdAt" to FirestoreTimestamp((nowMillis() - 5 * 60_000) / 1000)),
        ),
      ),
    ),
    live = liveCollections,
    docs = listOfNotNull(userDoc?.let { "users/u1" to FirestoreDoc("u1", "users/u1", it) }, orgDoc?.let { "orgs/o1" to FirestoreDoc("o1", "orgs/o1", it) }).toMap() + mapOf("hosts/h1" to FirestoreDoc("h1", "hosts/h1", mapOf("screens" to mapOf("home" to emptyMap<String, Any>(), "about" to emptyMap<String, Any>())))),
  )
  val config = AglynConfig.read(AglynEnv(consoleUrl = "https://app.example.com", firebaseProjectId = "demo-test"), AglynAppId.AGLYN)
  return ShellServices(
    app = NativeApp.AGLYN,
    config = config,
    auth = auth,
    firestore = firestore,
    api = ConsoleApiClient(config.consoleOrigin, HttpClient(
      MockEngine { request ->
        apiCalls += request.url.encodedPath
        apiBody(request.url.encodedPath)?.let {
          respond(it, headers = io.ktor.http.headersOf(io.ktor.http.HttpHeaders.ContentType, "application/json"))
        } ?: respondOk()
      },
    ), { auth.idToken(it) }),
    workspace = WorkspaceStore(CoroutineScope(SupervisorJob() + Dispatchers.Unconfined), auth, firestore, prefs),
    prefs = prefs,
    registry = NativePluginRegistry().also { it.load(PLATFORM_ENTRIES + plugins) },
    besigner = { _, _, _ -> },
    writer = writer,
  )
}

@OptIn(ExperimentalTestApi::class)
class ShellUiTest {
  private fun services(
    userDoc: Map<String, Any?>? = null,
    writer: com.aglyn.core.FirestoreWriter = com.aglyn.core.NoFirestoreWrites,
    apiCalls: MutableList<String> = java.util.concurrent.CopyOnWriteArrayList(),
  ): ShellServices = testServices(userDoc, writer, apiCalls)

  @Test
  fun signsInAndShowsTheSiteDashboard() = runComposeUiTest {
    val services = services()
    setContent { AglynShell(services) }

    onNodeWithTag("sign-in-email").performTextInput("dana@example.test")
    onNodeWithTag("sign-in-password").performTextInput("wrong")
    onNodeWithTag("sign-in-submit").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("sign-in-error") > 0 }
    onNodeWithText("That email and password do not match.").assertIsDisplayed()

    // Retype the password from scratch.
    onNodeWithTag("sign-in-password").performTextClearance()
    onNodeWithTag("sign-in-password").performTextInput("right")
    onNodeWithTag("sign-in-submit").performClick()

    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("site-header") > 0 }
    onAllNodesWithText("Acme Shop").onFirst().assertIsDisplayed()
    onNodeWithTag("site-status").assertIsDisplayed()
    onNodeWithText("Live").assertIsDisplayed()
    onNodeWithText("shop.aglyn.app").assertIsDisplayed()
    // Home says what waits on the person, and nothing does here (no plugin lines in this build, the plan is paid).
    onNodeWithTag("needs-you-none").assertIsDisplayed()
  }

  /** Sign-up is the console's: the form, the agreement it is gated on, the console's routes, then the verification step. */
  @Test
  fun signsUpThroughTheConsolesRoutesAndThenAsksForTheAddressToBeConfirmed() = runComposeUiTest {
    // The console's mock answers on the HTTP client's threads and the writes land on their own coroutines, while the test
    // thread reads both: thread-safe lists, so a read never meets a write in progress (ConcurrentModificationException).
    val calls = java.util.concurrent.CopyOnWriteArrayList<String>()
    val merges = java.util.concurrent.CopyOnWriteArrayList<String>()
    val writer = object : com.aglyn.core.FirestoreWriter {
      override suspend fun merge(path: String, data: Map<String, Any?>) { merges += "$path ${data.keys.sorted()}" }
    }
    val services = services(writer = writer, apiCalls = calls)
    setContent { AglynShell(services) }
    onNodeWithTag("sign-in-create-account").performClick()
    onNodeWithTag("sign-up-first-name").performTextInput("Ada")
    onNodeWithTag("sign-up-last-name").performTextInput("Lovelace")
    onNodeWithTag("sign-up-organization").performTextInput("Analytical Engines")
    onNodeWithTag("sign-up-email").performTextInput("ada@example.test")
    onNodeWithTag("sign-up-password").performTextInput("Passw0rd!")
    onNodeWithTag("sign-up-confirm").performTextInput("Passw0rd!")
    // Without the agreement nothing is created.
    onNodeWithTag("sign-up-submit").performScrollTo().performClick()
    onNodeWithText("Please accept the Terms of Service and Privacy Policy to continue.").assertExists()
    onNodeWithTag("sign-up-consent").performScrollTo().performClick()
    onNodeWithTag("sign-up-submit").performScrollTo().performClick()
    waitUntil(timeoutMillis = 10_000) { onAllNodesWithTagCount("verify-continue") > 0 }
    onNodeWithText("Verify your email").assertIsDisplayed()
    assertEquals(
      listOf("/api/lockdown-status", "/api/auth/legal-acceptance", "/api/auth/acquisition"),
      calls.take(3),
    )
    // Both land on their own coroutines; a loaded test machine can take seconds, so wait generously rather than flake.
    waitUntil(timeoutMillis = 10_000) { "/api/auth/send-verification" in calls }
    // The verify screen sends its email as soon as the account is signed in, while sign-up is still holding the
    // workspace name, so the write is awaited on its own rather than read the instant the email call lands.
    waitUntil(timeoutMillis = 10_000) { merges.any { it.startsWith("users/u2") && "pendingSignUpWorkspace" in it } }
  }

  @Test
  fun theSwitcherOpensFromTheSiteHeader() = runComposeUiTest {
    val services = services()
    setContent { AglynShell(services) }
    onNodeWithTag("sign-in-email").performTextInput("dana@example.test")
    onNodeWithTag("sign-in-password").performTextInput("right")
    onNodeWithTag("sign-in-submit").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("home-switcher") > 0 }
    onNodeWithTag("home-switcher").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("picker-site-h1") > 0 }
    onNodeWithTag("picker-whole-workspace").assertIsDisplayed()
  }
  @Test
  fun aWideWindowHasTheRailTheScopesSidebarAndItsSitePicker() = runComposeUiTest {
    val services = services()
    setContent { AglynShell(services) }
    onNodeWithTag("sign-in-email").performTextInput("dana@example.test")
    onNodeWithTag("sign-in-password").performTextInput("right")
    onNodeWithTag("sign-in-submit").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("workspace-rail") > 0 }
    onNodeWithTag("nav-sidebar").assertIsDisplayed()
    // One workspace: its tile, and no All tile (eight or fewer show them all).
    onNodeWithTag("rail-tile-o1").assertIsDisplayed()
    assertEquals(0, onAllNodesWithTagCount("rail-all"))
    // Inside the site: "‹ Acme" back to the whole workspace, then the site's picker.
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("site-picker-button") > 0 }
    onNodeWithTag("scope-back-to-workspace").assertTextContains("Acme", substring = true)
    onNodeWithTag("site-picker-button").assertTextContains("Acme Shop", substring = true)
    // The site's ▾ opens the switcher popover under it (Figma 16:425): find a site, the sites, View all sites.
    onNodeWithTag("site-picker-button").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("site-switcher") > 0 }
    onNodeWithTag("site-switcher-h1").assertIsDisplayed()
    onNodeWithTag("site-switcher-all").assertIsDisplayed()
    // The phone's chip and tabs are for narrow windows only.
    assertEquals(0, onAllNodesWithTagCount("scope-chip"))
  }

  private class RecordingWriter(private val fail: Boolean = false) : com.aglyn.core.FirestoreWriter {
    val writes = mutableListOf<Pair<String, Map<String, Any?>>>()
    override suspend fun merge(path: String, data: Map<String, Any?>) {
      if (fail) throw IllegalStateException("offline")
      writes += path to data
    }
  }

  private fun androidx.compose.ui.test.SemanticsNodeInteraction.assertState(on: Boolean): androidx.compose.ui.test.SemanticsNodeInteraction =
    assertMatches(androidx.compose.ui.test.SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.StateDescription, if (on) "On" else "Off"))

  @Test
  fun notificationSettingsShowStoredAnswersAndWriteOneSwitch() = runComposeUiTest {
    val writer = RecordingWriter()
    val services = services(
      userDoc = mapOf("notificationSettings" to mapOf("accountTypes" to mapOf("content.order" to mapOf("push" to false)))),
      writer = writer,
    )
    setContent { com.aglyn.ui.AglynTheme(dark = false) { NotificationSettingsScreen(services, "u1") } }
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("notification-settings") > 0 }
    onNodeWithTag("notification-category-content").assertExists()
    onNodeWithTag("expand-content").performScrollTo().performClick()
    onNodeWithTag("channel-content.order-push").performScrollTo().assertState(false)
    onNodeWithTag("channel-content.booking-push").assertState(true)
    // Orders are emailed until switched off; low stock is not.
    onNodeWithTag("channel-content.order-email").assertState(true)
    onNodeWithTag("channel-content.lowStock-email").assertState(false)
    // Desktop registers no push, so the screen says where push goes.
    onNodeWithTag("notification-settings-no-push").assertExists()

    onNodeWithTag("channel-content.order-push").performScrollTo().performClick()
    waitUntil(timeoutMillis = 3_000) { writer.writes.isNotEmpty() }
    assertEquals("users/u1" to com.aglyn.core.accountPushWrite("content.order", true), writer.writes.single())
    onNodeWithTag("channel-content.order-push").assertState(true)
  }

  @Test
  fun aCategorySwitchWritesItsOneAnswer() = runComposeUiTest {
    val writer = RecordingWriter()
    val services = services(userDoc = emptyMap(), writer = writer)
    setContent { com.aglyn.ui.AglynTheme(dark = false) { NotificationSettingsScreen(services, "u1") } }
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("notification-settings") > 0 }
    onNodeWithTag("channel-billing-email").performScrollTo().assertState(false).performClick()
    waitUntil(timeoutMillis = 3_000) { writer.writes.isNotEmpty() }
    assertEquals(
      "users/u1" to mapOf("notificationSettings" to mapOf("account" to mapOf("billing" to mapOf("email" to true)))),
      writer.writes.single(),
    )
  }

  @Test
  fun aTypeOverrideOffersToFollowItsCategoryAgain() = runComposeUiTest {
    val writer = RecordingWriter()
    val services = services(
      userDoc = mapOf("notificationSettings" to mapOf("accountTypes" to mapOf("content.order" to mapOf("email" to false)))),
      writer = writer,
    )
    setContent { com.aglyn.ui.AglynTheme(dark = false) { NotificationSettingsScreen(services, "u1") } }
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("notification-settings") > 0 }
    onNodeWithTag("expand-content").performScrollTo().performClick()
    onNodeWithTag("channel-content.order-email").performScrollTo().assertState(false)
    onNodeWithTag("reset-content.order").performScrollTo().performClick()
    waitUntil(timeoutMillis = 3_000) { writer.writes.isNotEmpty() }
    assertEquals("users/u1" to com.aglyn.core.notificationTypeResetWrite("content.order"), writer.writes.single())
  }

  @Test
  fun aFailedSaveTurnsTheSwitchBackAndSaysSo() = runComposeUiTest {
    val services = services(userDoc = emptyMap(), writer = RecordingWriter(fail = true))
    setContent { com.aglyn.ui.AglynTheme(dark = false) { NotificationSettingsScreen(services, "u1") } }
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("notification-settings") > 0 }
    onNodeWithTag("channel-content-console").performScrollTo().assertState(true).performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("notification-settings-save-error") > 0 }
    onNodeWithTag("channel-content-console").assertState(true)
  }

  @Test
  fun theFeedMarksAllReadAndFiltersOnTheQuery() = runComposeUiTest {
    val writer = RecordingWriter()
    val services = services(userDoc = emptyMap(), writer = writer)
    val navigator = ShellNavigator(ShellNavigator.NOTIFICATIONS)
    setContent { AglynShell(services, navigator) }
    onNodeWithTag("sign-in-email").performTextInput("dana@example.test")
    onNodeWithTag("sign-in-password").performTextInput("right")
    onNodeWithTag("sign-in-submit").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("notification-n1") > 0 }
    onNodeWithTag("mark-read-n1").assertExists()
    onNodeWithTag("notifications-mark-all").performClick()
    waitUntil(timeoutMillis = 3_000) { writer.writes.any { it.first.contains("/notifications/") } }
    val read = writer.writes.single { it.first.contains("/notifications/") }
    assertEquals("users/u1/notifications/n1", read.first)
    assertEquals(true, read.second["read"])
  }

  /** A support session wears the band on every screen, and its exit brings the staff member's own session back. */
  @Test
  fun aSupportSessionWearsABannerWithAWayBack() = runComposeUiTest {
    val services = services()
    val auth = services.auth as FakeAuth
    setContent { AglynShell(services) }
    onNodeWithTag("sign-in-email").performTextInput("dana@example.test")
    onNodeWithTag("sign-in-password").performTextInput("right")
    onNodeWithTag("sign-in-submit").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("site-header") > 0 }
    assertEquals(0, onAllNodesWithTagCount("impersonation-banner"))

    runOnIdle { auth.support.value = Impersonation(AuthUser("c1", "cass@example.test", "Cass"), "ops@example.test") }
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("impersonation-banner") > 0 }
    onNodeWithText("You are impersonating cass@example.test (staff: ops@example.test). Actions are audited.").assertIsDisplayed()

    onNodeWithTag("impersonation-exit").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("impersonation-banner") == 0 }
    assertEquals(1, auth.ended)
  }

  @Test
  fun settingsOpensNotificationSettings() = runComposeUiTest {
    val services = services(userDoc = emptyMap())
    val navigator = ShellNavigator()
    setContent { AglynShell(services, navigator) }
    onNodeWithTag("sign-in-email").performTextInput("dana@example.test")
    onNodeWithTag("sign-in-password").performTextInput("right")
    onNodeWithTag("sign-in-submit").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("site-header") > 0 }
    runOnIdle { navigator.select(ShellNavigator.SETTINGS) }
    onNodeWithTag("settings-notifications").performScrollTo().performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("notification-settings") > 0 }
  }

  /** A help page is pushed as the browser screen beside the navigation; its menu hands the page to the system (AGL-3935). */
  @Test
  fun aHelpPageOpensAsTheBrowserScreenBesideTheNavigation() = runComposeUiTest {
    val opened = mutableListOf<String>()
    val system = object : androidx.compose.ui.platform.UriHandler {
      override fun openUri(uri: String) { opened += uri }
    }
    val services = services(userDoc = emptyMap())
    val navigator = ShellNavigator()
    setContent {
      androidx.compose.runtime.CompositionLocalProvider(androidx.compose.ui.platform.LocalUriHandler provides system) {
        AglynShell(services, navigator)
      }
    }
    onNodeWithTag("sign-in-email").performTextInput("dana@example.test")
    onNodeWithTag("sign-in-password").performTextInput("right")
    onNodeWithTag("sign-in-submit").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("site-header") > 0 }
    runOnIdle { navigator.select(ShellNavigator.SETTINGS) }
    onNodeWithTag("help-whats-new").performScrollTo().performClick()

    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("web-page-screen") > 0 }
    assertEquals(Route.Web("https://docs.aglyn.com/whats-new"), navigator.current)
    onNodeWithTag("web-page-heading").assertTextContains("docs.aglyn.com/whats-new", substring = true)
    // The navigation stays beside the page on a wide window.
    onNodeWithTag("workspace-rail").assertIsDisplayed()
    onNodeWithTag("nav-sidebar").assertIsDisplayed()
    onNodeWithTag("web-page-menu").performClick()
    onNodeWithTag("web-page-open-browser").performClick()
    assertEquals(listOf("https://docs.aglyn.com/whats-new"), opened)

    onNodeWithTag("web-page-close").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("web-page-screen") == 0 }
    assertEquals(null, navigator.current)
    onNodeWithTag("help-whats-new").assertExists()
  }

  /** Before there is a shell (the sign-in's legal links) a page covers the screen until it is closed. */
  @Test
  fun beforeThereIsAShellAPageCoversTheScreenUntilClosedAndOtherLinksLeave() = runComposeUiTest {
    val opened = mutableListOf<String>()
    val secure = mutableListOf<String>()
    val system = object : androidx.compose.ui.platform.UriHandler {
      override fun openUri(uri: String) { opened += uri }
    }
    setContent {
      androidx.compose.runtime.CompositionLocalProvider(androidx.compose.ui.platform.LocalUriHandler provides system) {
        com.aglyn.webview.ProvideInAppBrowser(secureTab = { secure += it }) {
          val uri = androidx.compose.ui.platform.LocalUriHandler.current
          androidx.compose.foundation.layout.Column {
            for ((tag, link) in listOf(
              "terms" to "https://aglyn.com/legal/terms",
              "mail" to "mailto:hello@example.test",
              "google" to "https://accounts.google.com/o/oauth2/v2/auth?client_id=x",
            )) {
              androidx.compose.material3.TextButton(onClick = { uri.openUri(link) }, modifier = androidx.compose.ui.Modifier.testTag(tag)) {
                androidx.compose.material3.Text(tag)
              }
            }
          }
        }
      }
    }
    onNodeWithTag("terms").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("web-page-screen") > 0 }
    onNodeWithTag("web-page-heading").assertTextContains("aglyn.com/legal/terms", substring = true)
    onNodeWithTag("web-page-close").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("web-page-screen") == 0 }

    onNodeWithTag("mail").performClick()
    onNodeWithTag("google").performClick()
    assertEquals(listOf("mailto:hello@example.test"), opened)
    assertEquals(listOf("https://accounts.google.com/o/oauth2/v2/auth?client_id=x"), secure)
    assertEquals(0, onAllNodesWithTagCount("web-page-screen"))
  }
}

@OptIn(ExperimentalTestApi::class)
private fun androidx.compose.ui.test.ComposeUiTest.onAllNodesWithTagCount(tag: String): Int =
  onAllNodes(androidx.compose.ui.test.hasTestTag(tag)).fetchSemanticsNodes().size
