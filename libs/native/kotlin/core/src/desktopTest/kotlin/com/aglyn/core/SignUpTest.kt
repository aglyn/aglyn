package com.aglyn.core

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The sign-up door's console routes and account writes, as the console's sign-up page makes them. Twin of the Apple `SignUpTests`. */
class SignUpTest {
  private val json = headersOf(HttpHeaders.ContentType, "application/json")

  private class Call(val path: String, val body: String, val bearer: String?)

  private class RecordingWriter : FirestoreWriter {
    val merges = mutableListOf<Pair<String, Map<String, Any?>>>()
    override suspend fun merge(path: String, data: Map<String, Any?>) {
      merges += path to data
    }
  }

  private class OneDoc(private val doc: FirestoreDoc?) : FirestoreReader {
    override suspend fun get(path: String) = doc?.takeIf { it.path == path }
    override suspend fun page(query: FirestoreQuery) = FirestorePage(emptyList(), null)
    override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = emptyFlow()
    override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = emptyFlow()
  }

  private fun service(
    answers: MutableList<Pair<HttpStatusCode, String>>,
    calls: MutableList<Call>,
    writer: FirestoreWriter = RecordingWriter(),
    reader: FirestoreReader = OneDoc(null),
  ): SignUpService {
    val http = HttpClient(MockEngine { request ->
      calls += Call(request.url.encodedPath, String(request.body.toByteArray()), request.headers["Authorization"])
      val (status, body) = if (answers.isEmpty()) HttpStatusCode.OK to "{}" else answers.removeAt(0)
      respond(body, status, json)
    })
    val api = ConsoleApiClient("https://console.test", http, { "tok" }, sleep = {}, maxAttempts = 3)
    return SignUpService(api, writer, reader, now = { 1_800_000_000_000 }, writesDeadlineMs = 1_000)
  }

  @Test
  fun theLinksPlanIsReadAsTheConsoleReadsIt() {
    assertEquals(OnboardingPlanIntent("pro", "year", true, false), OnboardingPlanIntent.parse(mapOf("plan" to "Pro", "interval" to "annual")))
    assertEquals(OnboardingPlanIntent("business", "month", false, false), OnboardingPlanIntent.parse(mapOf("plan" to "business")))
    assertTrue(OnboardingPlanIntent.parse(mapOf("plan" to "enterprise", "ai" to "1"))!!.contactSales)
    assertFalse(OnboardingPlanIntent.parse(mapOf("plan" to "enterprise", "ai" to "1"))!!.ai)
    assertNull(OnboardingPlanIntent.parse(mapOf("plan" to "free")))
    assertNull(OnboardingPlanIntent.parse(emptyMap()))
    val pro = OnboardingPlanIntent.parse(mapOf("plan" to "pro", "interval" to "year", "ai" to "yes"))!!
    assertEquals("plan=pro&interval=year&ai=1", pro.query)
    assertEquals("/acme/billing?plan=pro&interval=year&ai=1", pro.destination("acme"))
    assertEquals("Create your account to start on Pro, billed yearly", pro.signUpHeadline)
    assertEquals("/acme/support?topic=enterprise", OnboardingPlanIntent.parse(mapOf("plan" to "enterprise"))!!.destination("acme"))
    assertEquals("plan=scale", OnboardingPlanIntent.parse(mapOf("plan" to "scale"))!!.query)
  }

  @Test
  fun onlyTheThreeCampaignKeysAreKeptAndNeverAnAddress() {
    val campaign = UtmAttribution.parse(mapOf("utm_source" to " google ", "utm_medium" to "cpc", "utm_campaign" to "sept launch", "utm_term" to "x"))
    assertEquals(UtmAttribution("google", "cpc", "sept launch"), campaign)
    assertEquals("utm_source=google&utm_medium=cpc&utm_campaign=sept+launch", campaign!!.query)
    assertNull(UtmAttribution.parse(mapOf("utm_source" to "someone@example.com")))
    assertEquals(100, UtmAttribution.parse(mapOf("utm_source" to "a".repeat(150)))!!.source!!.length)
    assertEquals(mapOf("plan" to "pro", "utm_campaign" to "a b"), queryParams("plan=pro&utm_campaign=a+b"))
  }

  @Test
  fun theWorkspaceNameMustBecomeAnAddress() {
    assertEquals("acme-inc", WorkspaceName.slug("Acme, Inc."))
    assertEquals("cafe-delice", WorkspaceName.slug("Café Délice"))
    assertEquals("", WorkspaceName.slug("admin"))
    assertEquals("", WorkspaceName.slug("Workspace"))
    assertEquals("", WorkspaceName.slug("ab"))
    assertEquals("", WorkspaceName.slug("🎉🎉"))
    assertEquals("", WorkspaceName.slug("Shitake Mushrooms"))
    assertNull(SignUpRules.organization("Juniper Street Bakery"))
    assertEquals(WorkspaceName.REFUSAL, SignUpRules.organization("admin"))
    assertEquals("Provide your organization/company name", SignUpRules.organization(" "))
  }

  @Test
  fun thePasswordRulesAnswerInTheFormsOrder() {
    assertEquals("Password is required", SignUpRules.password(""))
    assertEquals("Must contain at least 1 lowercase letter", SignUpRules.password("PASSWORD1!"))
    assertEquals("Must contain at least 1 uppercase letter", SignUpRules.password("password1!"))
    assertEquals("Must contain at least 1 number", SignUpRules.password("Password!"))
    assertEquals("Must contain a special character [/!@$]", SignUpRules.password("Password1"))
    assertEquals("Password can not have spaces", SignUpRules.password("Pass word1!"))
    assertEquals("Length must between 6–30 characters", SignUpRules.password("Pa1!"))
    assertNull(SignUpRules.password("Passw0rd!"))
    assertEquals("Those passwords didn't match. Try again.", SignUpRules.confirm("x", "y"))
    assertEquals("Please enter a longer first name", SignUpRules.firstName("A"))
    assertEquals("Enter a valid email (name@domain.com)", SignUpRules.email("nope"))
  }

  @Test
  fun theAcceptanceAttributionAndOptInGoThroughTheConsolesRoutes() = runTest {
    val calls = mutableListOf<Call>()
    val signUp = service(mutableListOf(), calls)
    assertTrue(signUp.recordAcceptance(SignUpDoor.PASSWORD))
    signUp.recordAcquisition(SignUpDoor.GOOGLE.acquisitionDoor)
    assertTrue(signUp.recordMarketingOptIn())
    assertEquals(listOf("/api/auth/legal-acceptance", "/api/auth/acquisition", "/api/auth/marketing-consent"), calls.map { it.path })
    assertEquals("Bearer tok", calls[0].bearer)
    // The server stamps the version it publishes: the app names only the door.
    assertEquals(Json.parseToJsonElement("""{"context":"signup-password"}"""), Json.parseToJsonElement(calls[0].body))
    assertEquals(Json.parseToJsonElement("""{"door":"signup-google"}"""), Json.parseToJsonElement(calls[1].body))
    assertEquals(
      Json.parseToJsonElement("""{"decision":"granted","source":"console-signup","textVersion":"2026-09-20"}"""),
      Json.parseToJsonElement(calls[2].body),
    )
  }

  @Test
  fun aRefusedAcceptanceIsReportedNotThrown() = runTest {
    val signUp = service(mutableListOf(HttpStatusCode.Conflict to """{"reason":"version-mismatch"}"""), mutableListOf())
    assertFalse(signUp.recordAcceptance(SignUpDoor.GOOGLE))
  }

  @Test
  fun thePlanCampaignNameAndHeldWorkspaceAreKeptOnTheAccount() = runTest {
    val writer = RecordingWriter()
    val signUp = service(mutableListOf(), mutableListOf(), writer)
    signUp.remember("u1", OnboardingPlanIntent.parse(mapOf("plan" to "pro")), UtmAttribution("google"), " Ada ", "Lovelace")
    signUp.holdWorkspace("u1", PendingSignUpWorkspace("  Acme  ", nameWasTyped = true))
    assertTrue(writer.merges.all { it.first == "users/u1" })
    val merged = writer.merges.fold(emptyMap<String, Any?>()) { all, merge -> all + merge.second }
    assertEquals(mapOf("query" to "plan=pro", "createdAtMs" to 1_800_000_000_000L), merged["onboardingPlanIntent"])
    assertEquals(mapOf("query" to "utm_source=google", "createdAtMs" to 1_800_000_000_000L), merged["signupCampaign"])
    assertEquals("Ada", merged["firstName"])
    assertEquals(
      mapOf("name" to "Acme", "nameWasTyped" to true, "provider" to "password", "createdAtMs" to 1_800_000_000_000L),
      merged[SignUpService.FIELD],
    )
  }

  /** The held name is honoured once, inside its window, and only while the account still holds the provider that wrote it. */
  @Test
  fun aHeldNameIsClaimedOnceAndVoidAfterATakeover() = runTest {
    val held = mapOf("name" to "Acme", "nameWasTyped" to true, "provider" to "password", "createdAtMs" to 1_800_000_000_000L - 1000)
    val writer = RecordingWriter()
    val signUp = service(mutableListOf(), mutableListOf(), writer, OneDoc(FirestoreDoc("u1", "users/u1", mapOf(SignUpService.FIELD to held))))
    assertEquals(PendingSignUpWorkspace("Acme", true), signUp.claimHeldWorkspace("u1", listOf("firebase", "password")))
    assertEquals(listOf<Pair<String, Map<String, Any?>>>("users/u1" to mapOf(SignUpService.FIELD to null)), writer.merges.toList())
    assertNull(SignUpService.honour(held, listOf("google.com"), 1_800_000_000_000L))
    assertNull(SignUpService.honour(held, listOf("password"), 1_800_000_000_000L + SignUpService.MAX_AGE_MS + 1))
  }

  @Test
  fun theWorkspaceIsCreatedAndARefusalSaysWhy() = runTest {
    val calls = mutableListOf<Call>()
    val signUp = service(
      mutableListOf(HttpStatusCode.OK to """{"orgId":"o1","slug":"acme"}""", HttpStatusCode.Conflict to """{"error":"That workspace URL is taken"}"""),
      calls,
    )
    assertEquals(SignUpWorkspaceOutcome("acme", "o1", null), signUp.createWorkspace(" Acme "))
    assertEquals(Json.parseToJsonElement("""{"name":"Acme"}"""), Json.parseToJsonElement(calls[0].body))
    assertEquals(SignUpWorkspaceOutcome(null, null, "That workspace URL is taken"), signUp.createWorkspace("Acme"))
  }

  @Test
  fun theVerificationSendReadsEachAnswer() = runTest {
    val calls = mutableListOf<Call>()
    val signUp = service(
      mutableListOf(
        HttpStatusCode.OK to """{"ok":true}""", HttpStatusCode.OK to """{"ok":true,"alreadyVerified":true}""",
        HttpStatusCode.TooManyRequests to "{}", HttpStatusCode.BadGateway to """{"error":"Sending the email failed"}""",
      ),
      calls,
    )
    assertEquals(VerificationSend.Sent, signUp.sendVerification(true))
    assertEquals(Json.parseToJsonElement("""{"auto":true}"""), Json.parseToJsonElement(calls[0].body))
    assertEquals(VerificationSend.AlreadyVerified, signUp.sendVerification(false))
    assertEquals(VerificationSend.Failed("Too many requests — wait a moment before requesting another link."), signUp.sendVerification(false))
    assertEquals(VerificationSend.Failed("Sending the email failed"), signUp.sendVerification(false))
  }

  @Test
  fun thePasswordResetIsTheConsolesOwnEmailAndTheLockdownIsRead() = runTest {
    val calls = mutableListOf<Call>()
    val signUp = service(mutableListOf(HttpStatusCode.OK to "{}", HttpStatusCode.OK to """{"locked":true,"message":"Back at noon."}"""), calls)
    signUp.sendPasswordReset(" a@example.test ")
    assertEquals("/api/auth/send-password-reset", calls[0].path)
    assertNull(calls[0].bearer)
    assertEquals(Json.parseToJsonElement("""{"email":"a@example.test"}"""), Json.parseToJsonElement(calls[0].body))
    assertEquals("Back at noon.", signUp.signupsPaused())
  }

  @Test
  fun failuresReadInTheConsolesWords() {
    assertEquals("Account with email already exists. Sign in instead.", signUpErrorMessage("ERROR_EMAIL_ALREADY_IN_USE"))
    assertEquals("Account with email already exists. Sign in instead.", signUpErrorMessage("EMAIL_EXISTS"))
    assertEquals("Password is too weak. Enter a stronger password and try again.", signUpErrorMessage("WEAK_PASSWORD : Password should be at least 6 characters"))
    assertTrue(signUpErrorMessage("BLOCKING_FUNCTION_ERROR_RESPONSE").startsWith("Something went wrong on our end — no account was created"))
    assertEquals(APP_CHECK_REFUSAL_MESSAGE, signUpErrorMessage(APP_CHECK_REFUSED))
    assertTrue(isCredentialRefusal("ERROR_INVALID_CREDENTIAL"))
    assertFalse(isCredentialRefusal("TOO_MANY_ATTEMPTS_TRY_LATER"))
    assertEquals("Grace Hopper", derivedWorkspaceName(" Grace Hopper ", "g@example.test"))
    assertEquals("grace", derivedWorkspaceName(null, "grace@example.test"))
  }

  @OptIn(ExperimentalEncodingApi::class)
  private fun jwt(claims: String) = "h." + Base64.UrlSafe.withPadding(Base64.PaddingOption.ABSENT).encode(claims.encodeToByteArray()) + ".s"

  /** The desktop REST session signs up with `accounts:signUp`, unverified on arrival, and redeems the emailed codes. */
  @Test
  fun theDesktopSessionSignsUpAndRedeemsTheEmailedCodes() = runTest {
    val calls = mutableListOf<Pair<String, JsonObject>>()
    val unverified = jwt("""{"user_id":"u9","email_verified":false}""")
    val verified = jwt("""{"user_id":"u9","email_verified":true}""")
    val http = HttpClient(MockEngine { request ->
      val path = request.url.encodedPath.substringAfterLast('/')
      val body = runCatching { Json.parseToJsonElement(String(request.body.toByteArray())) as JsonObject }.getOrDefault(JsonObject(emptyMap()))
      calls += path to body
      when (path) {
        "accounts:signUp" ->
          respond("""{"idToken":"$unverified","refreshToken":"good-9","expiresIn":"3600","localId":"u9","email":"new@example.test"}""", HttpStatusCode.OK, json)
        "token" -> respond("""{"id_token":"$verified","refresh_token":"good-10","expires_in":"3600","user_id":"u9"}""", HttpStatusCode.OK, json)
        "accounts:lookup" ->
          respond("""{"users":[{"localId":"u9","email":"new@example.test","emailVerified":true,"providerUserInfo":[{"providerId":"password"}]}]}""", HttpStatusCode.OK, json)
        "accounts:resetPassword" ->
          if ("bad" in body.toString()) {
            respond("""{"error":{"message":"INVALID_OOB_CODE"}}""", HttpStatusCode.BadRequest, json)
          } else {
            respond("""{"email":"new@example.test"}""", HttpStatusCode.OK, json)
          }
        else -> respond("{}", HttpStatusCode.OK, json)
      }
    })
    val session = IdentityToolkitAuthSession(http, "key", "127.0.0.1:9299", credentials = InMemoryCredentialStore(), credentialKey = "k")
    val created = session.signUpWithEmail(" new@example.test ", "Pw1!pw")
    assertEquals(AuthUser("u9", "new@example.test", null, emailVerified = false), created)
    assertEquals("new@example.test", (calls[0].second["email"] as kotlinx.serialization.json.JsonPrimitive).content)
    session.applyActionCode("v-code")
    assertEquals(AuthState.SignedIn(AuthUser("u9", "new@example.test", null, emailVerified = true)), session.state.value)
    assertEquals(listOf("password"), session.providerIds())
    assertEquals("new@example.test", session.verifyPasswordResetCode("r-code"))
    session.confirmPasswordReset("r-code", "New1!pw")
    val refused = runCatching { session.verifyPasswordResetCode("bad") }.exceptionOrNull()
    assertIs<AuthError>(refused)
    assertEquals("INVALID_OOB_CODE", refused.code)
    assertEquals("This link is invalid or has already been used. Request a new password reset link.", refused.message)
  }

  /** Google's credential signs in through `accounts:signInWithIdp`, which says whether it signed somebody up. */
  @Test
  fun aGoogleCredentialSignsInAndSaysWhetherItWasNew() = runTest {
    val posted = mutableListOf<String>()
    val token = jwt("""{"user_id":"g1","email_verified":true}""")
    val http = HttpClient(MockEngine { request ->
      posted += String(request.body.toByteArray())
      respond(
        """{"idToken":"$token","refreshToken":"good-g","expiresIn":"3600","localId":"g1","email":"g@example.test","displayName":"Grace","isNewUser":true}""",
        HttpStatusCode.OK, json,
      )
    })
    val session = IdentityToolkitAuthSession(http, "key", "127.0.0.1:9299", credentials = InMemoryCredentialStore(), credentialKey = "k")
    assertTrue(session.signInWithGoogle("google-id"))
    assertEquals(AuthState.SignedIn(AuthUser("g1", "g@example.test", "Grace", emailVerified = true)), session.state.value)
    val body = Json.parseToJsonElement(posted[0]) as JsonObject
    assertEquals("id_token=google-id&providerId=google.com", (body["postBody"] as kotlinx.serialization.json.JsonPrimitive).content)
  }
}
