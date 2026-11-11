package com.aglyn.screens

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * A FORM SAVE IS NEVER PRESSED ON THE CACHE'S COPY, AND NEVER REFUSED FOR IT (AGL-4047), as the console's
 * `useSeedEdits` and `isSeedChecking` keep it. Twin of the Apple `FormEdits`.
 *
 * Two halves, and a form needs both:
 * 1. HOLD SAVE while a load the form is seeded from is only the device cache's answer (`checking.<key>`), with the reason
 *    beside it, so the press comes once the server has answered.
 * 2. KEEP THE EDITS AS EDITS, laid over whatever the data says now. A field the person changed keeps their value through
 *    any fresher answer; every other field follows it, so a held Save never writes the cache's copy of them.
 */
internal object FormEdits {
  /** What a held Save says beside it (`seedCheckingText`), for the form's `checking` subject ("profile"). */
  fun checkingText(subject: String?): String = "Checking your ${subject ?: "settings"} with the server…"

  /** The loads still `checking` that this form reads: its `object`, or any field's `initial`. */
  fun heldBy(objectPath: String?, initials: List<String>, checking: JsonElement?): List<String> {
    val held = checking as? JsonObject ?: return emptyList()
    val texts = listOf(objectPath.orEmpty()) + initials
    return held.keys.sorted().filter { key -> held[key] == JsonPrimitive(true) && texts.any { mentions(it, key) } }
  }

  /** Whether [text] reads `data.<key>` itself, not a longer key that starts with it (`data.site` for `si`). */
  fun mentions(text: String, key: String): Boolean {
    val needle = "data.$key"
    var from = 0
    while (true) {
      val at = text.indexOf(needle, from)
      if (at < 0) return false
      val after = at + needle.length
      if (after == text.length || !(text[after].isLetterOrDigit() || text[after] == '_')) return true
      from = after
    }
  }

  /**
   * The edits left once the form's seed has moved: an edit the seed now shows has landed and follows the seed again, and
   * so does one the last Save wrote (a phone number the write formatted). Anything typed since is kept.
   */
  fun settled(edits: Map<String, FieldValue>, pressed: Map<String, FieldValue>?, seed: Map<String, FieldValue>): Map<String, FieldValue> =
    edits.filter { (key, value) -> value != seed[key] && value != pressed?.get(key) }
}
