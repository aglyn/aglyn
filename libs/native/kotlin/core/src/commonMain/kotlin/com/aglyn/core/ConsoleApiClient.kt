package com.aglyn.core

import io.ktor.client.HttpClient
import io.ktor.client.request.header
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.client.statement.readRawBytes
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLParameter
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlin.math.max

/**
 * The console API client. A native app calls the same console API routes the
 * console itself calls, with the same credential: a Firebase ID token as a
 * bearer. There is no app-only route and no privileged path; a route refuses
 * the app exactly when it would refuse the console.
 *
 * Retries: a GET (and any call that carries an `Idempotency-Key`) is retried
 * on a network error or a 502/503/504, with 400·2ⁿ ms backoff. A 4xx is an
 * answer and is never retried. A 401 earns one forced token refresh.
 */
class ConsoleApiError(
  override val message: String,
  val status: Int,
  val body: JsonElement?,
) : Exception(message)

enum class ApiMethod { GET, POST, PUT, PATCH, DELETE }

/** A file a route answered with: its name (from `Content-Disposition`), type, bytes and headers. */
class DownloadedFile(val name: String?, val contentType: String, val bytes: ByteArray, val headers: io.ktor.http.Headers)

class ConsoleApiClient(
  origin: String,
  private val http: HttpClient,
  /** The signed-in user's current ID token; null when signed out. */
  private val getIdToken: suspend (forceRefresh: Boolean) -> String?,
  private val brandName: String = AglynConfig.DEFAULT_BRAND_NAME,
  private val sleep: suspend (Long) -> Unit = { delay(it) },
  maxAttempts: Int = 3,
) {
  val origin: String = origin.trimEnd('/')
  private val maxAttempts = max(1, maxAttempts)

  fun urlFor(path: String, query: Map<String, Any?> = emptyMap()): String {
    require(path.startsWith("/") && !path.startsWith("//")) {
      "A console API path starts with one \"/\": $path"
    }
    val params = query.filterValues { it != null }.map { (key, value) ->
      "${key.encodeURLParameter()}=${value.toString().encodeURLParameter()}"
    }
    return origin + path + if (params.isEmpty()) "" else "?" + params.joinToString("&")
  }

  /**
   * The signed-in member's ID token claims (its payload, decoded; never
   * verified here, since the routes and rules verify the token itself). A
   * screen reads a claim the console reads the same way, such as `staff`.
   */
  suspend fun claims(): kotlinx.serialization.json.JsonObject = getIdToken(false)?.let(::jwtPayload) ?: kotlinx.serialization.json.JsonObject(emptyMap())

  /** Calls a route and returns its JSON body (null for an empty body). */
  suspend fun request(
    path: String,
    method: ApiMethod = ApiMethod.GET,
    body: JsonElement? = null,
    query: Map<String, Any?> = emptyMap(),
    idempotencyKey: String? = null,
    anonymous: Boolean = false,
  ): JsonElement? {
    val retryable = method == ApiMethod.GET || idempotencyKey != null
    var forceRefresh = false
    var lastError: Throwable? = null
    var attempt = 1
    while (attempt <= maxAttempts) {
      var bearer: String? = null
      if (!anonymous) {
        bearer = getIdToken(forceRefresh) ?: throw ConsoleApiError("Sign in to continue.", 401, null)
      }
      val response = try {
        http.request(urlFor(path, query)) {
          this.method = HttpMethod.parse(method.name)
          header("Accept", "application/json")
          if (bearer != null) header("Authorization", "Bearer $bearer")
          if (idempotencyKey != null) header("Idempotency-Key", idempotencyKey)
          if (body != null) {
            contentType(ContentType.Application.Json)
            setBody(body.toString())
          }
        }
      } catch (error: CancellationException) {
        throw error
      } catch (error: Throwable) {
        lastError = error
        if (!retryable || attempt == maxAttempts) break
        sleep(backoff(attempt))
        attempt += 1
        continue
      }
      val status = response.status.value
      val parsed = runCatching { Json.parseToJsonElement(response.bodyAsText()) }.getOrNull()
      if (status in 200..299) return parsed
      // One forced token refresh on a 401: an ID token can expire between
      // the read and the request, and a fresh one is the whole fix.
      if (status == 401 && !anonymous && !forceRefresh) {
        forceRefresh = true
        continue
      }
      if (retryable && status in RETRYABLE_STATUS && attempt < maxAttempts) {
        sleep(backoff(attempt))
        attempt += 1
        continue
      }
      throw ConsoleApiError(consoleErrorMessage(status, parsed, brandName), status, parsed)
    }
    throw ConsoleApiError(
      "$brandName could not be reached. Check the connection and try again.",
      0,
      lastError?.message?.let { JsonPrimitive(it) },
    )
  }

  /**
   * Calls a route that answers with a file (an export) and returns its bytes
   * and the file name its `Content-Disposition` gives. A refusal is a
   * [ConsoleApiError] with the route's own words, as [request] throws it.
   */
  suspend fun download(path: String, body: JsonElement): DownloadedFile {
    val bearer = getIdToken(false) ?: throw ConsoleApiError("Sign in to continue.", 401, null)
    val response = try {
      http.request(urlFor(path)) {
        this.method = HttpMethod.Post
        header("Authorization", "Bearer $bearer")
        contentType(ContentType.Application.Json)
        setBody(body.toString())
      }
    } catch (error: CancellationException) {
      throw error
    } catch (error: Throwable) {
      throw ConsoleApiError("$brandName could not be reached. Check the connection and try again.", 0, null)
    }
    val status = response.status.value
    if (status !in 200..299) {
      val parsed = runCatching { Json.parseToJsonElement(response.bodyAsText()) }.getOrNull()
      throw ConsoleApiError(consoleErrorMessage(status, parsed, brandName), status, parsed)
    }
    val disposition = response.headers["Content-Disposition"].orEmpty()
    val name = Regex("filename\\*?=\"?([^\";]+)\"?").find(disposition)?.groupValues?.get(1)
    return DownloadedFile(name, response.headers["Content-Type"] ?: "application/octet-stream", response.readRawBytes(), response.headers)
  }

  /**
   * Sends [bytes] to a signed upload URL a route handed out (the media
   * library's large-file path): a plain `PUT` with the minted content type,
   * no bearer, since the signature is the authority. Throws on a refusal.
   */
  suspend fun putSigned(url: String, contentType: String, bytes: ByteArray) {
    require(url.startsWith("https://") || url.startsWith("http://")) { "A signed upload URL is absolute: $url" }
    val response = try {
      http.request(url) {
        this.method = HttpMethod.Put
        header("Content-Type", contentType)
        setBody(bytes)
      }
    } catch (error: CancellationException) {
      throw error
    } catch (error: Throwable) {
      throw ConsoleApiError("The upload did not reach storage. Check the connection and try again.", 0, null)
    }
    if (response.status.value !in 200..299) {
      throw ConsoleApiError("Storage refused the upload (${response.status.value}).", response.status.value, null)
    }
  }

  companion object {
    val RETRYABLE_STATUS = setOf(502, 503, 504)

    fun backoff(attempt: Int): Long = 400L * (1L shl (attempt - 1))

    /** The message a route sent, or a plain one for its status. */
    fun consoleErrorMessage(status: Int, body: JsonElement?, brandName: String = AglynConfig.DEFAULT_BRAND_NAME): String {
      if (body is JsonObject) {
        for (key in listOf("error", "message")) {
          val value = (body[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
          if (!value.isNullOrEmpty()) return value
        }
      }
      return when {
        status == 401 -> "Your session ended. Sign in again."
        status == 403 -> "You do not have permission to do that."
        status == 404 -> "That was not found."
        status >= 500 -> "$brandName could not be reached. Try again in a moment."
        else -> "That did not work. Try again."
      }
    }
  }
}

/** A JWT's payload as JSON (base64url, unpadded); empty when it is not one. */
@OptIn(kotlin.io.encoding.ExperimentalEncodingApi::class)
fun jwtPayload(token: String): kotlinx.serialization.json.JsonObject {
  val part = token.split('.').getOrNull(1) ?: return kotlinx.serialization.json.JsonObject(emptyMap())
  return runCatching {
    val bytes = kotlin.io.encoding.Base64.UrlSafe.withPadding(kotlin.io.encoding.Base64.PaddingOption.ABSENT_OPTIONAL).decode(part)
    kotlinx.serialization.json.Json.parseToJsonElement(bytes.decodeToString()) as kotlinx.serialization.json.JsonObject
  }.getOrElse { kotlinx.serialization.json.JsonObject(emptyMap()) }
}
