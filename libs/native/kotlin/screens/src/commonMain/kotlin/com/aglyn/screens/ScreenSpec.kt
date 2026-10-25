package com.aglyn.screens

import com.aglyn.core.ApiMethod
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

internal fun JsonElement?.obj(key: String): JsonElement? = (this as? JsonObject)?.get(key)
internal fun JsonElement?.str(key: String): String? = (obj(key) as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
internal fun JsonElement?.arr(key: String): List<JsonElement> = (obj(key) as? JsonArray) ?: emptyList()
internal fun JsonElement?.isTrue(key: String): Boolean = (obj(key) as? JsonPrimitive)?.let { !it.isString && it.content == "true" } == true
internal fun JsonElement?.isFalse(key: String): Boolean = (obj(key) as? JsonPrimitive)?.let { !it.isString && it.content == "false" } == true
internal fun JsonElement?.entries(key: String): List<Pair<String, JsonElement>> =
  ((obj(key) as? JsonObject)?.entries?.sortedBy { it.key }?.map { it.key to it.value }) ?: emptyList()

/** The Material Symbol half of a spec's `icon` (`"sf.symbol|material_name"`). */
internal fun materialIcon(raw: String?): String? = raw?.split('|')?.getOrNull(1)?.takeIf { it.isNotEmpty() }

/**
 * A console screen as data: what it loads from the console's own API routes,
 * what it shows, and which routes its actions call. Twin of the Apple
 * `ScreenSpec`; the grammar is in docs/mobile/native-architecture.md §13.
 */
class ScreenSpec private constructor(val raw: JsonElement) {
  val id: String = raw.str("id")!!
  val title: String = raw.str("title")!!
  val icon: String = materialIcon(raw.str("icon")) ?: "extension"
  val scope: String = raw.str("scope") ?: "org"
  val group: String? = raw.str("group")
  val order: Int = (raw.obj("order") as? JsonPrimitive)?.content?.toDoubleOrNull()?.toInt() ?: 100
  val subtitle: String? = raw.str("subtitle")
  /** The plain name a sidebar or app bar shows: `label`, else a title without templates. */
  val label: String = raw.str("label") ?: title.takeIf { '{' !in it } ?: "Details"
  val requires: String? = raw.str("requires")
  /**
   * For a screen that sits in a zone: a condition over the screen's own loads. The zone reads those loads and lists the row only
   * while the condition holds, as a console widget that draws nothing for a store it has nothing to say to.
   */
  val showWhen: String? = raw.str("showWhen")
  val links: List<String> = raw.arr("links").mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
  /** Core screens' zones this plugin screen contributes to (`orgMember`, `staffOrg`, …). */
  val zones: List<String> = raw.arr("zones").mapNotNull { (it as? JsonPrimitive)?.contentOrNull }

  /**
   * A core page's slot (`hostSettings`) this screen also puts a one-row card in, which opens the screen: the native twin
   * of the console's `registerConsoleExtension` widget for a plugin whose settings are a whole screen. The card is a
   * widget named `<screen id>.card`, so the page that hosts the slot draws it without naming the plugin.
   */
  val cardSlot: String? = raw.str("cardSlot")
  val loads: List<LoadSpec> = raw.entries("load").map { (key, value) -> LoadSpec(key, value) }
  val blocks: List<BlockSpec> = BlockSpec.distinct(raw.arr("blocks").mapNotNull { block -> block.str("type")?.let { BlockSpec(it, block) } })
  val actions: List<ActionSpec> = raw.arr("actions").mapNotNull { ActionSpec.parse(it) }
  /** The `actions` entry the screen runs as it opens, once its data has loaded and the action's `when` holds (`start: { "action": "reviewLinked" }`): a link that carries a query (`?notice=`) opens the dialog it names. */
  val startAction: String? = raw.obj("start").str("action")
  /** `{ when, load, action }`: what this contributed screen does once a core action that names its zone (`afterZone`) has succeeded, and its `when` holds: the `load` is read, then the `action` runs over it. */
  val hook: JsonElement? = raw.obj("hook")
  val requiresSite: Boolean get() = scope == "site"

  companion object {
    fun parse(json: JsonElement): ScreenSpec? = if (json.str("id") != null && json.str("title") != null) ScreenSpec(json) else null

    /** A spec file: `{ "screens": [ … ] }`. */
    fun parseFile(text: String): List<ScreenSpec> =
      runCatching { Json.parseToJsonElement(text) }.getOrNull().arr("screens").mapNotNull { parse(it) }
  }
}

class LoadSpec(val key: String, json: JsonElement) {
  val url: String = (json as? JsonPrimitive)?.contentOrNull ?: json.str("url").orEmpty()
  val whenCondition: String? = json.str("when")
  val cursor: String? = json.str("cursor")
  val cursorParam: String = json.str("cursorParam") ?: "cursor"
  /** The query parameter the route reads search words from (`search` unless the route names it otherwise). */
  val searchParam: String = json.str("searchParam") ?: "search"
  val items: String? = json.str("items")
  /** `POST` for a route that answers reads by POST (with `body`); GET otherwise. */
  val method: ApiMethod = runCatching { ApiMethod.valueOf((json.str("method") ?: "GET").uppercase()) }.getOrDefault(ApiMethod.GET)
  val body: JsonElement? = json.obj("body")
  /** A load whose failure leaves its key null instead of failing the screen. */
  val optional: Boolean = json.isTrue("optional")
  /** The staff list routes' `filters`: `{ field, op, value }` clauses, each kept when its value template is not empty. */
  val filters: List<JsonElement> = json.arr("filters")
  /** Statuses whose body is the answer, not a failure: a health probe answers 503 when it reports degraded. */
  val accept: List<Int> = json.arr("accept").mapNotNull { (it as? JsonPrimitive)?.content?.toDoubleOrNull()?.toInt() }
  /** A Firestore document path to read instead of a route. */
  val doc: String? = json.str("doc")
  /** A Firestore collection query to read instead of a route. */
  val query: JsonElement? = json.obj("query")
  /** `org` or `site`: the plugin switchboard's rows ([SwitchboardRows]). */
  val switchboard: String? = json.str("switchboard")
  /** A plan feature whose gate the screen reads: `{ carried, label }`, where `label` names the plan that includes it. */
  val entitlement: String? = json.str("entitlement")
  /** `marketplace`: the take rate on the workspace's marketplace sales, `{ pct, paid }` (`paid` is what a paid plan pays), as the console's `resolveMarketplaceFeePct` prices it from the workspace's own document. */
  val takeRate: String? = json.str("takeRate")
  /** An order id (a template): the order as a widget is handed it, with its lines' units and what is left to ship. */
  val orderZone: String? = json.str("orderZone")
  /** Runs once the other loads have answered, with their answers under `data`: a read keyed by something another read found. */
  val late: Boolean = json.isTrue("late")
  /**
   * The query parameter a staff list route orders by (`sort=<path>:<dir>`), and the order it answers when none was asked. A list's
   * `route` columns ask for the others.
   */
  val sortParam: String? = json.str("sortParam")
  val sortDefault: String? = json.str("sortDefault")
  /**
   * For a Firestore `query` that returned its whole `limit`: how many more rows each "Load more" reads (the query's own limit when
   * absent). The query is read again with the larger limit, so a collection too big for one read can still be gone through to its end.
   */
  val more: Int? = ScreenValues.number(json.obj("more"))?.toInt()
  /**
   * A path to rows an earlier load brought (`data.sites.sites`): this load then runs once per row, with the row
   * as `item`, and its key holds the list of answers (a failed one is null).
   */
  val each: String? = json.str("each")
  /** A pure function to call over data already loaded (`packageJsonDiff`, `packageMergeKeys`), its answer under this key; [args] are the paths (or numbers) it is given. */
  val compute: String? = json.str("compute")
  val args: List<String> = json.arr("args").mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
  /**
   * A value worked out from other loads once they have answered, not read from anywhere: `shippingCoverage`, from the
   * shipping settings the [from] path (a path under `data`) finds.
   */
  val derive: String? = json.str("derive")
  val from: String? = json.str("from")
}

class BlockSpec(val type: String, val raw: JsonElement, idOverride: String? = null) {
  val title: String? = raw.str("title")
  val footer: String? = raw.str("footer")
  val whenCondition: String? = raw.str("when")
  /**
   * The block's `id`, else `type:title`; a repeat of an earlier block's gets `#2`, `#3` in spec order, so two untitled
   * notices shown at once are two items (a lazy list refuses a key used twice), not one.
   */
  val id: String = idOverride ?: raw.str("id") ?: "$type:${title.orEmpty()}"

  companion object {
    /** The blocks with every id unique: a repeated one is numbered after its first. */
    fun distinct(blocks: List<BlockSpec>): List<BlockSpec> {
      val seen = mutableMapOf<String, Int>()
      return blocks.map { block ->
        val count = (seen[block.id] ?: 0) + 1
        seen[block.id] = count
        if (count > 1) BlockSpec(block.type, block.raw, "${block.id}#$count") else block
      }
    }
  }
  operator fun get(key: String): JsonElement? = raw.obj(key)
  fun string(key: String): String? = raw.str(key)
  fun flag(key: String): Boolean = raw.isTrue(key)
}

/** Where in a route's answer a support session's custom token and identity pool are. */
class ImpersonateSpec private constructor(val token: String, val tenantId: String?) {
  /** The token and pool a route answered, or null when it named no token. */
  fun resolve(response: JsonElement?): Pair<String, String?>? {
    val answer = response ?: JsonNull
    val found = (ScreenValues.lookup(token, answer) as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotEmpty() } ?: return null
    val pool = tenantId?.let { (ScreenValues.lookup(it, answer) as? JsonPrimitive)?.contentOrNull }?.takeIf { it.isNotEmpty() }
    return found to pool
  }

  companion object {
    fun parse(json: JsonElement): ImpersonateSpec? = json.str("token")?.let { ImpersonateSpec(it, json.str("tenantId")) }
  }
}

/**
 * `{ name, type, from }`: the file an action hands to the device. `name` is a template, `type` a MIME type, and `from`
 * the path (over the screen's context and the route's `response`) of the text that is the file.
 */
class FileSpec(val name: String, val type: String, val from: String) {
  /** The file name and the text, or null when there is nothing to hand over. */
  fun contents(context: JsonElement): Pair<String, String>? {
    val text = ScreenValues.text(ScreenValues.lookup(from, context))
    return if (text.isEmpty()) null else ScreenValues.render(name, context) to text
  }

  companion object {
    fun parse(json: JsonElement): FileSpec? {
      val name = json.str("name") ?: return null
      val from = json.str("from") ?: return null
      return FileSpec(name, json.str("type") ?: "text/plain", from)
    }
  }
}

/**
 * One line of an action's report. `each` repeats it for every row of a list or entry of a map (`item`); `when` drops it (for a
 * repeated line, row by row). In a `log`, `confirmed` is the condition for the line to read as verified (default: it does).
 */
class ReportLine(val text: String, val whenCondition: String?, val each: String?, val confirmed: String? = null) {
  companion object {
    fun parse(json: JsonElement): ReportLine? {
      (json as? JsonPrimitive)?.takeIf { it.isString }?.let { return ReportLine(it.content, null, null) }
      return json.str("text")?.let { ReportLine(it, json.str("when"), json.str("each"), json.str("confirmed")) }
    }
  }
}

/** A route that works in pages: the request repeats, with the cursor it answered, until it says it is done. */
class LoopSpec(json: JsonElement) {
  /** The response field holding the next cursor. */
  val cursor: String = json.str("cursor") ?: "nextCursor"
  /** The body field the cursor goes back in. */
  val param: String = json.str("param") ?: "cursor"
  /** The response field that is true on the last page. */
  val until: String? = json.str("until")
  /** Pages at most. */
  val max: Int = (json.obj("max") as? JsonPrimitive)?.content?.toDoubleOrNull()?.toInt() ?: 40
}

class NavigateSpec(val screen: String, val params: Map<String, String>)

/** What an `export` action opens the export dialog on: the resource, the dialog's title, the site (none: the workspace), the file's
 * name, which records (`{ kind: all }` or a filter) and the narrowed field list. */
class ExportRequest(
  val resource: String,
  val title: String,
  val hostId: String?,
  val fileStem: String,
  val scope: Map<String, Any?> = mapOf("kind" to "all"),
  val filter: Map<String, Any?>? = null,
)

class ActionSpec private constructor(json: JsonElement, val label: String) {
  val id: String = json.str("id") ?: label
  val icon: String? = materialIcon(json.str("icon"))
  val method: ApiMethod = runCatching { ApiMethod.valueOf((json.str("method") ?: "POST").uppercase()) }.getOrDefault(ApiMethod.POST)
  val url: String? = json.str("url")
  val body: JsonElement? = json.obj("body")
  /** A staff list route's `filters` for a GET action (the audit log's CSV export): `{ field, op, value }` clauses, each kept when its value template is not empty, as a load's are. */
  val filters: List<JsonElement> = json.arr("filters")
  /**
   * Request headers, name to template. `{attempt}` is a key that stays the same while the same
   * action sends the same body (a retry) and changes with the body: `Idempotency-Key` for a
   * route that provisions something (enterprise billing). A route that wants the key in its body
   * (`idempotencyKey`) writes `{attempt}` there and gets the same key.
   */
  val headers: Map<String, String> = json.entries("headers").associate { (k, v) -> k to ((v as? JsonPrimitive)?.contentOrNull ?: ScreenValues.text(v)) }
  val confirm: String? = json.str("confirm")
  /** A confirmation built from segments, `[{ "when": …, "text": … }]`, joined in order, so one sentence can change with the route's answer. */
  val confirmParts: List<JsonElement> = (json.obj("confirm") as? JsonArray).orEmpty()
  /** When set, the confirmation is asked only while this condition holds. */
  val confirmWhen: String? = json.str("confirmWhen")
  val destructive: Boolean = json.isTrue("destructive")
  val reason: Boolean = json.isTrue("reason")
  val prompt: List<FieldSpec> = json.arr("prompt").mapNotNull { FieldSpec.parse(it) }
  private val promptRaw: List<JsonElement> = json.arr("prompt")
  val success: String? = json.str("success")
  /** A prompt dialog's own title (`Edit category`) and its button (`Save`), where the action's label (`Edit`) would say neither. */
  val promptTitle: String? = json.str("promptTitle")
  val submitLabel: String? = json.str("submitLabel")
  val openUrl: String? = json.str("open")
  val navigate: NavigateSpec? = json.obj("navigate")?.let { nav ->
    nav.str("screen")?.let { screen ->
      NavigateSpec(screen, nav.entries("params").associate { (k, v) -> k to ((v as? JsonPrimitive)?.contentOrNull ?: ScreenValues.text(v)) })
    }
  }
  val back: Boolean = json.isTrue("back")

  /**
   * True when this action only narrows or re-reads [screenId] (it reopens that same screen with new params) or
   * edits one stored setting (PUT or PATCH). Neither is the screen's main act, so a toolbar draws it as a quiet
   * outlined button like the kit's other filters, never as the filled primary.
   */
  fun quietOn(screenId: String): Boolean = navigate?.screen == screenId || method == ApiMethod.PUT || method == ApiMethod.PATCH
  val reload: Boolean =
    json.isTrue("reload") ||
      (!json.isFalse("reload") && (url != null || json.obj("write") != null || json.str("account") != null || json.obj("passkey") != null))
  val whenCondition: String? = json.str("when")
  val link: String? = json.str("link")
  /** A Besigner path (whole, from the console root) opened in the app's web view. */
  val besigner: String? = json.str("besigner")
  /** A console path (a route's `href`) followed the way a notification's link is: the native screen that claims it. */
  val route: String? = json.str("route")
  val copy: String? = json.str("copy")
  /**
   * A Firestore document path (a template): the stored document is read when the action runs and is `overlay` in the body,
   * without its timestamps, for a route that replaces the document with the person's edits on top (`$overlay`).
   */
  val overlay: String? = json.str("overlay")
  val reveal: String? = json.str("reveal")
  val otherwise: ActionSpec? = json.obj("else")?.let { parse(it) }
  /** The status of the answer that runs `else` (404 unless the spec names another, such as 409). */
  val elseStatus: Int = ((json.obj("elseStatus") as? JsonPrimitive)?.contentOrNull)?.toIntOrNull() ?: 404
  /** `gate: { when, screen }`: when the route refuses with a body that meets `when` (read as `error`), `screen` opens over this one and, once it reports `resume`, the very same action is sent again (the console's publisher agreement gate). */
  val gate: JsonElement? = json.obj("gate")
  /** This action, finishing inside a gate's screen, tells the screen below to send its action again. */
  val resume: Boolean = json.isTrue("resume")
  /** `afterZone: { zone, stash }`: once the action has succeeded, the `hook` of every screen contributed to `zone` whose `requires` holds runs (best effort, in order); what they say is kept as `stash.<stash>` for the screen that follows. */
  val afterZone: JsonElement? = json.obj("afterZone")
  /** A follow-up the action makes once it succeeds (best effort, like the console's). */
  val then: ActionSpec? = json.obj("then")?.let { parse(it) }
  /** A change to the signed-in person's own sign-in, made through the session (`changePassword`, `updateDisplayName`); its inputs are the body. */
  val account: String? = json.str("account")

  /** The route answers with a file (an export), not JSON; the person saves it. Its value names the file when the route names none. */
  val download: String? = json.str("download") ?: if (json.isTrue("download")) "download" else null
  /** `export: { resource, title, hostId, fileStem, scope, filter }`: the platform's export dialog for a transfer resource (`commerce.products`, `crm.contacts`): its fields, the format, then the file saved or shared, as every list opens it. Each is a template; see [exportRequest]. */
  val export: JsonElement? = json.obj("export")
  /** `chunk: { field, bytes, idFrom, idKey, firstOnly, until }`: the file text in `field` of the body goes in parts of at most `bytes` (JSON-encoded), each with `part` and `parts`, the job the first answer names (`idFrom`) sent back as `idKey`; keys in `firstOnly` ride on the first part alone; `until` is the answer path that must be true when the last part has landed. */
  val chunk: JsonElement? = json.obj("chunk")
  /** `repeat: { until, max, stop, stopMessage }`: the action runs again while its answer does not meet `until` (a condition over `response`), as the console calls apply until the route says it is done; the stash takes every pass's answer, so a screen can show the progress; `stop` ends it as a failure. */
  val repeating: JsonElement? = json.obj("repeat")
  /** A follow-up that must succeed (unlike `then`): it runs once the action and its stash are done, with the stash and the action's answer in scope, and a failure of its own fails the action. */
  val after: ActionSpec? = json.obj("after")?.let { parse(it) }
  /** The route answers with JSON, and the file is the value at this path of it (a workspace package export wraps its file as `{ fileName, package }`); `download` is then a template over `response` that names the file. */
  val downloadAt: String? = json.str("downloadAt")

  /**
   * `passkey: { options, verify, origin, errors, otherwise }`: sets up a passkey on this device. The options route
   * answers a WebAuthn challenge, the platform makes the credential, and the verify route stores it; `origin` is the
   * `Origin` the routes check the ceremony against (`https://<relying party>`), `errors` maps a route's reason to the
   * words shown and `otherwise` words any other failure.
   */
  val passkey: JsonElement? = json.obj("passkey")
  /**
   * `{ when, title, text }` (or a list of them, the first that matches wins): when the route's answer
   * meets `when`, `text` (a template over `response`) is shown in place of the success message.
   */
  val instead: JsonElement? = json.obj("instead")
  /** A route call made first, whose answer is `preview` in the confirmation (what an add-on change would charge). */
  val check: ActionSpec? = json.obj("check")?.let { parse(it) }

  /** Whether the action asks the person to confirm before it runs. */
  val asksConfirmation: Boolean get() = confirm != null || confirmParts.isNotEmpty()

  /** The confirmation as the person reads it, over [scope]. */
  fun confirmText(scope: JsonElement): String? =
    if (confirmParts.isNotEmpty()) {
      confirmParts.filter { ScreenValues.condition(it.str("when"), scope) }.joinToString("") { ScreenValues.render(it.str("text").orEmpty(), scope) }
    } else {
      confirm?.let { ScreenValues.render(it, scope) }
    }

  /** The `instead` entry the route's answer meets, if any. */
  fun insteadEntry(scope: JsonElement): JsonElement? =
    ((instead as? JsonArray) ?: instead?.let { listOf(it) }.orEmpty()).firstOrNull { ScreenValues.condition(it.str("when"), scope) }
  /** A Firestore merge the signed-in person makes themselves: `{ "doc": "users/{user.uid}", "fields": {...} }`. */
  val write: JsonElement? = json.obj("write")
  /** Lines the result is reported in, after `success`: `{ when, each, text }`, one per line. */
  val report: List<ReportLine> = json.arr("report").mapNotNull { ReportLine.parse(it) }
  /** Hands text to the device as a file (Save, or the share sheet): the working papers' CSV, the audit log's. */
  val file: FileSpec? = json.obj("file")?.let { FileSpec.parse(it) }
  /** Lines a refusal is explained in, after the route's own words, over the route's answer as `response` (the workspaces that still need an owner). */
  val failure: List<ReportLine> = json.arr("failure").mapNotNull { ReportLine.parse(it) }
  /** Repeats the request page by page until the route is done, and answers the totals. */
  val loop: LoopSpec? = json.obj("loop")?.let { LoopSpec(it) }
  /**
   * Lines the screen keeps in its session log (`session.log`, newest first) when the action succeeds, as the console's "Actions taken in
   * this session" does: a lock or lift that reached the server, stamped with when, and verified or not.
   */
  val log: List<ReportLine> = json.arr("log").mapNotNull { ReportLine.parse(it) }
  /** A key the screen remembers as armed (`session.armed.<key>`) once the action succeeds, and forgets if it fails: a preview that has been read. */
  val arm: String? = json.str("arm")
  /** A key the screen forgets once the action succeeds: the run that spends its preview. */
  val disarm: String? = json.str("disarm")
  /**
   * `{ token, tenantId }`: paths in the route's answer. Once the action succeeds the app signs in as the customer with the custom
   * token found at `token` (a support session), in the identity pool named at `tenantId`. The token is a credential: it goes to the
   * session and is shown nowhere.
   */
  val impersonate: ImpersonateSpec? = json.obj("impersonate")?.let { ImpersonateSpec.parse(it) }
  /** `{ key: template }`: values kept for later screens as `stash.<key>` once the action succeeds, until the app closes. */
  val stash: JsonElement? = json.obj("stash")

  /**
   * The export dialog's request (`export: { resource, title, hostId, fileStem, scope, filter }`), with the action's templates read in
   * [scope]; null when the action opens none. `hostId` names the site a site's resource is read for (none: the workspace's); `scope`
   * is `{ "kind": "all" }` unless it names a filter; `fileStem` is the resource key when not given.
   */
  fun exportRequest(scope: JsonElement): ExportRequest? {
    val spec = export ?: return null
    val key = spec.str("resource")?.let { ScreenValues.render(it, scope) }?.takeIf { it.isNotEmpty() } ?: return null
    fun text(name: String) = spec.str(name)?.let { ScreenValues.render(it, scope) }?.takeIf { it.isNotEmpty() }
    @Suppress("UNCHECKED_CAST")
    fun plainMap(name: String) = spec.obj(name)?.let { ScreenModel.plain(ScreenValues.resolveBody(it, scope)) } as? Map<String, Any?>
    return ExportRequest(
      resource = key,
      title = text("title") ?: ScreenValues.render(label, scope),
      hostId = text("hostId"),
      fileStem = text("fileStem") ?: key.replace(':', '-').replace('.', '-'),
      scope = plainMap("scope") ?: mapOf("kind" to "all"),
      filter = plainMap("filter"),
    )
  }

  /** `{ doc, current, edited }`: the owner's save of a business profile (`edited` the typed values, `current` the path to the stored document); the write follows `businessProfileOwnerWrite` of the contracts module. */
  val businessProfile: JsonElement? = json.obj("businessProfile")

  /** After a `write` to the site document that changes how pages render, stage the site-wide republish the console's host-document writes do (`publishSiteWideChange`). */
  val siteWide: Boolean = json.isTrue("siteWide")

  /**
   * Every field the action asks for before it runs: its prompt, with any `fieldsFrom` entry expanded from the data in [scope] and a
   * field with `each` becoming one per row, then a reason.
   */
  fun inputs(scope: JsonElement): List<FieldSpec> {
    val asked = FieldSpec.parseAll(promptRaw, scope).flatMap { it.expanded(scope) }
    return if (reason) asked + FieldSpec.reason() else asked
  }

  /**
   * Whether the action asks for anything before it runs in [scope]: a reason, or a prompt (even one the data fills in), except a
   * prompt made only of `each` fields whose lists are empty there, which has nothing to ask.
   */
  fun asksInputs(scope: JsonElement): Boolean =
    reason || promptRaw.any { (it as? JsonObject)?.get("each") == null } || inputs(scope).isNotEmpty()

  companion object {
    fun parse(json: JsonElement?): ActionSpec? = json?.str("label")?.let { ActionSpec(json, it) }
  }
}

class FieldSpec private constructor(
  val key: String,
  val label: String,
  val kind: String,
  val initial: String?,
  val placeholder: String?,
  val help: String?,
  val required: Boolean,
  val options: List<Pair<String, String>>,
  val optionsFrom: JsonElement?,
  val whenCondition: String?,
  /** A template the typed value must equal (type the workspace name to delete it). */
  val mustMatch: String? = null,
  /** The bounds of a number field; one outside them leaves the field unfinished. */
  val min: Double? = null,
  val max: Double? = null,
  /** A number field that takes whole numbers: what is typed is rounded to one. */
  val integer: Boolean = false,
  /** A regular expression a typed value must contain a match of (an https address); an empty value is left to `required`. */
  val pattern: String? = null,
  /** An `hours` field's options: `{ noun, sameDay, start, end }` (what an interval is called, whether it must end the day it starts, and the times a newly opened day gets). */
  val hours: JsonElement? = null,
  /** `{ length, alphabet }`: the field offers a button that fills it with a random value of that many characters drawn from the alphabet (a template; the console's password generator). */
  val generate: JsonElement? = null,
  /** A list (a path) this field repeats for, one field per row, with `item` the row: the values an email is tested with, a field for each. */
  val each: String? = null,
  /** A `lookup` field's sources: the kinds of record a person can search, and what picking one fills in. */
  val groups: List<LookupGroup> = emptyList(),
  /** `dollars`: the typed value and the template are both read as a dollar amount (`60`, `$60.00`, `1,250 USD`) and compared in cents, as the gift card import's Confirm step reads a typed total. */
  val mustMatchAs: String? = null,
  /** What to say under the field while something is typed that does not match. */
  val mismatch: String? = null,
  /** For a `file` field: `json` parses the chosen file and sends the value, `base64` sends its bytes base64-encoded (a plugin bundle), else its text is sent. */
  val parse: String? = null,
  /** For a `multiselect`: the field is unfinished until every choice is chosen (the warnings an import must have acknowledged, each one). */
  val coversAll: Boolean = false,
  /** The field's own JSON, for a kind that reads more than the common keys (`upload`'s limits). */
  val config: JsonElement? = null,
) {
  /** This field as it is asked: itself, or one per row of its `each` list, its templates rendered over the row. */
  fun expanded(scope: JsonElement): List<FieldSpec> {
    val path = each ?: return listOf(this)
    return ScreenValues.rows(ScreenValues.lookup(path, scope)).map { row ->
      val item = ScreenContext.withItem(scope, row)
      FieldSpec(
        key = ScreenValues.render(key, item),
        label = ScreenValues.render(label, item),
        kind = kind,
        // The initial value is final here, so a brace in it is text and not a template.
        initial = initial?.let { ScreenValues.render(it, item).replace("{", "{{") },
        placeholder = placeholder,
        help = help?.let { ScreenValues.render(it, item) },
        required = required,
        options = options,
        optionsFrom = optionsFrom,
        whenCondition = whenCondition,
        mustMatch = mustMatch,
        generate = generate,
        each = null,
        groups = groups,
      )
    }
  }

  /** What a static option says under its label (`{ value, label, detail }`), a template over the screen. */
  fun detail(value: String, context: JsonElement): String? =
    config.arr("options").firstOrNull { ScreenValues.text(it.obj("value")) == value }?.str("detail")?.takeIf { it.isNotEmpty() }?.let { ScreenValues.render(it, context) }

  /** A fresh value for a field that `generate`s one (`length` and `alphabet` are templates, so a spec can name the console's own constants); null for a field that does not. */
  fun generatedValue(context: JsonElement): String? {
    val spec = generate ?: return null
    val raw = spec.obj("length")
    val length = ((raw as? JsonPrimitive)?.takeIf { it.isString }?.let { ScreenValues.number(ScreenValues.resolve(it.content, context)) } ?: ScreenValues.number(raw))?.toInt() ?: 20
    return ScreenValues.generated(length, ScreenValues.render(spec.str("alphabet").orEmpty(), context))
  }

  /** Whether a value leaves this field unfinished: required and empty, or not the text it must match. */
  fun unmet(value: JsonElement, context: JsonElement): Boolean {
    if (mismatches(value, context)) return true
    if (pattern != null) ScreenValues.text(value).let { typed -> if (typed.isNotEmpty() && !Regex(pattern).containsMatchIn(typed)) return true }
    if (outOfBounds(value)) return true
    if (coversAll && kind == "multiselect") {
      val chosen = ((value as? JsonArray) ?: JsonArray(emptyList())).mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }.toSet()
      if (choices(context).any { it.first !in chosen }) return true
    }
    // A number field is finished by any number, zero too.
    val finished = ScreenValues.truthy(value) || (kind == "number" && ScreenValues.number(value) != null)
    return required && kind != "toggle" && !finished
  }

  /** Whether a number field holds something typed that is not a number, or a number outside its bounds. */
  fun outOfBounds(value: JsonElement): Boolean {
    val typed = ScreenValues.text(value).trim()
    if (kind != "number" || typed.isEmpty()) return false
    val number = typed.toDoubleOrNull() ?: ScreenValues.number(value) ?: return true
    return (min != null && number < min) || (max != null && number > max)
  }

  /**
   * Whether the field's `mismatch` line is said under it: the value is not what it must match, or a number field's value is
   * outside its bounds (`A whole number from 1 to 500`).
   */
  fun refuses(value: JsonElement, context: JsonElement): Boolean = mismatches(value, context) || outOfBounds(value)

  /** Whether a value is not what the field must match (a field with nothing to match never mismatches). */
  fun mismatches(value: JsonElement, context: JsonElement): Boolean {
    if (mustMatch == null) return false
    val typed = ScreenValues.text(value)
    val expected = ScreenValues.render(mustMatch, context)
    if (mustMatchAs == "dollars") {
      val cents = ScreenValues.dollarsToCents(typed) ?: return true
      return cents != ScreenValues.dollarsToCents(expected)
    }
    return typed != expected
  }

  fun choices(context: JsonElement): List<Pair<String, String>> {
    // A `country` field offers the platform's regions after the static options.
    if (kind == "country") return options + isoRegions()
    val from = optionsFrom ?: return options
    val path = from.str("items") ?: return options
    val valueTemplate = from.str("value") ?: "{item.\$id}"
    val labelTemplate = from.str("label") ?: valueTemplate
    // A map (the site's screens by id) offers one choice per entry: `{ $id: key, $value: value }`, by value. A list offers one per
    // row that meets `filter`, or, given `within`, one per row of each row's inner list (the outer row as `parent`).
    val scopes = when (val source = ScreenValues.lookup(path, context)) {
      is JsonObject -> source.entries.map { JsonObject(mapOf("\$id" to JsonPrimitive(it.key), "\$value" to it.value)) }
        .sortedBy { ScreenValues.text(it["\$value"]).lowercase() }.map { ScreenContext.withItem(context, it) }
        .filter { ScreenValues.condition(from.str("filter"), it) }
      else -> ScreenValues.scopes(path, from.str("within"), from.str("filter"), context)
    }
    return options + scopes.map { scope ->
      // A label built from parts that may be empty reads clean: runs of spaces become one, and the ends are trimmed.
      ScreenValues.render(valueTemplate, scope) to ScreenValues.render(labelTemplate, scope).replace(Regex(" {2,}"), " ").trim()
    }
  }

  companion object {
    fun reason() = FieldSpec("reason", "Reason", "multiline", null, null, "Recorded in the audit log.", true, emptyList(), null, null)

    /**
     * Fields from a spec's array, with each `{ "fieldsFrom": {...} }` entry expanded into one field per row of
     * data (a service that names its own credential fields): `items` is the path to the rows; `key`, `label` and
     * `help` are templates over `item`; `kinds` maps a row flag to a field kind (first set flag wins, else text),
     * `yesno` being a No/Yes pick that sends "" or "true"; `options` names the row field holding `{value,label}`
     * choices, which make a select; `required` names the row flag; `kind` is the kind of a row with no flag set and
     * `initial` a template for its starting value; `{index}` in any template is the row's place in the list. With
     * `each` (a list of field templates, their strings rendered per row) every row draws all of them together.
     */
    fun parseAll(items: List<JsonElement>, context: JsonElement): List<FieldSpec> = items.flatMap { entry ->
      val from = entry.obj("fieldsFrom") ?: return@flatMap listOfNotNull(parse(entry))
      val perRow = from.arr("each")
      if (perRow.isNotEmpty()) {
        // `each`: a field template per entry, drawn for every row, so one row's fields sit together.
        return@flatMap ScreenValues.rows(ScreenValues.lookup(from.str("items").orEmpty(), context)).withIndex().flatMap { (position, row) ->
          val scope = ScreenContext.with(ScreenContext.withItem(context, row), "index", JsonPrimitive(position))
          perRow.mapNotNull { template ->
            val rendered = JsonObject(
              (template as? JsonObject).orEmpty().mapValues { (_, value) ->
                if (value is JsonPrimitive && value.isString) JsonPrimitive(ScreenValues.render(value.content, scope)) else value
              },
            )
            parse(rendered)
          }
        }
      }
      ScreenValues.rows(ScreenValues.lookup(from.str("items").orEmpty(), context)).withIndex().mapNotNull { (position, row) ->
        // `{index}` is the row's place in the list, for a key that names the row by position.
        val scope = ScreenContext.with(ScreenContext.withItem(context, row), "index", JsonPrimitive(position))
        val key = ScreenValues.render(from.str("key") ?: "{item.key}", scope).ifEmpty { return@mapNotNull null }
        val choices = row.arr(from.str("options") ?: "options").map { ScreenValues.text(it.obj("value")) to ScreenValues.text(it.obj("label") ?: it.obj("value")) }
        val flagged = (from.obj("kinds") as? JsonObject)?.entries.orEmpty().sortedBy { it.key }.firstOrNull { ScreenValues.truthy(ScreenValues.lookup(it.key, row)) }?.value
        val kind = (flagged as? JsonPrimitive)?.contentOrNull
        FieldSpec(
          key = key,
          label = ScreenValues.render(from.str("label") ?: "{item.label}", scope),
          kind = when {
            kind == "yesno" || choices.isNotEmpty() -> "select"
            else -> kind ?: from.str("kind") ?: "text"
          },
          initial = if (kind == "yesno") null else choices.firstOrNull()?.first ?: from.str("initial"),
          placeholder = null,
          help = from.str("help")?.let { ScreenValues.render(it, scope) }?.takeIf { it.isNotEmpty() },
          required = from.str("required")?.let { ScreenValues.truthy(ScreenValues.lookup(it, row)) } ?: false,
          options = if (kind == "yesno") listOf("" to "No", "true" to "Yes") else choices,
          optionsFrom = null,
          whenCondition = null,
        )
      }
    }

    fun parse(json: JsonElement): FieldSpec? {
      val key = json.str("key") ?: return null
      return FieldSpec(
        key = key,
        label = json.str("label") ?: key,
        kind = json.str("kind") ?: "text",
        initial = json.str("initial"),
        placeholder = json.str("placeholder"),
        help = json.str("help"),
        required = json.isTrue("required"),
        options = json.arr("options").map { option ->
          if (option is JsonPrimitive) option.content to option.content.replaceFirstChar { it.uppercase() }
          else ScreenValues.text(option.obj("value")) to ScreenValues.text(option.obj("label") ?: option.obj("value"))
        },
        optionsFrom = json.obj("optionsFrom"),
        whenCondition = json.str("when"),
        mustMatch = json.str("mustMatch"),
        min = ScreenValues.number(json.obj("min")),
        max = ScreenValues.number(json.obj("max")),
        integer = json.isTrue("integer"),
        pattern = json.str("pattern"),
        hours = json.obj("hours"),
        generate = json.obj("generate"),
        each = json.str("each"),
        groups = json.arr("groups").mapNotNull { LookupGroup.parse(it) },
        mustMatchAs = json.str("mustMatchAs"),
        mismatch = json.str("mismatch"),
        parse = json.str("parse"),
        coversAll = json.isTrue("coversAll"),
        config = json,
      )
    }
  }
}

/**
 * One kind of record a `lookup` field searches (the system email test's "Populate from": workspaces, sites, people), and the
 * form fields picking one fills in. The route searches by the `search` word, as a list's search does.
 */
class LookupGroup private constructor(
  val id: String,
  val label: String,
  /** The route that lists the records; the words typed go on as `search`. */
  val url: String,
  /** The path in the answer of the list of records. */
  val items: String,
  val title: String,
  val subtitle: String?,
  /** Form fields set from the picked record, whatever it holds: the key is the field's key, the value a template over `item`. */
  val fill: List<Pair<String, String>>,
  /** The same, but only when the template comes out with something (the person's address, as the recipient). */
  val fillWhenSet: List<Pair<String, String>>,
) {
  /** The route to ask for the words typed (blank lists the first few). */
  fun request(words: String): String {
    val trimmed = words.trim()
    if (trimmed.isEmpty()) return url
    return url + (if ('?' in url) "&" else "?") + "search=" + ScreenValues.encodeComponent(trimmed)
  }

  /** The records an answer holds. */
  fun rows(response: JsonElement?): List<JsonElement> = ScreenValues.rows(response?.let { ScreenValues.lookup(items, it) })

  fun heading(row: JsonElement, context: JsonElement): String = ScreenValues.render(title, ScreenContext.withItem(context, row))

  fun detail(row: JsonElement, context: JsonElement): String? =
    subtitle?.let { ScreenValues.render(it, ScreenContext.withItem(context, row)) }?.takeIf { it.isNotEmpty() }

  /**
   * What picking [row] writes into the form: every `fill` entry, then the `fillWhenSet` entries that came out non-blank, for the
   * fields the form has ([keys]): a template that takes no `org.id` has no field for it.
   */
  fun fills(row: JsonElement, context: JsonElement, keys: Set<String>): List<Pair<String, String>> {
    val scope = ScreenContext.withItem(context, row)
    val always = fill.map { it.first to ScreenValues.render(it.second, scope) }
    val sometimes = fillWhenSet.map { it.first to ScreenValues.render(it.second, scope) }.filter { it.second.isNotEmpty() }
    return (always + sometimes).filter { it.first in keys }
  }

  companion object {
    fun parse(json: JsonElement): LookupGroup? {
      val id = json.str("id") ?: return null
      val url = json.str("url") ?: return null
      val items = json.str("items") ?: return null
      val title = json.str("title") ?: return null
      fun entries(key: String) = json.entries(key).mapNotNull { (name, value) -> (value as? JsonPrimitive)?.takeIf { it.isString }?.content?.let { name to it } }
      return LookupGroup(id, json.str("label") ?: id, url, items, title, json.str("subtitle"), entries("fill"), entries("fillWhenSet"))
    }
  }
}

object ScreenContext {
  /** The context with `item` set to one row (and `parent` to the outer item). */
  fun withItem(context: JsonElement, item: JsonElement): JsonElement {
    val record = (context as? JsonObject)?.toMutableMap() ?: return context
    record["item"]?.let { record["parent"] = it }
    record["item"] = item
    return JsonObject(record)
  }

  fun with(context: JsonElement, key: String, value: JsonElement?): JsonElement {
    val record = (context as? JsonObject)?.toMutableMap() ?: return context
    record[key] = value ?: JsonNull
    return JsonObject(record)
  }
}
