package com.aglyn.core

import com.sun.net.httpserver.HttpServer
import io.ktor.client.HttpClient
import io.ktor.client.request.forms.FormDataContent
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.Parameters
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.URLDecoder
import java.net.URLEncoder
import java.security.MessageDigest
import java.util.Base64

/**
 * Google sign-in on the desktop without a web view of ours (Google refuses embedded sign-in), the way Google documents
 * it for installed apps (RFC 8252): the system browser opens Google's page with a PKCE challenge, Google returns to a
 * listener on the loopback address, and the code it carries is traded for Google's ID token with the app's desktop OAuth
 * client. The ID token is what [AuthSession.linkGoogle] attaches to the account.
 *
 * A desktop OAuth client's secret is not confidential (Google says so for installed apps), but it is still required by
 * the token endpoint, so it is configuration, not code.
 */
class GoogleLoopback(
  private val http: HttpClient,
  private val clientId: String,
  private val clientSecret: String,
  /** Opens a URL in the system browser. */
  private val openBrowser: (String) -> Unit,
  private val timeoutMillis: Long = 5 * 60 * 1000,
  private val authorizationEndpoint: String = "https://accounts.google.com/o/oauth2/v2/auth",
  private val tokenEndpoint: String = "https://oauth2.googleapis.com/token",
) : GoogleCredentialSource {
  /** What came back to the listener. */
  private class Redirect(val code: String?, val state: String?, val error: String?)

  override suspend fun idToken(loginHint: String?): String {
    val verifier = randomUrlSafe(32)
    val state = randomUrlSafe(16)
    val result = CompletableDeferred<Redirect>()
    val server = HttpServer.create(InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0)
    server.createContext("/") { exchange ->
      val query = parseQuery(exchange.requestURI.rawQuery.orEmpty())
      val body = PAGE.toByteArray()
      exchange.responseHeaders.add("Content-Type", "text/html; charset=utf-8")
      exchange.sendResponseHeaders(200, body.size.toLong())
      exchange.responseBody.use { it.write(body) }
      // A browser also asks for the favicon; only the return that carries a code or an error counts.
      if ("code" in query || "error" in query) result.complete(Redirect(query["code"], query["state"], query["error"]))
    }
    server.start()
    try {
      val redirectUri = "http://127.0.0.1:${server.address.port}"
      openBrowser(authorizationUrl(redirectUri, challenge(verifier), state, loginHint))
      val back = try {
        withTimeout(timeoutMillis) { result.await() }
      } catch (error: TimeoutCancellationException) {
        throw GoogleLinkError("Google sign-in timed out. Try again.", error)
      }
      back.error?.let { throw GoogleLinkError(if (it == "access_denied") "Google sign-in was canceled." else "Google refused the sign-in ($it).") }
      val code = back.code?.takeIf { back.state == state && it.isNotEmpty() }
        ?: throw GoogleLinkError("The Google sign-in did not come back as expected. Try again.")
      return exchange(code, verifier, redirectUri)
    } finally {
      server.stop(0)
    }
  }

  internal fun authorizationUrl(redirectUri: String, challenge: String, state: String, loginHint: String?): String {
    val parts = buildList {
      add("client_id" to clientId)
      add("redirect_uri" to redirectUri)
      add("response_type" to "code")
      add("scope" to "openid email profile")
      add("code_challenge" to challenge)
      add("code_challenge_method" to "S256")
      add("state" to state)
      add("prompt" to "select_account")
      if (!loginHint.isNullOrBlank()) add("login_hint" to loginHint)
    }
    return authorizationEndpoint + "?" + parts.joinToString("&") { (name, value) -> "$name=${URLEncoder.encode(value, "UTF-8")}" }
  }

  private suspend fun exchange(code: String, verifier: String, redirectUri: String): String {
    val response = try {
      withContext(Dispatchers.IO) {
        http.post(tokenEndpoint) {
          setBody(
            FormDataContent(
              Parameters.build {
                append("client_id", clientId)
                append("client_secret", clientSecret)
                append("code", code)
                append("code_verifier", verifier)
                append("grant_type", "authorization_code")
                append("redirect_uri", redirectUri)
              },
            ),
          )
        }
      }
    } catch (error: Exception) {
      throw GoogleLinkError("Google did not hand back a sign-in. Try again.", error)
    }
    val token = runCatching { Json.parseToJsonElement(response.bodyAsText()).jsonObject["id_token"]?.jsonPrimitive?.content }.getOrNull()
    if (response.status.value !in 200..299 || token.isNullOrEmpty()) throw GoogleLinkError("Google did not hand back a sign-in. Try again.")
    return token
  }

  internal companion object {
    private const val PAGE = "<!doctype html><meta charset=utf-8><title>Signed in</title>" +
      "<body style=\"font-family:system-ui;margin:3rem\"><h1>You can close this window</h1><p>Return to the app to finish.</p>"

    fun challenge(verifier: String): String =
      Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()))

    fun randomUrlSafe(bytes: Int): String =
      Base64.getUrlEncoder().withoutPadding().encodeToString(secureRandomBytes(bytes))

    fun parseQuery(raw: String): Map<String, String> = raw.split('&').filter { it.contains('=') }.associate {
      URLDecoder.decode(it.substringBefore('='), "UTF-8") to URLDecoder.decode(it.substringAfter('='), "UTF-8")
    }
  }
}
