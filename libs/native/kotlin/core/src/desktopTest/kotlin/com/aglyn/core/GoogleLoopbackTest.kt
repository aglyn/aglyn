package com.aglyn.core

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.runBlocking
import java.net.URI
import java.net.URLDecoder
import java.net.http.HttpClient as JavaHttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Google sign-in on the desktop: the browser is faked by a request to the loopback address, Google's token endpoint by a mock. */
class GoogleLoopbackTest {
  private val json = headersOf(HttpHeaders.ContentType, "application/json")

  private fun query(url: String): Map<String, String> =
    URI(url).rawQuery.split('&').associate { URLDecoder.decode(it.substringBefore('='), "UTF-8") to URLDecoder.decode(it.substringAfter('='), "UTF-8") }

  /** The browser: Google's page, then Google sending the person back to the app's loopback address with [reply]. */
  private fun browser(opened: MutableList<String>, reply: (Map<String, String>) -> String): (String) -> Unit = { url ->
    opened += url
    val params = query(url)
    val back = params.getValue("redirect_uri") + "/?" + reply(params)
    // The page is fetched off the caller's thread, as a real browser would.
    Thread { JavaHttpClient.newHttpClient().send(HttpRequest.newBuilder(URI(back)).build(), HttpResponse.BodyHandlers.discarding()) }.start()
  }

  private fun google(forms: MutableList<String> = mutableListOf(), status: HttpStatusCode = HttpStatusCode.OK, body: String = """{"id_token":"google-id-token"}""") =
    HttpClient(MockEngine { request ->
      forms += String(request.body.toByteArray())
      respond(body, status, json)
    })

  @Test
  fun theCodeGoogleReturnsToTheLoopbackIsTradedForItsIdToken() = runBlocking {
    val opened = mutableListOf<String>()
    val forms = mutableListOf<String>()
    val source = GoogleLoopback(google(forms), "desktop-client", "desktop-secret", browser(opened) { "code=the-code&state=${it.getValue("state")}" })
    assertEquals("google-id-token", source.idToken("dana@example.test"))
    val page = query(opened.single())
    assertEquals("desktop-client", page["client_id"])
    assertEquals("code", page["response_type"])
    assertEquals("openid email profile", page["scope"])
    assertEquals("S256", page["code_challenge_method"])
    assertEquals("dana@example.test", page["login_hint"])
    assertTrue(page.getValue("redirect_uri").startsWith("http://127.0.0.1:"))
    // The trade carries the verifier whose challenge the page was opened with, and the client's own credentials.
    val form = forms.single().split('&').associate { URLDecoder.decode(it.substringBefore('='), "UTF-8") to URLDecoder.decode(it.substringAfter('='), "UTF-8") }
    assertEquals("the-code", form["code"])
    assertEquals("authorization_code", form["grant_type"])
    assertEquals("desktop-secret", form["client_secret"])
    assertEquals(page["redirect_uri"], form["redirect_uri"])
    assertEquals(page["code_challenge"], GoogleLoopback.challenge(form.getValue("code_verifier")))
  }

  @Test
  fun aReturnThatIsNotOursOrNotGrantedIsRefusedInWords() = runBlocking {
    val forms = mutableListOf<String>()
    val wrongState = GoogleLoopback(google(forms), "c", "s", browser(mutableListOf()) { "code=x&state=not-ours" })
    assertEquals("The Google sign-in did not come back as expected. Try again.", assertFailsWith<GoogleLinkError> { wrongState.idToken(null) }.message)
    val denied = GoogleLoopback(google(forms), "c", "s", browser(mutableListOf()) { "error=access_denied" })
    assertEquals("Google sign-in was canceled.", assertFailsWith<GoogleLinkError> { denied.idToken(null) }.message)
    val refused = GoogleLoopback(google(forms), "c", "s", browser(mutableListOf()) { "error=server_error" })
    assertEquals("Google refused the sign-in (server_error).", assertFailsWith<GoogleLinkError> { refused.idToken(null) }.message)
    // Nothing was traded for a return that did not qualify.
    assertTrue(forms.isEmpty())
    // Google declining to trade the code, and a person who never comes back.
    val declined = GoogleLoopback(google(status = HttpStatusCode.BadRequest, body = """{"error":"invalid_grant"}"""), "c", "s", browser(mutableListOf()) { "code=x&state=${it.getValue("state")}" })
    assertEquals("Google did not hand back a sign-in. Try again.", assertFailsWith<GoogleLinkError> { declined.idToken(null) }.message)
    val absent = GoogleLoopback(google(), "c", "s", { }, timeoutMillis = 100)
    assertEquals("Google sign-in timed out. Try again.", assertFailsWith<GoogleLinkError> { absent.idToken(null) }.message)
  }

  @Test
  fun theLinkIsTheCallTheWebSdkEndsIn() {
    val body = GoogleLink.linkBody("firebase-token", "a b+c")
    assertEquals("firebase-token", (body["idToken"] as kotlinx.serialization.json.JsonPrimitive).content)
    assertEquals("id_token=a%20b%2Bc&providerId=google.com", (body["postBody"] as kotlinx.serialization.json.JsonPrimitive).content)
    assertEquals("That Google account is already linked to an Aglyn account.", GoogleLink.linkRefusal("EMAIL_EXISTS"))
    assertEquals("That Google account is already linked to an Aglyn account.", GoogleLink.linkRefusal("FEDERATED_USER_ID_ALREADY_LINKED : something"))
    assertEquals("Connecting Google failed.", GoogleLink.linkRefusal(null))
    assertNull(runCatching { GoogleLoopback.parseQuery("a=1&b").getValue("b") }.getOrNull())
  }
}
