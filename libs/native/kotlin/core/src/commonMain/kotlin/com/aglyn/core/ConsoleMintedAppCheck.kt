package com.aglyn.core

import io.ktor.client.HttpClient
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.statement.bodyAsText
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull

/**
 * App Check for Compose Desktop (AGL-3816, Zach 2026-10-15): there is no attestation on Windows, so the console mints this app's
 * tokens for a session it signed in. The first arrives with the hand-off's custom token ([seed]), because Identity Toolkit
 * refuses the custom-token exchange without one; after that each is asked of `POST /api/auth/native-app-check` with the app's
 * current ID token, which the route verifies (a revoked token or a disabled account is refused).
 *
 * The token is cached and replaced at half its life, one mint at a time ([token] holds a lock, so concurrent callers share one
 * request), and re-minted when Firebase refuses it ([withAppCheck] asks again with `forceRefresh`). [clear] drops it on sign-out,
 * and a session that is gone ([idToken] answers null) gets none.
 *
 * [idToken] must answer the CURRENT ID token without refreshing it: a refresh goes over the same client, which asks this
 * provider, and the Secure Token refresh needs no App Check (measured against aglyn-main), so the two never wait on each other.
 */
class ConsoleMintedAppCheck(
  /** A client WITHOUT App Check: the console is not a Firebase API. */
  private val http: HttpClient,
  consoleOrigin: String,
  /** A random id this install made once (never a hardware identifier), for the route's per-device rate limit. */
  private val deviceId: String,
  private val now: () -> Long = ::nowMillis,
) : AppCheckTokenProvider {
  private val endpoint = consoleOrigin.trimEnd('/') + "/api/auth/native-app-check"
  private val lock = Mutex()
  private var current: Minted? = null

  /** The signed-in session's current ID token, unrefreshed; null when nobody is signed in. */
  var idToken: () -> String? = { null }

  private class Minted(val token: String, val issuedAtMs: Long, val expiresAtMs: Long) {
    val halfLifeMs: Long get() = issuedAtMs + (expiresAtMs - issuedAtMs) / 2
  }

  /** The first token, from the hand-off's redemption. */
  fun seed(token: String, expiresAtMs: Long?) {
    val issued = now()
    current = Minted(token, issued, expiresAtMs ?: (issued + DEFAULT_TTL_MS))
  }

  /** Drops the token: on sign-out nothing outlives the session. */
  fun clear() {
    current = null
  }

  override suspend fun token(forceRefresh: Boolean): String? {
    val cached = current
    if (!forceRefresh && cached != null && now() < cached.halfLifeMs) return cached.token
    return lock.withLock {
      // Another caller may have minted while this one waited.
      val again = current
      if (again != null && again !== cached && now() < again.halfLifeMs) return@withLock again.token
      val session = idToken()
      if (session == null) {
        current = null
        return@withLock null
      }
      val minted = mint(session)
      if (minted != null) {
        current = minted
        minted.token
      } else {
        // Keep a token that has not expired yet; the next call tries again.
        current?.takeIf { now() < it.expiresAtMs }?.token
      }
    }
  }

  private suspend fun mint(session: String): Minted? = try {
    val response = http.post(endpoint) {
      header("Authorization", "Bearer $session")
      header("X-Aglyn-Device", deviceId)
    }
    if (response.status.value == 401) current = null
    val body = runCatching { Json.parseToJsonElement(response.bodyAsText()) as? JsonObject }.getOrNull()
    val token = (body?.get("token") as? JsonPrimitive)?.contentOrNull
    if (response.status.value !in 200..299 || token.isNullOrEmpty()) {
      null
    } else {
      val issued = now()
      Minted(token, issued, (body["expiresAtMs"] as? JsonPrimitive)?.longOrNull ?: (issued + DEFAULT_TTL_MS))
    }
  } catch (error: CancellationException) {
    throw error
  } catch (_: Throwable) {
    null
  }

  companion object {
    /** The route's token lifetime, for an answer that does not say. */
    const val DEFAULT_TTL_MS = 60L * 60 * 1000
  }
}
