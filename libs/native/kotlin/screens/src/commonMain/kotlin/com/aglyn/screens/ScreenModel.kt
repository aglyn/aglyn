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
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/**
 * What a spec's `account` actions do to the signed-in person's own sign-in (the
 * console does these with the Firebase client SDK, not a route). Twin of the
 * Apple `AccountOperations`.
 */
data class AccountOperations(
  /** Proves the current password, then sets the new one. */
  val changePassword: suspend (current: String, new: String) -> Unit = { _, _ ->
    throw IllegalStateException("Changing the password is not available here.")
  },
  /** Keeps the account's display name in step with the profile. */
  val updateDisplayName: suspend (name: String) -> Unit = {},
  /** Connects Google through the platform's sign-in sheet and links it to the account. */
  val linkGoogle: suspend () -> Unit = {
    throw IllegalStateException("Connecting Google is not set up in this build.")
  },
  /** Disconnects a sign-in provider (`google.com`) from the account. */
  val unlinkProvider: suspend (providerId: String) -> Unit = {
    throw IllegalStateException("Disconnecting a sign-in method is not available here.")
  },
)

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
  val account: AccountOperations = AccountOperations(),
  /** Whether this build can connect Google (its OAuth client is configured and a sign-in sheet runner is bound). */
  val googleConfigured: Boolean = false,
  /**
   * The relying party passkeys are made for (`aglyn.com`): set where this build can make a passkey (it is configured,
   * the app is linked to that domain, and a creator is bound); null hides the action.
   */
  val passkeyRelyingParty: String? = null,
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
        put("providers", kotlinx.serialization.json.JsonArray(claims.signInMethods.map { JsonPrimitive(it) }))
        put("emailVerified", claims.emailVerified)
        // Google can be connected where this build has its client, the account is not on a company login (a tenant), and Google is not connected already.
        put("canLinkGoogle", googleConfigured && (claims.values["firebase"] as? JsonObject)?.get("tenant") == null && "google.com" !in claims.signInMethods)
        // A passkey can be set up where this build can make one, the account is not on a company login (the routes refuse a tenant) and its email is verified (they refuse that too).
        put("canAddPasskey", passkeyRelyingParty != null && (claims.values["firebase"] as? JsonObject)?.get("tenant") == null && claims.emailVerified)
      })
      put("staff", buildJsonObject {
        put("is", claims.isStaff)
        put("role", claims.staffRole)
        put("super", claims.isSuper)
      })
      put("app", buildJsonObject {
        put("origin", origin)
        put("passkeyRp", passkeyRelyingParty)
      })
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

/**
 * Values an action keeps for later screens (`stash`): a chosen file, the plan read from it, the choices made
 * on the way. In memory only, until the app closes.
 */
object ScreenStash {
  var values: JsonObject = JsonObject(emptyMap())
    private set

  fun set(updates: JsonElement) {
    val record = updates as? JsonObject ?: return
    val next = values.toMutableMap()
    for ((key, value) in record) if (value == JsonNull) next.remove(key) else next[key] = value
    values = JsonObject(next)
  }

  fun clear() { values = JsonObject(emptyMap()) }
}

/** Makes a passkey through the platform; the app provides it where the device can (null elsewhere, and the desktop). */
val LocalPasskeyCreator = compositionLocalOf<PasskeyCreator?> { null }

/** Signs in to Google on this device for "Connect Google": the Credential Manager on Android, the browser on the desktop (null elsewhere). */
val LocalGoogleCredentialSource = compositionLocalOf<com.aglyn.core.GoogleCredentialSource?> { null }

sealed interface ActionOutcome {
  data class Done(val message: String?, val response: JsonElement?) : ActionOutcome
/** Signs in with a passkey on this device; the app provides it where the device can (null elsewhere, and the desktop). */
val LocalPasskeyAsserter = compositionLocalOf<PasskeyAsserter?> { null }

  /** A route answered with a file to save. */
  class File(val name: String, val mimeType: String, val bytes: ByteArray, val message: String?) : ActionOutcome
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
  private val account: AccountOperations? = null,
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
  /** The `{attempt}` key of each action's last request, by action, path and body: a retry reuses it. */
  private val attempts = mutableMapOf<String, String>()

  val data: JsonElement get() = context.obj("data") ?: JsonObject(emptyMap())

  /** Makes a passkey through the platform; the screen sets it (null where the device cannot). */
  var createPasskey: PasskeyCreator? = null

  /** Seeds data without a network (previews, snapshot tests). */
  fun seed(data: JsonElement) {
    context = ScreenContext.with(context, "data", data)
    applyDerived()
    phase = Phase.Ready
  }

  /**
   * The screen's `derive` list (`[{ name, when }]`, in order) as `is.<name>`: conditions worked out once over the
   * loaded data, so a block can say `is.billed` where the condition itself would need brackets. A later entry may
   * read an earlier one.
   */
  private fun applyDerived() {
    val entries = spec.raw.arr("derive")
    if (entries.isEmpty()) return
    val flags = mutableMapOf<String, JsonElement>()
    for (entry in entries) {
      val name = entry.str("name") ?: continue
      val seen = ScreenContext.with(context, "is", JsonObject(flags.toMap()))
      flags[name] = JsonPrimitive(ScreenValues.condition(entry.str("when"), seen))
    }
    context = ScreenContext.with(context, "is", JsonObject(flags.toMap()))
  }

  internal fun url(load: LoadSpec, cursor: String? = null, scope: JsonElement = context): String {
    var url = ScreenValues.renderUrl(load.url, scope)
    search[load.key]?.takeIf { it.isNotBlank() }?.let {
      url += (if ('?' in url) "&" else "?") + "search=" + ScreenValues.encodeComponent(it)
    }
    // A GET route pages through the query string; a POST route reads it from the body (`pageBody`).
    if (cursor != null && load.method == ApiMethod.GET) url += (if ('?' in url) "&" else "?") + load.cursorParam + "=" + ScreenValues.encodeComponent(cursor)
    return url
  }

  /** The body of a paged POST load's next page: its own body with the cursor under `cursorParam` (a number when it reads as one, since the route compares it as one). */
  internal fun pageBody(load: LoadSpec, cursor: String): JsonElement? {
    if (load.method == ApiMethod.GET) return null
    val own = (load.body?.let { ScreenValues.resolveBody(it, context) } as? JsonObject) ?: JsonObject(emptyMap())
    val value: JsonElement = cursor.toLongOrNull()?.let { JsonPrimitive(it) } ?: cursor.toDoubleOrNull()?.let { JsonPrimitive(it) } ?: JsonPrimitive(cursor)
    return JsonObject(own + (load.cursorParam to value))
  }

  suspend fun load() {
    if ((data as? JsonObject)?.isEmpty() != false) phase = Phase.Loading
    val client = api ?: run {
      phase = Phase.Failed("Sign in to continue.")
      return
    }
    context = ScreenContext.with(context, "stash", ScreenStash.values)
    context = ScreenContext.with(context, "now", ScreenValues.nowObject())
    val loads = spec.loads.filter { ScreenValues.condition(it.whenCondition, context) }
    val results = try {
      val first = coroutineScope {
        loads.filter { it.each == null && it.compute == null }.map { load ->
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
      // The per-row loads (`each`) follow once the rows they walk have arrived.
      val seen = ScreenContext.with(context, "data", JsonObject(first.associate { it.first to it.second }))
      val walked = loads.filter { it.each != null }.map { load ->
        val rows = ((ScreenValues.lookup(load.each.orEmpty(), seen) as? JsonArray) ?: JsonArray(emptyList())).take(EACH_CEILING)
        val answers = coroutineScope {
          rows.map { row ->
            async {
              val scope = ScreenContext.withItem(seen, row)
              try {
                fetch(client, load, scope).second
              } catch (error: CancellationException) {
                throw error
              } catch (_: Throwable) {
                JsonNull
              }
            }
          }.awaitAll()
        }
        Triple(load.key, JsonArray(answers) as JsonElement, null as String?)
      }
      // Pure functions over what has loaded (a diff of two items), in the order they are declared.
      val loaded = (first + walked).toMutableList()
      for (load in loads.filter { it.compute != null }) {
        val ready = ScreenContext.with(context, "data", JsonObject(loaded.associate { it.first to it.second }))
        val args = load.args.map { arg -> arg.toDoubleOrNull()?.let { JsonPrimitive(it) } ?: ScreenValues.lookup(arg, ready) }
        loaded += Triple(load.key, ScreenFunctions.call(load.compute.orEmpty(), args) ?: JsonNull, null as String?)
      }
      loaded
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
    applyDerived()
    cursors.clear()
    for ((key, _, cursor) in results) if (!cursor.isNullOrEmpty()) cursors[key] = cursor
    phase = Phase.Ready
  }

  private suspend fun fetch(client: ConsoleApiClient, load: LoadSpec, scope: JsonElement = context): Triple<String, JsonElement, String?> {
    load.doc?.let { doc ->
      return Triple(load.key, reader?.let { FirestoreLoads.document(it, ScreenValues.render(doc, scope)) } ?: JsonNull, null)
    }
    load.query?.let { query ->
      return Triple(load.key, reader?.let { FirestoreLoads.query(it, query, scope) } ?: JsonNull, null)
    }
    load.switchboard?.let { level ->
      val reader = reader ?: return Triple(load.key, JsonNull, null)
      val org = FirestoreLoads.document(reader, ScreenValues.render("orgs/{org.id}", scope))
      if (level != "site") return Triple(load.key, SwitchboardRows.org(org), null)
      val host = FirestoreLoads.document(reader, ScreenValues.render("hosts/{site.id}", scope))
      return Triple(load.key, SwitchboardRows.site(org, host), null)
    }
    val value = client.request(url(load, scope = scope), load.method, load.body?.let { ScreenValues.resolveBody(it, scope) }) ?: JsonNull
    return Triple(load.key, value, cursorOf(load, value))
  }

  /** A paged route's next cursor: the text at `cursor`, or a number (a job's `createdAt`) as text. */
  private fun cursorOf(load: LoadSpec, page: JsonElement): String? {
    val found = load.cursor?.let { ScreenValues.lookup(it, page) } as? JsonPrimitive ?: return null
    return when {
      found.isString -> found.content.takeIf { it.isNotEmpty() }
      found is JsonNull -> null
      else -> ScreenValues.text(found)
    }
  }

  /** Takes the session's people and workspace afresh (after the token's claims changed, such as a sign-in method disconnected), keeping what the screen has loaded. */
  fun rebase(base: JsonElement) {
    var next = context
    for (key in listOf("org", "site", "user", "staff")) base.obj(key)?.let { next = ScreenContext.with(next, key, it) }
    context = next
  }

  suspend fun loadMore(key: String) {
    val client = api ?: return
    val load = spec.loads.firstOrNull { it.key == key } ?: return
    val cursor = cursors[key] ?: return
    val itemsPath = load.items ?: return
    if (loadingMore[key] == true) return
    loadingMore[key] = true
    try {
      val page = client.request(url(load, cursor), load.method, pageBody(load, cursor)) ?: JsonNull
      val more = (ScreenValues.lookup(itemsPath, page) as? JsonArray) ?: JsonArray(emptyList())
      val record = (data as? JsonObject)?.toMutableMap() ?: return
      val current = record[key] ?: return
      record[key] = appending(more, itemsPath, current)
      context = ScreenContext.with(context, "data", JsonObject(record))
      val next = cursorOf(load, page)
      if (next.isNullOrEmpty()) cursors.remove(key) else cursors[key] = next
    } catch (error: CancellationException) {
      throw error
    } catch (_: Throwable) {
    } finally {
      loadingMore.remove(key)
    }
  }

  suspend fun run(action: ActionSpec, scope: JsonElement): ActionOutcome {
    var outcome = perform(action, scope)
    // `repeat`: asked again until the answer meets `until`, the stash taking each pass so a screen shows
    // the progress; `stop` ends it as a failure with the route's own words.
    action.repeating?.let { again ->
      val ceiling = (again.obj("max") as? JsonPrimitive)?.doubleOrNull?.toInt() ?: 200
      var passes = 1
      while (outcome is ActionOutcome.Done && passes < ceiling) {
        val seen = ScreenContext.with(scope, "response", (outcome as ActionOutcome.Done).response ?: JsonNull)
        stashAnswer(action, outcome, scope)
        again.str("stop")?.let { stop ->
          if (ScreenValues.condition(stop, seen)) {
            return ActionOutcome.Failed(ScreenValues.render(again.str("stopMessage") ?: "The action stopped. Run it again to carry on.", seen))
          }
        }
        if (ScreenValues.condition(again.str("until") ?: "response.done", seen)) break
        outcome = perform(action, scope)
        passes += 1
      }
    }
    stashAnswer(action, outcome, scope)
    if (outcome is ActionOutcome.Done) action.then?.let { perform(it, ScreenContext.with(scope, "response", outcome.response)) }
    // A follow-up that must succeed runs with the stash just made and the answer in scope.
    if (outcome is ActionOutcome.Done) action.after?.let { follow ->
      val seen = ScreenContext.with(ScreenContext.with(scope, "stash", ScreenStash.values), "response", outcome.response)
      val next = run(follow, seen)
      if (next is ActionOutcome.Failed || next is ActionOutcome.NeedsReauth) return next
    }
    return outcome
  }

  /** Keeps what an action's `stash` asks for from its outcome. */
  private fun stashAnswer(action: ActionSpec, outcome: ActionOutcome, scope: JsonElement) {
    val stash = action.stash ?: return
    val answer: JsonElement = when (outcome) {
      is ActionOutcome.Done -> outcome.response ?: JsonNull
      is ActionOutcome.File -> JsonNull
      else -> return
    }
    ScreenStash.set(ScreenValues.resolveBody(stash, ScreenContext.with(scope, "response", answer)))
    context = ScreenContext.with(context, "stash", ScreenStash.values)
  }

  private suspend fun perform(action: ActionSpec, scope: JsonElement): ActionOutcome {
    action.account?.let { operation ->
      val target = account ?: return ActionOutcome.Failed("That is not available here.")
      return try {
        val form = ScreenValues.resolveBody(action.body ?: JsonObject(emptyMap()), scope)
        fun field(key: String) = ScreenValues.text(form.obj(key))
        when (operation) {
          "changePassword" -> {
            val current = field("current")
            val new = field("new")
            if (current.isEmpty()) return ActionOutcome.Failed("Enter your current password.")
            if (new != field("confirm")) return ActionOutcome.Failed("The two new passwords do not match.")
            if (new.length < 12) return ActionOutcome.Failed("Use at least 12 characters.")
            target.changePassword(current, new)
          }
          // A blank name is not written over the one the account has.
          "updateDisplayName" -> field("name").trim().takeIf { it.isNotEmpty() }?.let { target.updateDisplayName(it) }
          "linkGoogle" -> target.linkGoogle()
          "unlinkProvider" -> {
            val provider = field("providerId")
            if (provider.isEmpty()) return ActionOutcome.Failed("Choose a sign-in method.")
            target.unlinkProvider(provider)
          }
          else -> return ActionOutcome.Failed("That is not available here.")
        }
        ActionOutcome.Done(action.success?.let { ScreenValues.render(it, scope) }, null)
      } catch (error: CancellationException) {
        throw error
      } catch (error: Throwable) {
        ActionOutcome.Failed(error.message ?: "That did not work. Try again.")
      }
    }
    action.passkey?.let { return registerPasskey(it, action, scope) }
    action.businessProfile?.let { profile ->
      val doc = profile.str("doc") ?: return ActionOutcome.Failed("Saving is not available here.")
      val target = writer ?: return ActionOutcome.Failed("Saving is not available here.")
      return try {
        val edited = ScreenValues.resolveBody(profile.obj("edited") ?: JsonObject(emptyMap()), scope)
        val current = ScreenValues.lookup(profile.str("current").orEmpty(), scope)
        val next = BusinessProfile.ownerWrite(current, edited)
        val fields = linkedMapOf<String, JsonElement>()
        for (field in BusinessProfile.fields) fields[field] = next[field] ?: JsonNull
        // `sources` replaces the stored map: a field with no source loses its key.
        val written = (next["sources"] as? JsonObject) ?: JsonObject(emptyMap())
        fields["sources"] = JsonObject(BusinessProfile.fields.associateWith { written[it] ?: JsonObject(mapOf("\$delete" to JsonPrimitive(true))) })
        fields["updatedAt"] = JsonObject(mapOf("\$serverTimestamp" to JsonPrimitive(true)))
        fields["updatedBy"] = ScreenValues.lookup("user.uid", scope) ?: JsonNull
        @Suppress("UNCHECKED_CAST")
        target.merge(ScreenValues.render(doc, scope), (plain(JsonObject(fields)) as? Map<String, Any?>) ?: emptyMap())
        ActionOutcome.Done(action.success?.let { ScreenValues.render(it, scope) }, null)
      } catch (error: CancellationException) {
        throw error
      } catch (error: Throwable) {
        ActionOutcome.Failed(error.message ?: "That did not save.")
      }
    }
    action.write?.let { write ->
      val doc = write.str("doc") ?: return ActionOutcome.Failed("Saving is not available here.")
      val target = writer ?: return ActionOutcome.Failed("Saving is not available here.")
      return try {
        val fields = ScreenValues.resolveBody(write.obj("fields") ?: JsonObject(emptyMap()), scope)
        @Suppress("UNCHECKED_CAST")
        target.merge(ScreenValues.render(doc, scope), (plain(fields) as? Map<String, Any?>) ?: emptyMap())
        val hostId = (ScreenValues.lookup("site.id", scope) as? JsonPrimitive)?.takeIf { it.isString }?.content
        if (action.siteWide && api != null && hostId != null) com.aglyn.core.publishSiteWideChange(api, target, hostId)
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
      val at = action.downloadAt
      val named = action.download
      if (at != null && named != null) {
        // The route answers with JSON; the file is the value at `at`, named from the answer.
        val answer = client.request(path, action.method, body, headers = headers(action, path, body, scope)) ?: JsonNull
        val value = ScreenValues.lookup(at, answer)?.takeIf { it !is JsonNull } ?: return ActionOutcome.Failed("The route sent no file.")
        val fileName = ScreenValues.render(named, ScreenContext.with(scope, "response", answer))
        return ActionOutcome.File(
          fileName, "application/json", prettyJson.encodeToString(JsonElement.serializer(), value).encodeToByteArray(),
          action.success?.let { ScreenValues.render(it, scope) },
        )
      }
      action.download?.let { fallback ->
        val file = client.download(path, if (action.method == ApiMethod.GET) null else (body ?: JsonObject(emptyMap())), action.method)
        return ActionOutcome.File(
          file.name ?: ScreenValues.render(fallback, scope), file.contentType, file.bytes, action.success?.let { ScreenValues.render(it, scope) },
        )
      }
      val response = action.chunk?.let { sendInParts(client, it, path, action.method, body) }
        ?: client.request(path, action.method, body, headers = headers(action, path, body, scope))
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

  /** The action's request headers, rendered; `{attempt}` is the key held for this exact request. */
  @OptIn(ExperimentalUuidApi::class)
  internal fun headers(action: ActionSpec, path: String, body: JsonElement?, scope: JsonElement): Map<String, String> {
    if (action.headers.isEmpty()) return emptyMap()
    val signature = "${action.id}|$path|${body ?: ""}"
    val key = attempts.getOrPut(signature) { Uuid.random().toString() }
    val withAttempt = ScreenContext.with(scope, "attempt", JsonPrimitive(key))
    return action.headers.mapValues { (_, template) -> ScreenValues.render(template, withAttempt) }
  }

  /**
   * A file sent in parts, as the console's upload client sends it: each part's text under `field` with its
   * `part` and `parts`, the job the first answer names sent back with the rest. The last answer must say the
   * file is whole (`until`).
   */
  private suspend fun sendInParts(client: ConsoleApiClient, chunk: JsonElement, path: String, method: ApiMethod, body: JsonElement?): JsonElement? {
    val record = body as? JsonObject
    val field = chunk.str("field")
    if (record == null || field == null) return client.request(path, method, body)
    val budget = (chunk.obj("bytes") as? JsonPrimitive)?.doubleOrNull?.toInt() ?: 3_000_000
    val parts = ScreenValues.splitUpload(ScreenValues.text(record[field]), budget)
    val firstOnly = chunk.arr("firstOnly").mapNotNull { (it as? JsonPrimitive)?.content }
    var jobId: String? = null
    var last: JsonElement? = null
    for ((at, content) in parts.withIndex()) {
      val one = record.toMutableMap()
      one[field] = JsonPrimitive(content)
      if (parts.size > 1) {
        one["part"] = JsonPrimitive(at)
        one["parts"] = JsonPrimitive(parts.size)
      }
      if (at > 0) firstOnly.forEach { one.remove(it) }
      val key = chunk.str("idKey")
      if (jobId != null && key != null) one[key] = JsonPrimitive(jobId)
      last = client.request(path, method, JsonObject(one))
      chunk.str("idFrom")?.let { from -> (last?.let { ScreenValues.lookup(from, it) } as? JsonPrimitive)?.takeIf { it.isString }?.content?.let { jobId = it } }
    }
    chunk.str("until")?.let { until ->
      if (!ScreenValues.truthy(last?.let { ScreenValues.lookup(until, it) })) throw ConsoleApiError("The file did not finish uploading. Try again.", 500, null)
    }
    return last
  }

  /**
   * Sets up a passkey as the console's `registerPasskey` does: the options route answers a challenge, the platform makes
   * the credential, the verify route stores it. The routes read the ceremony's `Origin` (they derive the relying party
   * from it), so the options call sends the relying party's own origin and the verify call the origin the platform
   * signed into the credential.
   */
  private suspend fun registerPasskey(passkey: JsonElement, action: ActionSpec, scope: JsonElement): ActionOutcome {
    val client = api
    val create = createPasskey
    if (client == null || create == null) return ActionOutcome.Failed("Passkeys are not available on this device.")
    val optionsPath = passkey.str("options")
    val verifyPath = passkey.str("verify")
    val origin = passkey.str("origin")?.let { ScreenValues.render(it, scope) }
    if (optionsPath == null || verifyPath == null || origin.isNullOrEmpty()) return ActionOutcome.Failed("Passkeys are not set up in this build.")
    return try {
      val started = client.request(ScreenValues.renderUrl(optionsPath, scope), ApiMethod.POST, JsonObject(emptyMap()), headers = mapOf("Origin" to origin))
      val challengeId = started.str("challengeId")
      val options = started.obj("options")
      if (challengeId == null || options == null) {
        return ActionOutcome.Failed(ScreenPasskeys.message(ConsoleApiError("", 500, null), passkey, scope))
      }
      val credential = create.create(options)
      val label = ScreenValues.text(ScreenValues.resolveBody(action.body ?: JsonObject(emptyMap()), scope).obj("label")).trim()
      val body = buildJsonObject {
        put("challengeId", challengeId)
        put("response", credential)
        if (label.isNotEmpty()) put("label", label)
      }
      val verified = client.request(
        ScreenValues.renderUrl(verifyPath, scope), ApiMethod.POST, body,
        headers = mapOf("Origin" to (ScreenPasskeys.clientDataOrigin(credential) ?: origin)),
      )
      ActionOutcome.Done(action.success?.let { ScreenValues.render(it, ScreenContext.with(scope, "response", verified)) }, verified)
    } catch (error: PasskeyCancelled) {
      // Closing the prompt is the person's answer, not a failure worth alarming them with.
      ActionOutcome.Done(null, null)
    } catch (error: CancellationException) {
      throw error
    } catch (error: ConsoleApiError) {
      if (wantsReauth(error)) ActionOutcome.NeedsReauth(error.body.str("message") ?: error.message) else ActionOutcome.Failed(ScreenPasskeys.message(error, passkey, scope))
    } catch (error: Throwable) {
      ActionOutcome.Failed(ScreenPasskeys.message(error, passkey, scope))
    }
  }

  companion object {
    /** The most rows a per-row load (`each`) runs for. */
    const val EACH_CEILING = 50

    /** A saved JSON file reads as the console's own exports do: indented. */
    private val prettyJson = Json { prettyPrint = true }

    /** JSON as the plain values a Firestore merge takes. */
    fun plain(value: JsonElement): Any? = when (value) {
      JsonNull -> null
      is JsonPrimitive -> when {
        value.isString -> value.content
        value.content == "true" || value.content == "false" -> value.content == "true"
        else -> value.content.toLongOrNull() ?: value.content.toDoubleOrNull()
      }
      is JsonArray -> value.map { plain(it) }
      is JsonObject -> when {
        // `{"$serverTimestamp": true}` and `{"$delete": true}` are the web SDK's sentinels.
        value.size == 1 && value["\$serverTimestamp"] != null -> com.aglyn.core.ServerTimestamp
        value.size == 1 && value["\$delete"] != null -> com.aglyn.core.FirestoreDelete
        else -> value.mapValues { plain(it.value) }
      }
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
