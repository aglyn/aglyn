package com.aglyn.shell

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
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
import com.aglyn.core.ConsoleHandoffTransport
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestorePage
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.InMemoryKeyValueStore
import com.aglyn.core.Live
import com.aglyn.core.WorkspaceStore
import com.aglyn.core.queryParams
import com.aglyn.pluginhost.NativeApp
import com.aglyn.pluginhost.NativePluginRegistry
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flowOf
import kotlin.test.Test
import kotlin.test.assertEquals

/** The SSO account: a password sign-in in the project pool would find a different, smaller account. */
private const val TENANT = "aglyn-org-y5v14"
private const val TENANT_UID = "SsoTenantMemberUid0000000001"

private class TenantAuth : AuthSession {
  private val mutable = MutableStateFlow<AuthState>(AuthState.SignedOut)
  override val state: StateFlow<AuthState> = mutable
  val passwordSignIns = mutableListOf<String>()
  var pool: String? = null
  override suspend fun idToken(forceRefresh: Boolean) = if (mutable.value is AuthState.SignedIn) "token" else null
  override suspend fun signInWithEmail(email: String, password: String) {
    passwordSignIns += email
    throw AuthError("That email and password do not match.")
  }
  override suspend fun signInWithCustomToken(token: String, tenantId: String?) {
    if (token != "custom-for-sso-member") throw AuthError("Wrong token")
    pool = tenantId
    mutable.value = AuthState.SignedIn(AuthUser(TENANT_UID, "sso-member@aglyn.com", "Sam", emailVerified = true))
  }
  override suspend fun signOut() {
    mutable.value = AuthState.SignedOut
  }
}

private class TenantFirestore : FirestoreReader {
  private val names = listOf("Juniper Street Co.", "EDR Construction", "Ready To Roll", "Elevated Concepts", "Test Org", "Aglyn LLC")
  private val orgs = names.mapIndexed { i, name -> FirestoreDoc("o$i", "users/$TENANT_UID/orgs/o$i", mapOf("orgName" to name, "slug" to "o$i", "role" to "owner")) }
  override suspend fun get(path: String): FirestoreDoc? = null
  override suspend fun page(query: FirestoreQuery) = FirestorePage(emptyList(), null)
  override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = flowOf(Live.Ready(null))
  override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> =
    flowOf(Live.Ready(if (query.collectionPath == "users/$TENANT_UID/orgs") orgs else emptyList()))
}

@OptIn(ExperimentalTestApi::class)
class SingleSignOnTest {
  /** The console, Firebase and the console's sign-in page, played by the test. */
  private class Rig {
    val calls = mutableListOf<String>()
    val auth = TenantAuth()
    var opened: Map<String, String> = emptyMap()
    val services: ShellServices

    init {
      val calls = calls
      val auth = auth
      val firestore = TenantFirestore()
      val json = headersOf(HttpHeaders.ContentType, "application/json")
      val http = HttpClient(MockEngine { request ->
        calls += request.url.encodedPath
        when (request.url.encodedPath) {
          "/api/auth/sso-lookup" -> respond("""{"ssoEnabled":true,"tenantId":"$TENANT","providerId":"saml.aglyn"}""", HttpStatusCode.OK, json)
          "/api/auth/native-handoff/redeem" -> respond("""{"ok":true,"token":"custom-for-sso-member","tenantId":"$TENANT"}""", HttpStatusCode.OK, json)
          else -> respond("{}", HttpStatusCode.OK, json)
        }
      })
      // The console page, played by the test: it reads what the app sent and goes back to the app's return address.
      val transport = ConsoleHandoffTransport { page ->
        val url = page("http://127.0.0.1:5000/handoff")
        opened = queryParams(url.substringAfter('?'))
        "http://127.0.0.1:5000/handoff?code=${"k".repeat(43)}&state=${opened["state"]}"
      }
      val prefs = InMemoryKeyValueStore()
      val config = AglynConfig.read(AglynEnv(consoleUrl = "https://app.example.com", firebaseProjectId = "demo-test"), AglynAppId.AGLYN)
      services = ShellServices(
        app = NativeApp.AGLYN, config = config, auth = auth, firestore = firestore,
        api = ConsoleApiClient(config.consoleOrigin, http, auth::idToken),
        workspace = WorkspaceStore(CoroutineScope(SupervisorJob() + Dispatchers.Unconfined), auth, firestore, prefs),
        prefs = prefs, registry = NativePluginRegistry().also { it.load(PLATFORM_ENTRIES) },
        besigner = { _, _, _ -> }, consoleHandoff = transport,
      )
    }
  }

  /**
   * The acceptance case (AGL-3816): an address on a workspace's SSO domain signs in through the console's `/sso`, the hand-off
   * signs the app in as the TENANT account, and its switcher holds every workspace that account belongs to.
   */
  @Test
  fun anSsoAddressSignsInThroughItsWorkspaceAndSeesEveryWorkspace() = runComposeUiTest {
    val rig = Rig()
    val (calls, auth, services) = Triple(rig.calls, rig.auth, rig.services)
    setContent { AglynShell(services) }
    onNodeWithTag("sign-in-email").performTextInput("sso-member@aglyn.com")
    onNodeWithTag("sign-in-submit").performClick()
    waitUntil(timeoutMillis = 3_000) { auth.state.value is AuthState.SignedIn }
    assertEquals(emptyList(), auth.passwordSignIns)
    assertEquals("sso", rig.opened["start"])
    assertEquals("sso-member@aglyn.com", rig.opened["login_hint"])
    assertEquals(TENANT, auth.pool)
    assertEquals(listOf("/api/auth/sso-lookup", "/api/auth/native-handoff/redeem"), calls.take(2))
    waitUntil(timeoutMillis = 3_000) { services.workspace.state.value.orgs.size == 6 }
    assertEquals(
      setOf("Juniper Street Co.", "EDR Construction", "Ready To Roll", "Elevated Concepts", "Test Org", "Aglyn LLC"),
      services.workspace.state.value.orgs.map { it.name }.toSet(),
    )
    assertEquals(false, services.workspace.state.value.hasMoreOrgs)
  }

  /** "Continue with SSO" opens the work-email step, which names the domain the console knows and goes on to its sign-in. */
  @Test
  fun theSsoButtonAsksForTheWorkEmailAndContinues() = runComposeUiTest {
    val rig = Rig()
    setContent { AglynShell(rig.services) }
    onNodeWithTag("sign-in-sso").performClick()
    onNodeWithTag("sso-email").performTextInput("sso-member@aglyn.com")
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTag("sso-routing").fetchSemanticsNodes().isNotEmpty() }
    onNodeWithTag("sso-submit").performClick()
    waitUntil(timeoutMillis = 3_000) { rig.auth.state.value is AuthState.SignedIn }
    assertEquals("sso", rig.opened["start"])
    assertEquals("sso-member@aglyn.com", rig.opened["login_hint"])
    assertEquals(emptyList(), rig.auth.passwordSignIns)
  }
}
