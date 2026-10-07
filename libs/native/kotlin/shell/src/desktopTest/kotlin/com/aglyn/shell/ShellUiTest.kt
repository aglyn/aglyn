package com.aglyn.shell

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.runComposeUiTest
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
import com.aglyn.core.InMemoryKeyValueStore
import com.aglyn.core.Live
import com.aglyn.core.WorkspaceStore
import com.aglyn.core.nowMillis
import com.aglyn.pluginhost.NativeApp
import com.aglyn.pluginhost.NativePluginRegistry
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respondOk
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flowOf
import kotlin.test.Test
import kotlin.test.assertEquals

/** An in-memory person with one password. */
private class FakeAuth : AuthSession {
  private val mutable = MutableStateFlow<AuthState>(AuthState.SignedOut)
  override val state: StateFlow<AuthState> = mutable
  override suspend fun idToken(forceRefresh: Boolean) = if (mutable.value is AuthState.SignedIn) "token" else null
  override suspend fun signInWithEmail(email: String, password: String) {
    if (password != "right") throw AuthError("That email and password do not match.")
    mutable.value = AuthState.SignedIn(AuthUser("u1", email, "Dana"))
  }
  override suspend fun signOut() {
    mutable.value = AuthState.SignedOut
  }
}

/** Documents by collection path, answered at once. */
private class FakeFirestore(private val collections: Map<String, List<FirestoreDoc>>, private val docs: Map<String, FirestoreDoc>) : FirestoreReader {
  override suspend fun get(path: String) = docs[path]
  override suspend fun page(query: FirestoreQuery) = FirestorePage(collections[query.collectionPath].orEmpty(), null)
  override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = flowOf(Live.Ready(docs[path]))
  override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = flowOf(Live.Ready(collections[query.collectionPath].orEmpty()))
}

@OptIn(ExperimentalTestApi::class)
class ShellUiTest {
  private fun services(): ShellServices {
    val auth = FakeAuth()
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
      docs = mapOf("hosts/h1" to FirestoreDoc("h1", "hosts/h1", mapOf("screens" to mapOf("home" to emptyMap<String, Any>(), "about" to emptyMap<String, Any>())))),
    )
    val prefs = InMemoryKeyValueStore()
    val config = AglynConfig.read(AglynEnv(consoleUrl = "https://app.example.com", firebaseProjectId = "demo-test"), AglynAppId.AGLYN)
    return ShellServices(
      app = NativeApp.AGLYN,
      config = config,
      auth = auth,
      firestore = firestore,
      api = ConsoleApiClient(config.consoleOrigin, HttpClient(MockEngine { respondOk() }), auth::idToken),
      workspace = WorkspaceStore(CoroutineScope(SupervisorJob() + Dispatchers.Unconfined), auth, firestore, prefs),
      prefs = prefs,
      registry = NativePluginRegistry(),
      console = { _, _ -> },
    )
  }

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
    onNodeWithText("Acme Shop").assertIsDisplayed()
    onNodeWithTag("site-status").assertIsDisplayed()
    onNodeWithText("Live").assertIsDisplayed()
    onNodeWithText("shop.aglyn.app").assertIsDisplayed()
    onNodeWithTag("quick-action-pages").assertIsDisplayed()
    onNodeWithText("New order #1042").assertIsDisplayed()
    onNodeWithText("5 min ago").assertIsDisplayed()
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
    onNodeWithTag("switcher-site-h1").assertIsDisplayed()
    assertEquals(1, onAllNodesWithTagCount("switcher-org-o1"))
  }
}

@OptIn(ExperimentalTestApi::class)
private fun androidx.compose.ui.test.ComposeUiTest.onAllNodesWithTagCount(tag: String): Int =
  onAllNodes(androidx.compose.ui.test.hasTestTag(tag)).fetchSemanticsNodes().size
