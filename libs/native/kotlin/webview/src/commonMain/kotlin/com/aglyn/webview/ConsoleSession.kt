package com.aglyn.webview

import io.ktor.client.HttpClient
import io.ktor.client.request.header
import io.ktor.client.request.request
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpMethod
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * Signs the console view in the way the console signs a browser in: the ID
 * token is POSTed to `/api/auth/session`, which answers with the HttpOnly
 * `__session` cookie. The platform copies the returned cookies into its
 * web view's cookie store.
 */
sealed interface ConsoleSessionResult {
  data class Ok(val setCookies: List<String>) : ConsoleSessionResult
  data class Failed(val status: Int, val error: String) : ConsoleSessionResult
}

suspend fun mintConsoleSession(http: HttpClient, origin: String, idToken: String, brandName: String): ConsoleSessionResult {
  return try {
    val response = http.request("${origin.trimEnd('/')}/api/auth/session") {
      method = HttpMethod.Post
      header("Authorization", "Bearer $idToken")
      header("Accept", "application/json")
    }
    val status = response.status.value
    if (status in 200..299) return ConsoleSessionResult.Ok(response.headers.getAll("Set-Cookie") ?: emptyList())
    val body = runCatching { Json.parseToJsonElement(response.bodyAsText()) as? JsonObject }.getOrNull()
    val error = (body?.get("error") as? JsonPrimitive)?.contentOrNull
      ?: if (status == 403) "Verify your email address, then sign in again." else "The console session could not be started."
    ConsoleSessionResult.Failed(status, error)
  } catch (error: CancellationException) {
    throw error
  } catch (error: Throwable) {
    ConsoleSessionResult.Failed(0, "$brandName could not be reached. Check the connection.")
  }
}

suspend fun endConsoleSession(http: HttpClient, origin: String) {
  runCatching { http.request("${origin.trimEnd('/')}/api/auth/session") { method = HttpMethod.Delete } }
}
