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
  val confirm: String? = json.str("confirm")
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
  val reload: Boolean = !json.isFalse("reload") && (url != null || json.obj("write") != null)
  val whenCondition: String? = json.str("when")
  val link: String? = json.str("link")
  /** A Besigner path (whole, from the console root) opened in the app's web view. */
  val besigner: String? = json.str("besigner")
  val copy: String? = json.str("copy")
  val reveal: String? = json.str("reveal")
  val otherwise: ActionSpec? = json.obj("else")?.let { parse(it) }
  /** A follow-up the action makes once it succeeds (best effort, like the console's). */
  val then: ActionSpec? = json.obj("then")?.let { parse(it) }
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
