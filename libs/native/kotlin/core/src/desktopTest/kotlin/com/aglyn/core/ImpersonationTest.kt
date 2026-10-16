package com.aglyn.core

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * A support session (AGL-3667): a staff member signed in as a customer through the custom token `/api/admin/impersonate` mints.
 * The customer's session lives in memory, the staff session is set aside untouched, and ending it returns to it.
 */
class ImpersonationTest {
  private val json = headersOf(HttpHeaders.ContentType, "application/json")

  /** An ID token whose claims are [claims] (unsigned: the app only reads them to show who is signed in). */
  private fun jwt(claims: String): String {
    fun enc(text: String) = Base64.getUrlEncoder().withoutPadding().encodeToString(text.toByteArray())
    return "${enc("""{"alg":"none"}""")}.${enc(claims)}.sig"
  }

  private val customerToken = jwt(
    """{"user_id":"cust-1","email":"c@example.test","name":"Cass","impersonatedBy":"staff-1","impersonatedByEmail":"ops@example.test"}""",
  )
  private val staffToken = jwt("""{"user_id":"staff-1","email":"ops@example.test","staff":true,"staffRole":"super"}""")

  /** The identity endpoints: password sign-in (the staff member), custom-token sign-in (the customer) and refresh. */
  private class Backend(val customerRefresh: HttpStatusCode = HttpStatusCode.OK) {
    val requests = mutableListOf<HttpRequestData>()
    val bodies = mutableListOf<String>()
  }

  private fun http(backend: Backend, customerToken: String, staffToken: String) = HttpClient(
    MockEngine { request ->
      backend.requests += request
      val body = String(request.body.toByteArray())
      backend.bodies += body
      val path = request.url.encodedPath
      when {
        path.endsWith("accounts:signInWithPassword") ->
          respond("""{"idToken":"$staffToken","refreshToken":"r-staff","expiresIn":"3600","localId":"staff-1","email":"ops@example.test"}""", HttpStatusCode.OK, json)
        path.endsWith("accounts:signInWithCustomToken") ->
          if ("bad" in body) respond("""{"error":{"message":"INVALID_CUSTOM_TOKEN"}}""", HttpStatusCode.BadRequest, json)
          else respond("""{"idToken":"$customerToken","refreshToken":"r-cust","expiresIn":"3600"}""", HttpStatusCode.OK, json)
        path.endsWith("/v1/token") ->
          if ("r-cust" in body) {
            if (backend.customerRefresh == HttpStatusCode.OK) {
              respond("""{"id_token":"$customerToken-2","refresh_token":"r-cust","expires_in":"3600","user_id":"cust-1"}""", HttpStatusCode.OK, json)
            } else {
              respond("""{"error":{"message":"TOKEN_EXPIRED"}}""", backend.customerRefresh, json)
            }
          } else {
            respond("""{"id_token":"$staffToken-2","refresh_token":"r-staff","expires_in":"3600","user_id":"staff-1"}""", HttpStatusCode.OK, json)
          }
        else -> respond("", HttpStatusCode.NotFound)
      }
    },
  )

  private suspend fun signedInStaff(backend: Backend = Backend(), store: InMemoryCredentialStore = InMemoryCredentialStore(), now: () -> Long = { 1_000_000L }): IdentityToolkitAuthSession {
    val session = IdentityToolkitAuthSession(http(backend, customerToken, staffToken), "key", null, now = now, credentials = store, credentialKey = "k")
    session.signInWithEmail("ops@example.test", "pw")
    return session
  }

  @Test
  fun aSupportSessionSignsInAsTheCustomerAndSetsTheStaffSessionAside() = runTest {
    val backend = Backend()
    val store = InMemoryCredentialStore()
    val session = signedInStaff(backend, store)
    session.beginImpersonation("custom-token", "tenant-9")

    // The custom token is exchanged in the pool it was minted in.
    val request = backend.requests.last { it.url.encodedPath.endsWith("accounts:signInWithCustomToken") }
    assertEquals("https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=key", request.url.toString())
    val body = Json.parseToJsonElement(backend.bodies.last { "custom-token" in it }) as JsonObject
    assertEquals("custom-token", body.getValue("token").jsonPrimitive.content)
    assertEquals("tenant-9", body.getValue("tenantId").jsonPrimitive.content)
    assertEquals("true", body.getValue("returnSecureToken").jsonPrimitive.content)

    // Everything the app asks now is the customer's: who is signed in, the token, the standing.
    val customer = AuthUser("cust-1", "c@example.test", "Cass")
    assertEquals(AuthState.SignedIn(customer), session.state.value)
    assertEquals(Impersonation(customer, "ops@example.test"), session.impersonation.value)
    val claims = TokenClaims.fromIdToken(session.idToken())
    assertEquals("staff-1", claims.impersonatedBy)
    assertEquals("ops@example.test", claims.impersonatedByEmail)
    assertFalse(claims.isStaff)
    assertEquals("You are impersonating c@example.test (staff: ops@example.test). Actions are audited.", session.impersonation.value?.banner)

    // The staff session was not touched: its refresh token is still the one kept.
    assertEquals("r-staff", store.read("k"))
  }

  @Test
  fun endingItReturnsToTheStaffSessionWithoutSigningInAgain() = runTest {
    val backend = Backend()
    val session = signedInStaff(backend)
    val signIns = { backend.requests.count { it.url.encodedPath.endsWith("accounts:signInWithPassword") } }
    session.beginImpersonation("custom-token", null)
    session.endImpersonation()

    assertEquals(AuthState.SignedIn(AuthUser("staff-1", "ops@example.test", null, emailVerified = false)), session.state.value)
    assertNull(session.impersonation.value)
    val claims = TokenClaims.fromIdToken(session.idToken())
    assertTrue(claims.isStaff)
    assertNull(claims.impersonatedBy)
    // No password, no second sign-in.
    assertEquals(1, signIns())
  }

  @Test
  fun aMissingTenantIsLeftOutOfTheExchange() = runTest {
    val backend = Backend()
    val session = signedInStaff(backend)
    session.beginImpersonation("custom-token", null)
    val body = Json.parseToJsonElement(backend.bodies.last { "custom-token" in it }) as JsonObject
    assertFalse("tenantId" in body)
  }

  @Test
  fun aRefusedTokenChangesNothing() = runTest {
    val session = signedInStaff()
    val failure = assertFailsWith<AuthError> { session.beginImpersonation("bad", null) }
    assertEquals("The support session was refused. Try again.", failure.message)
    assertEquals(AuthState.SignedIn(AuthUser("staff-1", "ops@example.test", null, emailVerified = false)), session.state.value)
    assertNull(session.impersonation.value)
  }

  @Test
  fun aSupportSessionTheServerRevokesEndsAndTheStaffSessionReturns() = runTest {
    // A minute past the customer token's expiry, the refresh is refused.
    var clock = 1_000_000L
    val session = signedInStaff(Backend(customerRefresh = HttpStatusCode.BadRequest), now = { clock })
    session.beginImpersonation("custom-token", null)
    clock += 3_600_000L
    assertNull(session.idToken())
    assertNull(session.impersonation.value)
    assertEquals(AuthState.SignedIn(AuthUser("staff-1", "ops@example.test", null, emailVerified = false)), session.state.value)
  }

  @Test
  fun signingOutFromASupportSessionSignsTheStaffMemberOutToo() = runTest {
    val store = InMemoryCredentialStore()
    val session = signedInStaff(store = store)
    session.beginImpersonation("custom-token", null)
    session.signOut()
    assertEquals(AuthState.SignedOut, session.state.value)
    assertNull(session.impersonation.value)
    assertNull(store.read("k"))
  }

  @Test
  fun aSecondSupportSessionReplacesTheFirstWithoutLosingTheStaffSession() = runTest {
    val backend = Backend()
    val session = signedInStaff(backend)
    session.beginImpersonation("one", null)
    session.beginImpersonation("two", null)
    session.endImpersonation()
    assertEquals(AuthState.SignedIn(AuthUser("staff-1", "ops@example.test", null, emailVerified = false)), session.state.value)
    assertEquals(1, backend.requests.count { it.url.encodedPath.endsWith("accounts:signInWithPassword") })
  }

  @Test
  fun aSessionWithNoBackendOpensNoSupportSession() = runTest {
    val sessions = SupportSessions(null)
    assertFailsWith<AuthError> { sessions.begin("t", null, AuthState.SignedOut) }
    assertNull(sessions.end())
    assertFalse(sessions.active)
    assertNotNull(sessions.impersonation)
  }

  /** The switch the Android SDK needs, since its Firestore is bound to the staff member's own sign-in. */
  @Test
  fun readsAndWritesGoThroughTheCustomersFirestoreWhileASupportSessionIsOn() = runTest {
    class Reader(val name: String) : FirestoreReader {
      override suspend fun get(path: String): FirestoreDoc? = FirestoreDoc(id = path.substringAfterLast("/"), path = "$name/$path", data = emptyMap())
      override suspend fun page(query: FirestoreQuery): FirestorePage = FirestorePage(emptyList(), null)
      override fun observeDoc(path: String) = kotlinx.coroutines.flow.flowOf<Live<FirestoreDoc?>>()
      override fun observe(query: FirestoreQuery) = kotlinx.coroutines.flow.flowOf<Live<List<FirestoreDoc>>>()
    }
    class Writer(val name: String, val log: MutableList<String>) : FirestoreWriter {
      override suspend fun merge(path: String, data: Map<String, Any?>) { log += "$name:$path" }
    }
    var supporting = false
    val log = mutableListOf<String>()
    val reader = SwitchingFirestoreReader(Reader("staff"), { Reader("customer") }) { supporting }
    val writer = SwitchingFirestoreWriter(Writer("staff", log), { Writer("customer", log) }) { supporting }
    assertEquals("staff/orgs/o1", reader.get("orgs/o1")?.path)
    writer.merge("orgs/o1", emptyMap())
    supporting = true
    assertEquals("customer/orgs/o1", reader.get("orgs/o1")?.path)
    writer.merge("orgs/o1", emptyMap())
    assertEquals(listOf("staff:orgs/o1", "customer:orgs/o1"), log)
  }
}
