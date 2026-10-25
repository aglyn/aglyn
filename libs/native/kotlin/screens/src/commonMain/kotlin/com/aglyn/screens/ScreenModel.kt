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
import kotlinx.serialization.json.contentOrNull
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
  /**
   * Signs in as a customer with the custom token a staff route minted (`/api/admin/impersonate`), in the identity pool it was
   * minted in; the staff session is set aside and returns when the support session ends. Throws when it is refused.
   */
  val impersonate: suspend (token: String, tenantId: String?) -> Unit = { _, _ -> },
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
      // Today, for routes that take a period, in UTC as the routes keep them (`ScreenValues.nowObject`).
      put("now", ScreenValues.nowObject())
      put("params", JsonObject(params.mapValues { JsonPrimitive(it.value) }))
      put("data", JsonObject(emptyMap()))
      put("form", JsonObject(emptyMap()))
    }
  }
}

private val MONTH_NAMES = listOf("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")

internal fun recentMonths(year: Int, month: Int, count: Int = 12): List<JsonElement> = (0 until count).map { back ->
  val total = year * 12 + (month - 1) - back
  val y = total / 12
  val m = total % 12 + 1
  val next = total + 1
  fun iso(yearValue: Int, monthValue: Int) = "${yearValue.toString().padStart(4, '0')}-${monthValue.toString().padStart(2, '0')}-01T00:00:00.000Z"
  JsonObject(
    mapOf(
      "from" to JsonPrimitive(iso(y, m)),
      "to" to JsonPrimitive(iso(next / 12, next % 12 + 1)),
      "label" to JsonPrimitive("${MONTH_NAMES[m - 1]} $y"),
    ),
  )
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

/** Set on a screen opened by another's `gate`: told when the person finished what the gate asked for, or closes it. */
class ScreenGate(val resolve: () -> Unit, val close: () -> Unit)

val LocalScreenGate = compositionLocalOf<ScreenGate?> { null }

/** Makes a passkey through the platform; the app provides it where the device can (null elsewhere, and the desktop). */
val LocalPasskeyCreator = compositionLocalOf<PasskeyCreator?> { null }

/** Signs in with a passkey on this device; the app provides it where the device can (null elsewhere, and the desktop). */
val LocalPasskeyAsserter = compositionLocalOf<PasskeyAsserter?> { null }

/** Signs in to Google on this device for "Connect Google": the Credential Manager on Android, the browser on the desktop (null elsewhere). */
val LocalGoogleCredentialSource = compositionLocalOf<com.aglyn.core.GoogleCredentialSource?> { null }

sealed interface ActionOutcome {
  data class Done(val message: String?, val response: JsonElement?) : ActionOutcome
  /** A route answered with a file to save. */
  class File(val name: String, val mimeType: String, val bytes: ByteArray, val message: String?) : ActionOutcome
  data class NeedsReauth(val message: String) : ActionOutcome
  /** The route refused for something another screen settles (`gate`): that screen, and the route's words. */
  data class Gated(val screen: String, val message: String) : ActionOutcome
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
    /** [upsell]: the workspace's plan or add-ons do not include what the screen reads, which is an offer, not a failure. */
    data class Failed(val message: String, val upsell: Boolean = false) : Phase
  }

  var phase: Phase by mutableStateOf(Phase.Loading)
    private set
  /** A spec's fixed rows (`constants`) read as `const`. */
  var context: JsonElement by mutableStateOf(
    ScreenContext.with(spec.raw.obj("constants")?.let { ScreenContext.with(initial, "const", it) } ?: initial, "session", sessionValue(emptyList(), emptySet())),
  )
    private set
  /** What the person has done on this screen since it opened, newest first: `{ at, text, confirmed }` (`session.log`). */
  var journal: List<JsonElement> by mutableStateOf(emptyList())
    private set
  /** Keys an action armed (`arm`) and none has spent (`disarm`): `session.armed.<key>`. */
  var armed: Set<String> by mutableStateOf(emptySet())
    private set
  val cursors = mutableStateMapOf<String, String>()
  /** How many rows each grown Firestore query load reads now: a list that was asked for more asks for its page size again. */
  private val queryLimits = mutableMapOf<String, Int>()
  val loadingMore = mutableStateMapOf<String, Boolean>()
  val search = mutableStateMapOf<String, String>()
  /** The order each list was asked for (by its load, else its items); absent is the route's own default. */
  val order = mutableStateMapOf<String, ListOrder>()
  /** The columns each list shows, where the person has picked; absent is the list's own defaults. */
  val shown = mutableStateMapOf<String, Set<String>>()
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
    val context = scope
    var url = ScreenValues.renderUrl(load.url, context)
    search[load.key]?.takeIf { it.isNotBlank() }?.let {
      url += (if ('?' in url) "&" else "?") + load.searchParam + "=" + ScreenValues.encodeComponent(it)
    }
    filtersParameter(load.filters, context)?.let { url += (if ('?' in url) "&" else "?") + it }
    load.sortParam?.let { param ->
      // A list's `route` columns order the route over every row; nothing asked is the route's own default.
      val columns = spec.blocks.filter { it.type == "list" && ListColumns.key(it) == load.key }.flatMap { ListColumns.columns(it) }
      (ListColumns.routeValue(order[load.key], columns) ?: load.sortDefault)?.let { value ->
        url += (if ('?' in url) "&" else "?") + param + "=" + ScreenValues.encodeComponent(value)
      }
    }
    // A GET route pages through the query string; a POST route reads it from the body (`pageBody`).
    if (cursor != null && load.method == ApiMethod.GET) url += (if ('?' in url) "&" else "?") + load.cursorParam + "=" + ScreenValues.encodeComponent(cursor)
    return url
  }

  /** Asks a list for an order. A `route` column reads the route again in that order, from the first page; a `page` column reorders what is on the screen. */
  suspend fun ask(asked: ListOrder?, key: String, routed: Boolean) {
    if (asked == null) order.remove(key) else order[key] = asked
    if (routed) load()
  }

  /** A list's columns with the picks made, or its defaults. */
  internal fun shownColumns(key: String, columns: List<ListColumn>): Set<String> = shown[key] ?: columns.filter { it.show }.map { it.id }.toSet()

  /**
   * The columns plugins contribute to a list read: one request per plugin column for the rows on the screen (in batches of `max`, as
   * the route allows), answered under `column.<id>`. A column that cannot be read leaves its cells blank; it never fails the screen.
   */
  internal suspend fun loadPluginColumns() {
    val client = api ?: return
    val answers = mutableMapOf<String, JsonElement>()
    for (block in spec.blocks.filter { it.type == "list" }) {
      val zone = block.string("columnsZone") ?: continue
      val rows = ScreenValues.rows(ScreenValues.lookup(block.string("items").orEmpty(), context))
      for (contribution in ScreenCatalog.zone(zone).filter { ScreenValues.condition(it.requires, context) }) {
        val column = contribution.raw.obj("column") ?: continue
        val id = column.str("id") ?: continue
        val load = column.obj("load") ?: continue
        val template = load.str("url") ?: continue
        val idTemplate = load.str("ids") ?: "{item.\$id}"
        val ids = rows.map { ScreenValues.render(idTemplate, ScreenContext.withItem(context, it)) }.filter { it.isNotEmpty() }
        val batch = ((load.obj("max") as? JsonPrimitive)?.content?.toDoubleOrNull()?.toInt() ?: 100).coerceAtLeast(1)
        var answer: JsonElement = JsonObject(emptyMap())
        for (chunk in ids.chunked(batch)) {
          val path = ScreenValues.renderUrl(template, ScreenContext.with(context, "ids", JsonPrimitive(chunk.joinToString(","))))
          val part = try {
            client.request(path)
          } catch (error: CancellationException) {
            throw error
          } catch (_: Throwable) {
            null
          }
          if (part != null) answer = merged(answer, part)
        }
        answers[id] = answer
      }
    }
    if (answers.isNotEmpty()) context = ScreenContext.with(context, "column", JsonObject(answers))
  }

  /** A staff list route's `filters=` parameter from `{ field, op, value }` clauses, each kept when its value template is not empty. */
  internal fun filtersParameter(filters: List<JsonElement>, context: JsonElement): String? {
    val clauses = filters.mapNotNull { clause ->
      val value = ScreenValues.render(clause.str("value").orEmpty(), context)
      val field = clause.str("field")
      if (value.isEmpty() || field == null) null
      else JsonObject(mapOf("field" to JsonPrimitive(field), "op" to JsonPrimitive(clause.str("op") ?: "equals"), "value" to JsonPrimitive(value)))
    }
    return if (clauses.isEmpty()) null else "filters=" + ScreenValues.encodeComponent(JsonArray(clauses).toString())
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
    val wanted = spec.loads.filter { ScreenValues.condition(it.whenCondition, context) }
    // A derived value is worked out from the others once they have answered.
    val loads = wanted.filter { it.derive == null }
    val results = try {
      val first = mutableListOf<Triple<String, JsonElement, String?>>()
      // The loads run in parallel; a `late` one waits for the rest, reads their answers, and its `when` can too. The per-row
      // (`each`) and computed (`compute`) loads follow once every read has answered.
      for (late in listOf(false, true)) {
        val scope = if (first.isEmpty()) context else ScreenContext.with(context, "data", JsonObject(first.associate { it.first to it.second }))
        val wave = spec.loads.filter { it.late == late && it.each == null && it.compute == null && it.derive == null && ScreenValues.condition(it.whenCondition, scope) }
        if (wave.isEmpty()) continue
        first += coroutineScope {
          wave.map { load ->
            async {
              try {
                fetch(client, load, scope)
              } catch (error: CancellationException) {
                throw error
              } catch (error: Throwable) {
                if (load.optional) Triple(load.key, JsonNull, null) else throw error
              }
            }
          }.awaitAll()
        }
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
      phase = Phase.Failed(error.message, upsell = isPlanRefusal(error))
      return
    } catch (error: Throwable) {
      phase = Phase.Failed(error.message ?: "This did not load.")
      return
    }
    val answered = results.associate { it.first to it.second }
    val derived = wanted.filter { it.derive != null }.associate { it.key to derive(it, JsonObject(answered)) }
    context = ScreenContext.with(context, "data", JsonObject(answered + derived))
    applyDerived()
    cursors.clear()
    for ((key, _, cursor) in results) if (!cursor.isNullOrEmpty()) cursors[key] = cursor
    phase = Phase.Ready
    loadPluginColumns()
  }

  /** A derived load's value, from what the screen's other loads answered. */
  internal fun derive(load: LoadSpec, data: JsonElement): JsonElement {
    val source = load.from?.let { ScreenValues.lookup(it, data) }
    return when (load.derive) {
      "shippingCoverage" -> ShippingCoverage.summary(source)
      // `args`: the resources load, then the current stays load (both keys under `data`).
      "unitsAhead" -> {
        val args = load.args.map { ScreenValues.lookup(it, data) }
        val now = ScreenValues.clock()
        Stays.unitsAhead(args.getOrNull(0), args.getOrNull(1), Stays.localToday(now, ScreenValues.timeZone), now)
      }
      else -> JsonNull
    }
  }

  private suspend fun fetch(client: ConsoleApiClient, load: LoadSpec, context: JsonElement = this.context): Triple<String, JsonElement, String?> {
    load.doc?.let { doc ->
      return Triple(load.key, reader?.let { FirestoreLoads.document(it, ScreenValues.render(doc, context)) } ?: JsonNull, null)
    }
    load.query?.let { query ->
      val reader = reader ?: return Triple(load.key, JsonNull, null)
      val limit = queryLimits[load.key] ?: FirestoreLoads.queryLimit(query)
      val answer = FirestoreLoads.query(reader, query, context, limit)
      // A window that came back full may have more behind it; the list offers "Load more" with this as its cursor.
      val full = query.obj("aggregate") == null && ((answer as? JsonObject)?.get("items") as? JsonArray)?.size.let { it != null && it >= limit }
      return Triple(load.key, answer, if (full) limit.toString() else null)
    }
    load.orderZone?.let { id ->
      val reader = reader ?: return Triple(load.key, JsonNull, null)
      return Triple(load.key, FirestoreLoads.orderZone(reader, ScreenValues.render("{site.id}", context), ScreenValues.render(id, context)), null)
    }
    load.entitlement?.let { feature ->
      val reader = reader ?: return Triple(load.key, JsonNull, null)
      return Triple(load.key, FirestoreLoads.entitlement(reader, feature, ScreenValues.render("{org.id}", context)), null)
    }
    if (load.takeRate == "marketplace") {
      val reader = reader ?: return Triple(load.key, JsonNull, null)
      return Triple(load.key, FirestoreLoads.marketplaceTakeRate(reader, ScreenValues.render("{org.id}", context)), null)
    }
    load.switchboard?.let { level ->
      val reader = reader ?: return Triple(load.key, JsonNull, null)
      val org = FirestoreLoads.document(reader, ScreenValues.render("orgs/{org.id}", context))
      if (level != "site") return Triple(load.key, SwitchboardRows.org(org), null)
      val host = FirestoreLoads.document(reader, ScreenValues.render("hosts/{site.id}", context))
      return Triple(load.key, SwitchboardRows.site(org, host), null)
    }
    val value = try {
      client.request(url(load, scope = context), load.method, load.body?.let { ScreenValues.resolveBody(it, context) }) ?: JsonNull
    } catch (error: ConsoleApiError) {
      // A probe that answers 503 is reporting, and the report is the body.
      error.body?.takeIf { error.status in load.accept } ?: throw error
    }
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

  /** The records a `lookup` field's group finds for the words typed. */
  suspend fun lookup(group: LookupGroup, words: String): List<JsonElement> {
    val client = api ?: return emptyList()
    return group.rows(client.request(group.request(words)))
  }

  suspend fun loadMore(key: String) {
    val client = api ?: return
    val load = spec.loads.firstOrNull { it.key == key } ?: return
    val cursor = cursors[key] ?: return
    // A Firestore query has no cursor to continue from here: it reads a bigger window (the load's `more`, else the page size
    // again) and replaces its rows.
    load.query?.let { query ->
      if (loadingMore[key] == true) return
      loadingMore[key] = true
      try {
        val page = FirestoreLoads.queryLimit(query)
        queryLimits[key] = (cursor.toIntOrNull() ?: page) + (load.more ?: page)
        val (_, grown, next) = fetch(client, load, context)
        val record = (data as? JsonObject)?.toMutableMap() ?: return
        record[key] = grown
        context = ScreenContext.with(context, "data", JsonObject(record))
        if (next.isNullOrEmpty()) cursors.remove(key) else cursors[key] = next
      } catch (error: CancellationException) {
        throw error
      } catch (_: Throwable) {
      } finally {
        loadingMore.remove(key)
      }
      return
    }
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
    loadPluginColumns()
  }

  /** A step the person is asked to finish next: the previous step's answer is its `response`, its form its `previous`. */
  data class FollowUp(val action: ActionSpec, val scope: JsonElement)

  /** Set by [run] when the action that ran has a `then` that asks for inputs (a chained prompt); the screen takes it. */
  var followUp: FollowUp? by mutableStateOf(null)

  /** The action that actually made the request last, which may be the `else` of the one that was pressed. */
  private var performed: ActionSpec? = null

  suspend fun run(action: ActionSpec, scope: JsonElement): ActionOutcome {
    performed = null
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
    when (outcome) {
      is ActionOutcome.Done -> {
        remember(performed ?: action, outcome.response, scope)
        (performed ?: action).then?.let { then ->
          val next = ScreenContext.with(ScreenContext.with(scope, "response", outcome.response), "previous", (scope as? JsonObject)?.get("form"))
          if (then.asksInputs(next)) followUp = FollowUp(then, next) else perform(then, next)
        }
      }
      // A preview that failed read nothing, so nothing is armed by it.
      is ActionOutcome.Failed -> action.arm?.let { key ->
        if (key in armed) {
          armed = armed - key
          publishSession()
        }
      }
      is ActionOutcome.NeedsReauth, is ActionOutcome.Gated, is ActionOutcome.File -> Unit
    }
    // A follow-up that must succeed runs with the stash just made and the answer in scope.
    if (outcome is ActionOutcome.Done) action.after?.let { follow ->
      val seen = ScreenContext.with(ScreenContext.with(scope, "stash", ScreenStash.values), "response", outcome.response)
      val next = run(follow, seen)
      if (next is ActionOutcome.Failed || next is ActionOutcome.NeedsReauth || next is ActionOutcome.Gated) return next
    }
    // Plugins that asked to be heard once the action is done (`afterZone`) run their hooks; they never fail the action.
    val after = action.afterZone
    val zone = after.str("zone")
    if (outcome is ActionOutcome.Done && zone != null) {
      val seen = ScreenContext.with(ScreenContext.with(scope, "stash", ScreenStash.values), "response", outcome.response)
      val said = runHooks(zone, seen)
      after.str("stash")?.let { key ->
        ScreenStash.set(JsonObject(mapOf(key to if (said.isEmpty()) JsonNull else JsonPrimitive(said.joinToString(" ")))))
        context = ScreenContext.with(context, "stash", ScreenStash.values)
      }
    }
    return outcome
  }

  /**
   * A write the person makes themselves, as the console does: `{ doc, fields }` merges a document, `{ add, fields }`
   * adds one to a collection, `{ delete }` removes one, and `{ steps: [...] }` does several in order. Any step may
   * carry `each: { items, filter }` to repeat for every row of a list (`item` is the row, `parent` the outer item).
   */
  private suspend fun runWrite(write: JsonElement, scope: JsonElement, target: com.aglyn.core.FirestoreWriter) {
    val steps = write.arr("steps")
    if (steps.isNotEmpty()) {
      for (step in steps) runWrite(step, scope, target)
      return
    }
    val each = write.obj("each")
    if (each != null) {
      val rows = ScreenValues.rows(ScreenValues.lookup(each.str("items").orEmpty(), scope))
        .filter { ScreenValues.condition(each.str("filter"), ScreenContext.withItem(scope, it)) }
      for (row in rows) writeOne(write, ScreenContext.withItem(scope, row), target)
      return
    }
    writeOne(write, scope, target)
  }

  /**
   * A walk-in at the front desk, as the console's reservations card books one: `{ stay: { resource, checkIn, checkOut,
   * guestName, route } }` prices the stay and checks the dates against every live stay of that resource and its blocks (counting
   * units on a resource with several), for the instant answer; then `route` (the console's walk-in route) books the confirmed
   * reservation, asking the same question again inside the transaction that writes it, so two desks taking the last unit at once
   * cannot both win. Anything it cannot book is said in words, and nothing is written.
   */
  private suspend fun bookStay(stay: JsonElement, scope: JsonElement) {
    fun text(key: String) = ScreenValues.render(stay.str(key).orEmpty(), scope).trim()
    val reader = reader ?: throw IllegalStateException("Those dates could not be checked. Try again.")
    val hostId = ScreenValues.render("{site.id}", scope)
    val resourceId = text("resource")
    val checkIn = Stays.dayMs(text("checkIn"))
    val checkOut = Stays.dayMs(text("checkOut"))
    if (resourceId.isEmpty() || checkIn == null || checkOut == null) throw IllegalStateException("Choose a resource and both dates.")
    val resource = Stays.resource(reader.get("hosts/$hostId/resources/$resourceId")?.data) ?: throw IllegalStateException("That resource is gone.")
    val quote = Stays.quote(resource, checkIn, checkOut)
    quote.problem?.let { throw IllegalStateException(it) }
    // The same query the booking door checks against: every stay of this resource that ends after the walk-in arrives.
    val overlapping = try {
      reader.page(
        com.aglyn.core.FirestoreQuery(
          "hosts/$hostId/reservations",
          listOf(com.aglyn.core.FirestoreFilter("resourceId", com.aglyn.core.FilterOp.EQ, resourceId), com.aglyn.core.FirestoreFilter("checkOutDayMs", com.aglyn.core.FilterOp.GT, checkIn)),
          listOf(com.aglyn.core.FirestoreOrder("checkOutDayMs")),
          500,
        ),
      ).docs
    } catch (error: CancellationException) {
      throw error
    } catch (_: Throwable) {
      throw IllegalStateException("Could not check those dates. Try again.")
    }
    if (!Stays.isRangeAvailable(resource, overlapping.mapNotNull { Stays.booked(it.data) }, checkIn, checkOut, nowMillis())) throw IllegalStateException(Stays.takenMessage(resource))
    val route = stay.str("route")
    val client = api
    if (route == null || client == null) throw IllegalStateException("Could not reserve the walk-in — try again")
    val guest = text("guestName")
    val body = linkedMapOf<String, JsonElement>(
      "hostId" to JsonPrimitive(hostId),
      "resourceId" to JsonPrimitive(resourceId),
      "checkInDayMs" to JsonPrimitive(checkIn),
      "checkOutDayMs" to JsonPrimitive(checkOut),
    )
    if (guest.isNotEmpty()) body["guestName"] = JsonPrimitive(guest)
    // One id per attempt, minted here and sent again by a retry of the same walk-in (the same request after a failure), so a
    // stay the route booked before the answer was lost is found rather than booked twice. A booked walk-in lets go of it: the
    // next identical one is another party.
    val signature = "stay|${JsonObject(body)}"
    val reservationId = attempts.getOrPut(signature) { com.aglyn.core.listquery.newResourceId() }
    body["reservationId"] = JsonPrimitive(reservationId)
    try {
      client.request(ScreenValues.renderUrl(route, scope), ApiMethod.POST, JsonObject(body))
    } catch (error: CancellationException) {
      throw error
    } catch (refusal: ConsoleApiError) {
      if (refusal.status >= 400 && refusal.message.isNotEmpty()) throw IllegalStateException(refusal.message)
      throw IllegalStateException("Could not reserve the walk-in — try again")
    } catch (_: Throwable) {
      throw IllegalStateException("Could not reserve the walk-in — try again")
    }
    attempts.remove(signature)
  }

  private suspend fun writeOne(write: JsonElement, scope: JsonElement, target: com.aglyn.core.FirestoreWriter) {
    write.obj("stay")?.let { bookStay(it, scope); return }
    write.str("delete")?.let { target.delete(ScreenValues.render(it, scope)); return }
    val fields = ScreenValues.resolveBody(write.obj("fields") ?: JsonObject(emptyMap()), scope)
    @Suppress("UNCHECKED_CAST")
    val data = (plain(fields) as? Map<String, Any?>) ?: emptyMap()
    write.str("add")?.let { target.add(ScreenValues.render(it, scope), data); return }
    write.str("doc")?.let { target.merge(ScreenValues.render(it, scope), data) }
  }

  private fun publishSession() {
    context = ScreenContext.with(context, "session", sessionValue(journal, armed))
  }

  /**
   * What a successful action leaves on the screen: its `log` lines (the last listed on top, as the console prepends the lines of one act
   * in the order they happened), and the key it arms or spends.
   */
  private fun remember(action: ActionSpec, response: JsonElement?, scope: JsonElement) {
    val entries = logEntries(action.log, response, scope, nowMillis())
    if (entries.isNotEmpty()) journal = (entries.reversed() + journal).take(JOURNAL_LIMIT)
    action.arm?.let { armed = armed + it }
    action.disarm?.let { armed = armed - it }
    if (entries.isNotEmpty() || action.arm != null || action.disarm != null) publishSession()
  }

  /**
   * The hook of each screen contributed to [zone] whose `requires` holds: its `load` read into `data`, then its action run
   * over it. What each says (its success message, or why it failed) is returned; a hook that has nothing to do, or whose
   * action's `when` does not hold once the data is read, says nothing.
   */
  private suspend fun runHooks(zone: String, scope: JsonElement): List<String> {
    val said = mutableListOf<String>()
    for (contributed in ScreenCatalog.zone(zone).filter { ScreenValues.condition(it.requires, scope) }) {
      val hook = contributed.hook ?: continue
      if (!ScreenValues.condition(hook.str("when"), scope)) continue
      val action = hook.obj("action")?.let { ActionSpec.parse(it) } ?: continue
      val reading = ScreenSpec.parse(
        JsonObject(
          mapOf(
            "id" to JsonPrimitive("${contributed.id}.hook"), "title" to JsonPrimitive(contributed.title),
            "load" to (hook.obj("load") ?: JsonObject(emptyMap())),
          ),
        ),
      ) ?: continue
      val sub = ScreenModel(reading, scope, api, reader, writer, account)
      sub.load()
      if (!ScreenValues.condition(action.whenCondition, sub.context)) continue
      when (val result = sub.run(action, sub.context)) {
        is ActionOutcome.Done -> result.message?.takeIf { it.isNotEmpty() }?.let { said += it }
        is ActionOutcome.Failed -> said += result.message
        is ActionOutcome.Gated -> said += result.message
        is ActionOutcome.NeedsReauth -> said += result.message
        is ActionOutcome.File -> Unit
      }
    }
    return said
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
        // One rule for the owner's save, shared with the site's profile: `businessProfileOwnerWrite` (the contracts module).
        @Suppress("UNCHECKED_CAST")
        val next = com.aglyn.contracts.businessProfileOwnerWrite(current?.let { plain(it) } as? Map<String, Any?>, (plain(edited) as? Map<String, Any?>) ?: emptyMap())
        val profileFields = com.aglyn.contracts.Contracts.businessProfileFieldOrder
        val fields = linkedMapOf<String, JsonElement>()
        for (field in profileFields) fields[field] = com.aglyn.core.jsonValue(next[field])
        // `sources` replaces the stored map: a field with no source loses its key.
        @Suppress("UNCHECKED_CAST")
        val written = (next["sources"] as? Map<String, Any?>).orEmpty()
        fields["sources"] = JsonObject(profileFields.associateWith { field -> (written[field] as? String)?.let { JsonPrimitive(it) } ?: JsonObject(mapOf("\$delete" to JsonPrimitive(true))) })
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
      val target = writer ?: return ActionOutcome.Failed("Saving is not available here.")
      if (write.str("doc") == null && write.str("add") == null && write.str("delete") == null && write.obj("stay") == null && write.arr("steps").isEmpty()) {
        return ActionOutcome.Failed("Saving is not available here.")
      }
      return try {
        runWrite(write, scope, target)
        // `siteWide`: the write changes every page of the site, so its cached pages are dropped as the console does.
        val hostId = (ScreenValues.lookup("site.id", scope) as? JsonPrimitive)?.takeIf { it.isString }?.content
        if (action.siteWide && api != null && !hostId.isNullOrEmpty()) com.aglyn.core.publishSiteWideChange(api, target, hostId)
        ActionOutcome.Done(action.success?.let { ScreenValues.render(it, scope) }, null)
      } catch (error: CancellationException) {
        throw error
      } catch (error: Throwable) {
        ActionOutcome.Failed(error.message ?: "That did not save.")
      }
    }
    val template = action.url ?: return ActionOutcome.Done(null, null)
    val client = api ?: return ActionOutcome.Failed("Sign in to continue.")
    val scope = action.overlay?.let { doc ->
      val stored = try {
        reader?.get(ScreenValues.render(doc, scope))?.data
      } catch (error: CancellationException) {
        throw error
      } catch (_: Throwable) {
        null
      }
      ScreenContext.with(scope, "overlay", FirestoreLoads.stored(stored ?: return ActionOutcome.Failed("That could not be read. Try again.")))
    } ?: scope
    val path = ScreenValues.renderUrl(template, scope).let { rendered ->
      filtersParameter(action.filters, scope)?.let { rendered + (if ('?' in rendered) "&" else "?") + it } ?: rendered
    }
    val keyed = withAttempt(action, path, scope)
    val body = if (action.method == ApiMethod.GET) null else (action.body?.let { ScreenValues.resolveBody(it, keyed) } ?: JsonObject(emptyMap()))
    return try {
      val sent = action.headers.mapValues { (_, template) -> ScreenValues.render(template, keyed) }
      val at = action.downloadAt
      val named = action.download
      if (at != null && named != null) {
        // The route answers with JSON; the file is the value at `at`, named from the answer.
        val answer = client.request(path, action.method, body, headers = sent) ?: JsonNull
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
      val chunk = action.chunk
      val loop = action.loop
      val response = when {
        chunk != null -> sendInParts(client, chunk, path, action.method, body)
        loop != null -> paged(loop) { cursor ->
          val page = if (cursor != null && body is JsonObject) JsonObject(body + (loop.param to JsonPrimitive(cursor))) else body
          client.request(path, action.method, page, headers = sent)
        }
        else -> client.request(path, action.method, body, headers = sent)
      }
      performed = action
      ActionOutcome.Done(message(action, response, scope), response)
    } catch (error: CancellationException) {
      throw error
    } catch (error: ConsoleApiError) {
      when {
        wantsReauth(error) -> ActionOutcome.NeedsReauth(error.body.str("message") ?: error.message)
        error.status == action.elseStatus && action.otherwise != null -> perform(action.otherwise, scope)
        action.gate?.str("screen") != null &&
          ScreenValues.condition(action.gate.str("when"), JsonObject(mapOf("error" to (error.body ?: JsonNull)))) ->
          ActionOutcome.Gated(action.gate.str("screen")!!, error.message)
        else -> ActionOutcome.Failed(refusal(action, error, scope))
      }
    } catch (error: Throwable) {
      ActionOutcome.Failed(error.message ?: "That did not work. Try again.")
    }
  }

  /** What an action says when it succeeds: `success`, then its report lines (`each` repeats a line per row). */
  internal fun message(action: ActionSpec, response: JsonElement?, scope: JsonElement): String? {
    val context = ScreenContext.with(scope, "response", response)
    val lines = mutableListOf<String>()
    action.success?.let { lines += ScreenValues.render(it, context) }
    lines += reportLines(action.report, context)
    return lines.takeIf { it.isNotEmpty() }?.joinToString("\n")
  }

  /** What an action says when the route refuses: the route's own words, then its `failure` lines over the answer. */
  internal fun refusal(action: ActionSpec, error: ConsoleApiError, scope: JsonElement): String =
    (listOf(error.message) + reportLines(action.failure, ScreenContext.with(scope, "response", error.body))).joinToString("\n")

  internal fun reportLines(report: List<ReportLine>, context: JsonElement): List<String> {
    val lines = mutableListOf<String>()
    for (line in report) {
      if (line.each != null) {
        // A `when` on a repeated line is read for each row, with `item` its row (the give-back's meters that moved nothing).
        for (row in ScreenValues.rows(ScreenValues.lookup(line.each, context))) {
          val scope = ScreenContext.withItem(context, row)
          if (ScreenValues.condition(line.whenCondition, scope)) lines += ScreenValues.render(line.text, scope)
        }
      } else if (ScreenValues.condition(line.whenCondition, context)) {
        lines += ScreenValues.render(line.text, context)
      }
    }
    return lines
  }

  /**
   * Sends a page at a time until the route says it is done, and answers the totals: numbers add up
   * (a map of counts too), anything else keeps the last page's value. `pages` counts the requests,
   * and `bounded` is true when `max` pages did not reach the end.
   */
  internal suspend fun paged(loop: LoopSpec, send: suspend (cursor: String?) -> JsonElement?): JsonElement? {
    var totals: JsonElement = JsonNull
    var cursor: String? = null
    var pages = 0
    var finished = false
    while (pages < loop.max) {
      val page = send(cursor) ?: JsonNull
      pages += 1
      totals = ScreenValues.sum(totals, page)
      cursor = (ScreenValues.lookup(loop.cursor, page) as? JsonPrimitive)?.takeIf { it.isString && it.content.isNotEmpty() }?.content
      val done = loop.until?.let { ScreenValues.truthy(ScreenValues.lookup(it, page)) } ?: false
      if (done || cursor == null) {
        finished = true
        break
      }
    }
    val record = (totals as? JsonObject)?.toMutableMap() ?: return totals
    record["pages"] = JsonPrimitive(pages)
    record["bounded"] = JsonPrimitive(!finished)
    return JsonObject(record)
  }

  /**
   * `scope` with `attempt` set when the action's headers or body use `{attempt}`: the key held for this exact
   * request, found with `{attempt}` blank so a body that carries the key does not change its own signature.
   */
  @OptIn(ExperimentalUuidApi::class)
  internal fun withAttempt(action: ActionSpec, path: String, scope: JsonElement): JsonElement {
    val bodyText = action.body?.toString() ?: ""
    if (action.headers.isEmpty() && "{attempt" !in bodyText && "{press" !in bodyText) return scope
    val blank = ScreenContext.with(ScreenContext.with(scope, "attempt", JsonPrimitive("")), "press", JsonPrimitive(""))
    val draft = if (action.method == ApiMethod.GET) null else action.body?.let { ScreenValues.resolveBody(it, blank) }
    val key = attempts.getOrPut("${action.id}|$path|${draft ?: ""}") { Uuid.random().toString() }
    // `{press}`: a key for this one press alone (its own retries share it); a second tap of the same request gets a new one.
    return ScreenContext.with(ScreenContext.with(scope, "attempt", JsonPrimitive(key)), "press", JsonPrimitive(Uuid.random().toString()))
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
    /** The most lines the session log keeps, as the console's does. */
    const val JOURNAL_LIMIT = 25

    /** [b] laid over [a]: maps join (by key, down through maps), anything else takes [b]. */
    internal fun merged(a: JsonElement, b: JsonElement): JsonElement {
      if (a !is JsonObject || b !is JsonObject) return b
      val out = a.toMutableMap()
      for ((key, value) in b) out[key] = out[key]?.let { merged(it, value) } ?: value
      return JsonObject(out)
    }

    /** The session the templates read: the log, and what is armed. */
    internal fun sessionValue(journal: List<JsonElement>, armed: Set<String>): JsonElement = JsonObject(
      mapOf("log" to JsonArray(journal), "armed" to JsonObject(armed.associateWith { JsonPrimitive(true) })),
    )

    /** The session-log entries an action's `log` lines make of its answer. */
    internal fun logEntries(log: List<ReportLine>, response: JsonElement?, scope: JsonElement, at: Long): List<JsonElement> {
      val context = ScreenContext.with(scope, "response", response)
      fun entry(line: ReportLine, within: JsonElement): JsonElement = JsonObject(
        mapOf(
          "at" to JsonPrimitive(at),
          "text" to JsonPrimitive(ScreenValues.render(line.text, within)),
          "confirmed" to JsonPrimitive(line.confirmed?.let { ScreenValues.condition(it, within) } ?: true),
        ),
      )
      val entries = mutableListOf<JsonElement>()
      for (line in log) {
        if (line.each != null) {
          for (row in ScreenValues.rows(ScreenValues.lookup(line.each, context))) {
            val rowScope = ScreenContext.withItem(context, row)
            if (ScreenValues.condition(line.whenCondition, rowScope)) entries += entry(line, rowScope)
          }
        } else if (ScreenValues.condition(line.whenCondition, context)) {
          entries += entry(line, context)
        }
      }
      return entries
    }
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
        // `{"$timestamp": true}` and `{"$serverTimestamp": true}` are the server's time, `{"$delete": true}` removes the field (the web SDK's sentinels).
        value.size == 1 && (value["\$timestamp"] != null || value["\$serverTimestamp"] != null) -> com.aglyn.core.ServerTimestamp
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

/**
 * Whether a route refused because the workspace's plan or add-ons leave the feature out (`reason: "entitlement"` on a 403,
 * or a 402), as against a real failure: the screen offers the add-on instead of an error.
 */
internal fun isPlanRefusal(error: ConsoleApiError): Boolean {
  if (error.status == 402) return true
  if (error.status != 403) return false
  val reason = ((error.body as? kotlinx.serialization.json.JsonObject)?.get("reason") as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull
  return reason == "entitlement" || reason == "plan" || reason == "addon"
}
