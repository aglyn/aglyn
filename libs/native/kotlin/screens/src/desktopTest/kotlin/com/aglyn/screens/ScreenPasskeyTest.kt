package com.aglyn.screens

import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.TokenClaims
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Setting up a passkey from the account screen: the console's `registerPasskey`, with the platform's prompt replaced by a
 * fake that returns what a device would. Apple replays the same cases (ScreenPasskeyTests).
 */
class ScreenPasskeyTest {
  private val root: File = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "libs/native/screens").isDirectory }

  private fun json(text: String): JsonElement = Json.parseToJsonElement(text)

  private fun client(vararg responses: Pair<Int, String>, sent: MutableList<HttpRequestData>): ConsoleApiClient {
    val queue = ArrayDeque(responses.toList())
    val engine = MockEngine { request ->
      sent += request
      val (status, body) = queue.removeFirstOrNull() ?: (200 to "{}")
      respond(body, HttpStatusCode.fromValue(status), headersOf("Content-Type", "application/json"))
    }
    return ConsoleApiClient("http://localhost", HttpClient(engine) { expectSuccess = false }, { "t" }, sleep = {})
  }

  private val spec get() = ScreenSpec.parseFile(File(root, "libs/native/screens/account.screens.json").readText()).first { it.id == "core.account.security" }

  private val action: ActionSpec
    get() {
      val block = spec.blocks.first { it.type == "actions" && it.string("when") == "user.canAddPasskey" }
      return ActionSpec.parse((block.raw as JsonObject).getValue("items").let { (it as kotlinx.serialization.json.JsonArray).first() })!!
    }

  private val scope = json("""{"app":{"passkeyRp":"aglyn.com"},"user":{"uid":"u1"}}""")

  /** A registration whose client data names the origin the platform signed. */
  private fun registration(origin: String): JsonElement {
    val client = """{"type":"webauthn.create","origin":"$origin"}""".encodeToByteArray()
    return json("""{"id":"AQID","rawId":"AQID","type":"public-key","response":{"clientDataJSON":"${ScreenPasskeys.base64Url(client)}","attestationObject":"o2M"}}""")
  }

  private fun body(sent: List<HttpRequestData>, at: Int) = json((sent[at].body as TextContent).text) as JsonObject

  @Test
  fun theEncodingsAndTheSignedOriginAreRead() {
    assertEquals("-__-", ScreenPasskeys.base64Url(byteArrayOf(0xfb.toByte(), 0xff.toByte(), 0xfe.toByte())))
    assertEquals(listOf(0xfb, 0xff, 0xfe), ScreenPasskeys.bytes("-__-")!!.map { it.toInt() and 0xff })
    assertEquals("challenge", ScreenPasskeys.bytes("Y2hhbGxlbmdl")!!.decodeToString())
    assertEquals("https://aglyn.com", ScreenPasskeys.clientDataOrigin(registration("https://aglyn.com")))
    assertEquals("android:apk-key-hash:abc", ScreenPasskeys.clientDataOrigin(registration("android:apk-key-hash:abc")))
    assertNull(ScreenPasskeys.clientDataOrigin(json("""{"response":{"clientDataJSON":"not json"}}""")))
  }

  @Test
  fun settingUpAPasskeySendsEachRouteTheOriginItChecks() = runTest {
    val sent = mutableListOf<HttpRequestData>()
    val api = client(
      200 to """{"challengeId":"c1","options":{"challenge":"x"}}""", 200 to """{"ok":true,"credentialId":"AQID","label":"Passkey"}""",
      sent = sent,
    )
    val model = ScreenModel(spec, JsonObject(emptyMap()), api)
    var received: JsonElement? = null
    model.createPasskey = PasskeyCreator { options ->
      received = options
      registration("https://aglyn.com")
    }
    val outcome = model.run(action, scope)
    assertEquals(ActionOutcome.Done("Passkey \"Passkey\" added", json("""{"ok":true,"credentialId":"AQID","label":"Passkey"}""")), outcome)
    assertEquals(json("""{"challenge":"x"}"""), received)
    assertEquals(2, sent.size)
    assertEquals("/api/auth/passkeys/register/options", sent[0].url.encodedPath)
    assertEquals("https://aglyn.com", sent[0].headers["Origin"])
    assertEquals("/api/auth/passkeys/register/verify", sent[1].url.encodedPath)
    assertEquals("https://aglyn.com", sent[1].headers["Origin"])
    val verify = body(sent, 1)
    assertEquals(JsonPrimitive("c1"), verify["challengeId"])
    assertEquals(JsonPrimitive("AQID"), (verify["response"] as JsonObject)["id"])
    assertNull(verify["label"])

    // An Android credential is verified against the origin the platform signed, not the web one.
    val androidSent = mutableListOf<HttpRequestData>()
    val other = ScreenModel(spec, JsonObject(emptyMap()), client(200 to """{"challengeId":"c2","options":{}}""", 200 to """{"ok":true,"label":"Pixel"}""", sent = androidSent))
    other.createPasskey = PasskeyCreator { registration("android:apk-key-hash:abc") }
    other.run(action, scope)
    assertEquals("https://aglyn.com", androidSent[0].headers["Origin"])
    assertEquals("android:apk-key-hash:abc", androidSent[1].headers["Origin"])
  }

  @Test
  fun closingThePromptIsQuietAndTheRoutesReasonsAreSaidInTheConsolesWords() = runTest {
    // The person closes the system prompt: nothing is verified, nothing is said.
    val cancelledSent = mutableListOf<HttpRequestData>()
    val model = ScreenModel(spec, JsonObject(emptyMap()), client(200 to """{"challengeId":"c1","options":{}}""", sent = cancelledSent))
    model.createPasskey = PasskeyCreator { throw PasskeyCancelled() }
    assertEquals(ActionOutcome.Done(null, null), model.run(action, scope))
    assertEquals(1, cancelledSent.size)
    // Ten passkeys is the most an account holds.
    val limited = ScreenModel(spec, JsonObject(emptyMap()), client(400 to """{"error":"limit-reached"}""", sent = mutableListOf()))
    limited.createPasskey = PasskeyCreator { error("no ceremony once the server refused") }
    assertEquals(ActionOutcome.Failed("Passkey limit reached — remove one first."), limited.run(action, scope))
    // Anything else, including the verify route refusing what the device made.
    val failing = ScreenModel(
      spec, JsonObject(emptyMap()),
      client(200 to """{"challengeId":"c1","options":{}}""", 400 to """{"error":"verification-failed"}""", sent = mutableListOf()),
    )
    failing.createPasskey = PasskeyCreator { registration("https://aglyn.com") }
    assertEquals(ActionOutcome.Failed("Adding the passkey failed. Try again."), failing.run(action, scope))
    // A device that cannot make one says so.
    val bare = ScreenModel(spec, JsonObject(emptyMap()), client(sent = mutableListOf()))
    assertEquals(ActionOutcome.Failed("Passkeys are not available on this device."), bare.run(action, scope))
  }

  @Test
  fun thePasskeyIsOfferedOnlyWhereThisBuildCanMakeOne() {
    fun canAdd(session: ScreenSession) = (session.context(null, emptyMap()) as JsonObject).let { ((it["user"] as JsonObject)["canAddPasskey"] as JsonPrimitive).content }
    val verified = TokenClaims(JsonObject(mapOf("email_verified" to JsonPrimitive(true))))
    assertEquals("true", canAdd(ScreenSession(claims = verified, passkeyRelyingParty = "aglyn.com")))
    assertEquals("false", canAdd(ScreenSession(claims = verified)))  // not configured for this build
    assertEquals("false", canAdd(ScreenSession(claims = TokenClaims(JsonObject(emptyMap())), passkeyRelyingParty = "aglyn.com")))  // email unverified
    val company = TokenClaims(json("""{"email_verified":true,"firebase":{"tenant":"acme"}}""") as JsonObject)
    assertEquals("false", canAdd(ScreenSession(claims = company, passkeyRelyingParty = "aglyn.com")))  // a company login
    assertTrue(canAdd(ScreenSession(claims = verified, passkeyRelyingParty = "aglyn.com")).toBoolean())
    assertFalse(canAdd(ScreenSession()).toBoolean())
  }

  @Test
  fun signingInWithAPasskeyAsksTheRoutesWithoutASessionAndReturnsTheCustomToken() = runTest {
    val sent = mutableListOf<HttpRequestData>()
    val api = client(200 to """{"challengeId":"c9","options":{"rpId":"aglyn.com","challenge":"Y2hhbGxlbmdl"}}""", 200 to """{"token":"custom-1"}""", sent = sent)
    val signed = registration("android:apk-key-hash:AbC")
    var offered: JsonElement? = null
    val token = PasskeySignIn.token(api, "aglyn.com") { options -> offered = options; signed }
    assertEquals("custom-1", token)
    assertEquals(JsonPrimitive("Y2hhbGxlbmdl"), (offered as JsonObject)["challenge"])
    assertEquals(listOf("/api/auth/passkeys/signin/options", "/api/auth/passkeys/signin/verify"), sent.map { it.url.encodedPath })
    // Nobody is signed in yet: neither request carries a token, and the routes read the ceremony's origin.
    assertNull(sent[0].headers["Authorization"])
    assertNull(sent[1].headers["Authorization"])
    assertEquals("https://aglyn.com", sent[0].headers["Origin"])
    assertEquals("android:apk-key-hash:AbC", sent[1].headers["Origin"])
    assertEquals(JsonPrimitive("c9"), body(sent, 1)["challengeId"])
    assertEquals(signed, body(sent, 1)["response"])
  }

  @Test
  fun aFailedPasskeySignInSaysWhatTheConsoleSays() = runTest {
    assertEquals("No passkey was used to sign in.", PasskeySignIn.message(PasskeyCancelled()))
    val refused = client(200 to """{"challengeId":"c9","options":{}}""", 401 to """{"error":"passkey-signin-failed"}""", sent = mutableListOf())
    val error = runCatching { PasskeySignIn.token(refused, "aglyn.com") { registration("https://aglyn.com") } }.exceptionOrNull()!!
    assertTrue(PasskeySignIn.failed(error))
    assertEquals(
      "That passkey could not be used to sign in. Try another sign-in method, then re-add the passkey from Manage account → Security.",
      PasskeySignIn.message(error),
    )
    for ((reason, words) in listOf(
      "rate-limited" to "Too many passkey attempts from this network. Wait a few minutes and try again.",
      "bad-origin" to "Passkey sign-in is not available on this address.",
      "something-else" to "Passkey sign-in failed.",
    )) {
      assertEquals(words, PasskeySignIn.message(com.aglyn.core.ConsoleApiError(reason, 400, json("""{"error":"$reason"}"""))))
    }
    // A closed prompt asks nothing further.
    val sent = mutableListOf<HttpRequestData>()
    val closed = runCatching { PasskeySignIn.token(client(200 to """{"challengeId":"c9","options":{}}""", sent = sent), "aglyn.com") { throw PasskeyCancelled() } }.exceptionOrNull()
    assertTrue(closed is PasskeyCancelled)
    assertEquals(1, sent.size)
    assertFalse(PasskeySignIn.failed(com.aglyn.core.AuthError("Could not sign in.")))
  }
}
