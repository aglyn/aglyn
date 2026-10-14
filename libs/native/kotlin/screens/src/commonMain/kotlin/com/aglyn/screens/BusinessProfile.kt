package com.aglyn.screens

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * The business profile's write rule, as the console applies it when the owner saves the card
 * (`businessProfileOwnerWrite` in `business-profile-values.ts`): what the owner typed is theirs, so a field
 * they changed is recorded as `owner`, while one they left alone keeps the source it had (`start`, `ai`).
 * Twin of the Apple `BusinessProfile`; both replay `businessProfileOwnerWrite` from
 * `libs/native/contracts/function-cases.generated.json`.
 */
internal object BusinessProfile {
  val fields = listOf("whatYouDo", "services", "serviceArea", "audience", "tone", "toneNotes")
  private val maxChars = mapOf("whatYouDo" to 200, "services" to 60, "serviceArea" to 120, "audience" to 160, "toneNotes" to 200)
  private const val MAX_SERVICES = 12
  private val tones = listOf("friendly", "professional", "playful", "premium", "plain")
  private val ranked = listOf("ai", "start", "owner")

  /** A string with its runs of whitespace made one space, trimmed and cut to [max]; anything else is "". */
  fun text(value: JsonElement?, max: Int): String {
    val raw = (value as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return ""
    return raw.split(Regex("\\s+")).filter { it.isNotEmpty() }.joinToString(" ").take(max)
  }

  /** Service names from a list, or from text split on commas and newlines: cleaned, once each (any case), at most 12. */
  fun services(value: JsonElement?): List<String> {
    val items: List<JsonElement> = when {
      value is JsonArray -> value
      value is JsonPrimitive && value.isString -> value.content.split(',', '\n').map { JsonPrimitive(it) }
      else -> emptyList()
    }
    val seen = mutableSetOf<String>()
    val kept = mutableListOf<String>()
    for (item in items) {
      val name = text(item, maxChars.getValue("services"))
      val key = name.lowercase()
      if (name.isEmpty() || key in seen) continue
      seen += key
      kept += name
      if (kept.size >= MAX_SERVICES) break
    }
    return kept
  }

  /** One field of a document as the rule reads it: cleaned, with a tone it does not know as null. */
  fun value(doc: JsonElement?, field: String): JsonElement {
    val raw = (doc as? JsonObject)?.get(field)
    return when (field) {
      "services" -> JsonArray(services(raw).map { JsonPrimitive(it) })
      "tone" -> (raw as? JsonPrimitive)?.takeIf { it.isString && it.content in tones } ?: JsonNull
      else -> JsonPrimitive(text(raw, maxChars.getValue(field)))
    }
  }

  fun isEmpty(value: JsonElement): Boolean = when (value) {
    JsonNull -> true
    is JsonPrimitive -> value.isString && value.content.isEmpty()
    is JsonArray -> value.isEmpty()
    else -> false
  }

  /** Where a field's value came from: null when empty, else its recorded source, `owner` where none is recorded. */
  fun sourceOf(doc: JsonElement?, field: String): String? {
    if (isEmpty(value(doc, field))) return null
    val source = (((doc as? JsonObject)?.get("sources") as? JsonObject)?.get(field) as? JsonPrimitive)?.contentOrNull
    return if (source != null && source in ranked) source else "owner"
  }

  /** The document the owner's save writes: every field cleaned, and `sources` saying whose each now is. */
  fun ownerWrite(current: JsonElement?, edited: JsonElement): Map<String, JsonElement> {
    val next = linkedMapOf<String, JsonElement>()
    val sources = linkedMapOf<String, JsonElement>()
    val editedFields = (edited as? JsonObject) ?: JsonObject(emptyMap())
    for (field in fields) {
      val before = value(current, field)
      val after = if (editedFields.containsKey(field)) value(edited, field) else before
      next[field] = after
      val same = before == after
      if (isEmpty(after)) {
        // A suggestion the owner deleted is their decision, recorded so the next prefill does not put it back.
        val recorded = (((current as? JsonObject)?.get("sources") as? JsonObject)?.get(field) as? JsonPrimitive)?.contentOrNull
        if (!same || recorded == "owner") sources[field] = JsonPrimitive("owner")
        continue
      }
      sources[field] = JsonPrimitive(if (same) sourceOf(current, field) ?: "owner" else "owner")
    }
    next["sources"] = JsonObject(sources)
    return next
  }
}
