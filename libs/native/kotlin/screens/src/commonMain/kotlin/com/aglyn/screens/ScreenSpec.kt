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
  val links: List<String> = raw.arr("links").mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
  /** Core screens' zones this plugin screen contributes to (`orgMember`, `staffOrg`, …). */
  val zones: List<String> = raw.arr("zones").mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
  val loads: List<LoadSpec> = raw.entries("load").map { (key, value) -> LoadSpec(key, value) }
  val blocks: List<BlockSpec> = raw.arr("blocks").mapNotNull { block -> block.str("type")?.let { BlockSpec(it, block) } }
  val actions: List<ActionSpec> = raw.arr("actions").mapNotNull { ActionSpec.parse(it) }
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
  val items: String? = json.str("items")
  /** `POST` for a route that answers reads by POST (with `body`); GET otherwise. */
  val method: ApiMethod = runCatching { ApiMethod.valueOf((json.str("method") ?: "GET").uppercase()) }.getOrDefault(ApiMethod.GET)
  val body: JsonElement? = json.obj("body")
  /** A load whose failure leaves its key null instead of failing the screen. */
  val optional: Boolean = json.isTrue("optional")
  /** A Firestore document path to read instead of a route. */
  val doc: String? = json.str("doc")
  /** A Firestore collection query to read instead of a route. */
  val query: JsonElement? = json.obj("query")
  /** `org` or `site`: the plugin switchboard's rows ([SwitchboardRows]). */
  val switchboard: String? = json.str("switchboard")
}

class BlockSpec(val type: String, val raw: JsonElement) {
  val title: String? = raw.str("title")
  val footer: String? = raw.str("footer")
  val whenCondition: String? = raw.str("when")
  val id: String = raw.str("id") ?: "$type:${title.orEmpty()}"
  operator fun get(key: String): JsonElement? = raw.obj(key)
  fun string(key: String): String? = raw.str(key)
  fun flag(key: String): Boolean = raw.isTrue(key)
}

class NavigateSpec(val screen: String, val params: Map<String, String>)

class ActionSpec private constructor(json: JsonElement, val label: String) {
  val id: String = json.str("id") ?: label
  val icon: String? = materialIcon(json.str("icon"))
  val method: ApiMethod = runCatching { ApiMethod.valueOf((json.str("method") ?: "POST").uppercase()) }.getOrDefault(ApiMethod.POST)
  val url: String? = json.str("url")
  val body: JsonElement? = json.obj("body")
  /**
   * Request headers, name to template. `{attempt}` is a key that stays the same while the same
   * action sends the same body (a retry) and changes with the body: `Idempotency-Key` for a
   * route that provisions something (enterprise billing).
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
  val success: String? = json.str("success")
  val openUrl: String? = json.str("open")
  val navigate: NavigateSpec? = json.obj("navigate")?.let { nav ->
    nav.str("screen")?.let { screen ->
      NavigateSpec(screen, nav.entries("params").associate { (k, v) -> k to ((v as? JsonPrimitive)?.contentOrNull ?: ScreenValues.text(v)) })
    }
  }
  val back: Boolean = json.isTrue("back")
  val reload: Boolean = !json.isFalse("reload") && (url != null || json.obj("write") != null || json.str("account") != null)
  val whenCondition: String? = json.str("when")
  val link: String? = json.str("link")
  /** A Besigner path (whole, from the console root) opened in the app's web view. */
  val besigner: String? = json.str("besigner")
  val copy: String? = json.str("copy")
  val reveal: String? = json.str("reveal")
  val otherwise: ActionSpec? = json.obj("else")?.let { parse(it) }
  /** A follow-up the action makes once it succeeds (best effort, like the console's). */
  val then: ActionSpec? = json.obj("then")?.let { parse(it) }
  /** A change to the signed-in person's own sign-in, made through the session (`changePassword`, `updateDisplayName`); its inputs are the body. */
  val account: String? = json.str("account")
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

  /** Every field the action asks for before it runs: its prompt, then a reason. */
  val inputs: List<FieldSpec>
    get() = if (reason) prompt + FieldSpec.reason() else prompt

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
) {
  /** Whether a value leaves this field unfinished: required and empty, or not the text it must match. */
  fun unmet(value: JsonElement, context: JsonElement): Boolean {
    if (mustMatch != null && ScreenValues.text(value) != ScreenValues.render(mustMatch, context)) return true
    return required && kind != "toggle" && !ScreenValues.truthy(value)
  }

  fun choices(context: JsonElement): List<Pair<String, String>> {
    val from = optionsFrom ?: return options
    val path = from.str("items") ?: return options
    val valueTemplate = from.str("value") ?: "{item.\$id}"
    val labelTemplate = from.str("label") ?: valueTemplate
    val rows = (ScreenValues.lookup(path, context) as? JsonArray) ?: emptyList()
    return options + rows.map { row ->
      val scope = ScreenContext.withItem(context, row)
      ScreenValues.render(valueTemplate, scope) to ScreenValues.render(labelTemplate, scope)
    }
  }

  companion object {
    fun reason() = FieldSpec("reason", "Reason", "multiline", null, null, "Recorded in the audit log.", true, emptyList(), null, null)

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
      )
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
