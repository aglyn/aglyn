package com.aglyn.screens

import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.TokenClaims
import com.aglyn.pluginhost.NativeParams
import com.aglyn.pluginhost.NativePluginContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Who is signed in and where, beyond what a plugin context carries. The
 * shell provides it once; every spec screen reads it. Twin of the Apple
 * `ScreenSession`.
 */
data class ScreenSession(
  val email: String? = null,
  val displayName: String? = null,
  val orgName: String? = null,
  val orgRole: String? = null,
  val siteName: String? = null,
  val claims: TokenClaims = TokenClaims(),
  val origin: String = "",
  /** Signs in again with the password, so the next token carries a fresh `auth_time`. */
  val reauthenticate: suspend (password: String) -> Unit = {},
  /** Re-reads the token's claims (after a reauth). */
  val refreshClaims: suspend () -> Unit = {},
  /** Opens a page someone else hosts (Stripe) in the platform's secure in-app browser. */
  val openHostedPage: (url: String) -> Unit = {},
  /** Leaves the current screen (an action that ends it, like a delete). */
  val back: () -> Unit = {},
) {
  fun context(plugin: NativePluginContext?, params: NativeParams): JsonElement {
    val role = orgRole.orEmpty()
    val manager = role == "owner" || role == "admin"
    return buildJsonObject {
      put("org", buildJsonObject {
        put("id", plugin?.orgId)
        put("slug", plugin?.orgSlug)
        put("name", orgName)
        put("role", role)
        put("manager", manager || claims.isStaff)
        put("owner", role == "owner")
      })
      put("site", buildJsonObject {
        put("id", plugin?.hostId)
        put("slug", plugin?.hostSlug)
        put("name", siteName)
      })
      put("user", buildJsonObject {
        put("uid", plugin?.uid)
        put("email", email)
        put("name", displayName)
      })
      put("staff", buildJsonObject {
        put("is", claims.isStaff)
        put("role", claims.staffRole)
        put("super", claims.isSuper)
      })
      put("app", buildJsonObject { put("origin", origin) })
      // Today, for routes that take a period, in UTC as the routes keep them.
      put("now", buildJsonObject {
        val (year, month) = nowParts()
        put("month", "$year-${month.toString().padStart(2, '0')}")
        put("quarter", "$year-Q${(month - 1) / 3 + 1}")
        put("ms", nowMillis().toDouble())
      })
      put("params", JsonObject(params.mapValues { JsonPrimitive(it.value) }))
      put("data", JsonObject(emptyMap()))
      put("form", JsonObject(emptyMap()))
    }
  }
}

val LocalScreenSession = compositionLocalOf { ScreenSession() }

sealed interface ActionOutcome {
  data class Done(val message: String?, val response: JsonElement?) : ActionOutcome
  data class NeedsReauth(val message: String) : ActionOutcome
  data class Failed(val message: String) : ActionOutcome
}

/** One spec screen's state: its loaded data and the actions it runs. */
class ScreenModel(
  val spec: ScreenSpec,
  initial: JsonElement,
  private val api: ConsoleApiClient?,
  private val reader: com.aglyn.core.FirestoreReader? = null,
  private val writer: com.aglyn.core.FirestoreWriter? = null,
) {
  sealed interface Phase {
    data object Loading : Phase
    data object Ready : Phase
    data class Failed(val message: String) : Phase
  }

  var phase: Phase by mutableStateOf(Phase.Loading)
    private set
  /** A spec's fixed rows (`constants`) read as `const`. */
  var context: JsonElement by mutableStateOf(spec.raw.obj("constants")?.let { ScreenContext.with(initial, "const", it) } ?: initial)
    private set
  val cursors = mutableStateMapOf<String, String>()
  val loadingMore = mutableStateMapOf<String, Boolean>()
  val search = mutableStateMapOf<String, String>()

  val data: JsonElement get() = context.obj("data") ?: JsonObject(emptyMap())

  /** Seeds data without a network (previews, snapshot tests). */
  fun seed(data: JsonElement) {
    context = ScreenContext.with(context, "data", data)
    phase = Phase.Ready
  }

  internal fun url(load: LoadSpec, cursor: String? = null): String {
    var url = ScreenValues.renderUrl(load.url, context)
    search[load.key]?.takeIf { it.isNotBlank() }?.let {
      url += (if ('?' in url) "&" else "?") + "search=" + ScreenValues.encodeComponent(it)
    }
    if (cursor != null) url += (if ('?' in url) "&" else "?") + load.cursorParam + "=" + ScreenValues.encodeComponent(cursor)
    return url
  }

  suspend fun load() {
    if ((data as? JsonObject)?.isEmpty() != false) phase = Phase.Loading
    val client = api ?: run {
      phase = Phase.Failed("Sign in to continue.")
      return
    }
    val loads = spec.loads.filter { ScreenValues.condition(it.whenCondition, context) }
    val results = try {
      coroutineScope {
        loads.map { load ->
          async {
            try {
              fetch(client, load)
            } catch (error: CancellationException) {
              throw error
            } catch (error: Throwable) {
              if (load.optional) Triple(load.key, JsonNull, null) else throw error
            }
          }
        }.awaitAll()
      }
    } catch (error: CancellationException) {
      throw error
    } catch (error: ConsoleApiError) {
      phase = Phase.Failed(error.message)
      return
    } catch (error: Throwable) {
      phase = Phase.Failed(error.message ?: "This did not load.")
      return
    }
    context = ScreenContext.with(context, "data", JsonObject(results.associate { it.first to it.second }))
    cursors.clear()
    for ((key, _, cursor) in results) if (!cursor.isNullOrEmpty()) cursors[key] = cursor
    phase = Phase.Ready
  }

  private suspend fun fetch(client: ConsoleApiClient, load: LoadSpec): Triple<String, JsonElement, String?> {
    load.doc?.let { doc ->
      return Triple(load.key, reader?.let { FirestoreLoads.document(it, ScreenValues.render(doc, context)) } ?: JsonNull, null)
    }
    load.query?.let { query ->
      return Triple(load.key, reader?.let { FirestoreLoads.query(it, query, context) } ?: JsonNull, null)
    }
    val value = client.request(url(load), load.method, load.body?.let { ScreenValues.resolveBody(it, context) }) ?: JsonNull
    return Triple(load.key, value, load.cursor?.let { (ScreenValues.lookup(it, value) as? JsonPrimitive)?.takeIf { p -> p.isString }?.content })
  }

  suspend fun loadMore(key: String) {
    val client = api ?: return
    val load = spec.loads.firstOrNull { it.key == key } ?: return
    val cursor = cursors[key] ?: return
    val itemsPath = load.items ?: return
    if (loadingMore[key] == true) return
    loadingMore[key] = true
    try {
      val page = client.request(url(load, cursor)) ?: JsonNull
      val more = (ScreenValues.lookup(itemsPath, page) as? JsonArray) ?: JsonArray(emptyList())
      val record = (data as? JsonObject)?.toMutableMap() ?: return
      val current = record[key] ?: return
      record[key] = appending(more, itemsPath, current)
      context = ScreenContext.with(context, "data", JsonObject(record))
      val next = load.cursor?.let { (ScreenValues.lookup(it, page) as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }
      if (next.isNullOrEmpty()) cursors.remove(key) else cursors[key] = next
    } catch (error: CancellationException) {
      throw error
    } catch (_: Throwable) {
    } finally {
      loadingMore.remove(key)
    }
  }

  suspend fun run(action: ActionSpec, scope: JsonElement): ActionOutcome {
    val outcome = perform(action, scope)
    if (outcome is ActionOutcome.Done) action.then?.let { perform(it, ScreenContext.with(scope, "response", outcome.response)) }
    return outcome
  }

  private suspend fun perform(action: ActionSpec, scope: JsonElement): ActionOutcome {
    action.write?.let { write ->
      val doc = write.str("doc") ?: return ActionOutcome.Failed("Saving is not available here.")
      val target = writer ?: return ActionOutcome.Failed("Saving is not available here.")
      return try {
        val fields = ScreenValues.resolveBody(write.obj("fields") ?: JsonObject(emptyMap()), scope)
        @Suppress("UNCHECKED_CAST")
        target.merge(ScreenValues.render(doc, scope), (plain(fields) as? Map<String, Any?>) ?: emptyMap())
        ActionOutcome.Done(action.success?.let { ScreenValues.render(it, scope) }, null)
      } catch (error: CancellationException) {
        throw error
      } catch (error: Throwable) {
        ActionOutcome.Failed(error.message ?: "That did not save.")
      }
    }
    val template = action.url ?: return ActionOutcome.Done(null, null)
    val client = api ?: return ActionOutcome.Failed("Sign in to continue.")
    val path = ScreenValues.renderUrl(template, scope)
    val body = if (action.method == ApiMethod.GET) null else (action.body?.let { ScreenValues.resolveBody(it, scope) } ?: JsonObject(emptyMap()))
    return try {
      val response = client.request(path, action.method, body)
      ActionOutcome.Done(action.success?.let { ScreenValues.render(it, ScreenContext.with(scope, "response", response)) }, response)
    } catch (error: CancellationException) {
      throw error
    } catch (error: ConsoleApiError) {
      when {
        wantsReauth(error) -> ActionOutcome.NeedsReauth(error.body.str("message") ?: error.message)
        error.status == 404 && action.otherwise != null -> perform(action.otherwise, scope)
        else -> ActionOutcome.Failed(error.message)
      }
    } catch (error: Throwable) {
      ActionOutcome.Failed(error.message ?: "That did not work. Try again.")
    }
  }

  companion object {
    /** JSON as the plain values a Firestore merge takes. */
    fun plain(value: JsonElement): Any? = when (value) {
      JsonNull -> null
      is JsonPrimitive -> when {
        value.isString -> value.content
        value.content == "true" || value.content == "false" -> value.content == "true"
        else -> value.content.toLongOrNull() ?: value.content.toDoubleOrNull()
      }
      is JsonArray -> value.map { plain(it) }
      is JsonObject -> value.mapValues { plain(it.value) }
    }

    internal fun appending(rows: JsonArray, path: String, value: JsonElement): JsonElement {
      val segments = path.split('.').filter { it.isNotEmpty() }
      if (segments.isEmpty()) return if (value is JsonArray) JsonArray(value + rows) else value
      val record = (value as? JsonObject)?.toMutableMap() ?: return value
      record[segments[0]] = appending(rows, segments.drop(1).joinToString("."), record[segments[0]] ?: JsonArray(emptyList()))
      return JsonObject(record)
    }

    fun wantsReauth(error: ConsoleApiError): Boolean {
      val words = listOf("error", "code", "reason").mapNotNull { error.body.str(it) }
      return words.any { it in setOf("reauth-required", "recent-login-required", "requires-recent-login") }
    }
  }
}
