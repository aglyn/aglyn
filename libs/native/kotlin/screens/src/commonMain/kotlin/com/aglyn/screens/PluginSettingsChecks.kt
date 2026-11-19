// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.screens

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/**
 * A plugin settings form's pre-save check, as the console's settings card runs its schema's `validate` before a save.
 * A form's `refuse` entry names one (`{ "check": "weglot" }`, written by the generator from the schema); its answer is
 * said beside Save, which it holds back. The console's answers to every rule are recorded in
 * `libs/native/contracts/plugin-settings-check-cases.generated.json`, and the tests replay them.
 */
object PluginSettingsChecks {
  /** The refusal for [check] over the values the form will save, or null when it may be saved (or the check is unknown). */
  fun refusal(check: String, values: Map<String, JsonElement>): String? = when (check) {
    "weglot" -> weglot(values)
    else -> null
  }

  /**
   * The values a form's check is asked over. On a site ([site]) they are the ones it will RUN with: each field its own
   * override where it has one (`ov_<field>` on), else the workspace's (`data.org`), else the default (`const.defaults`),
   * as the console's site card checks them.
   */
  fun values(filled: JsonElement, site: Boolean): Map<String, JsonElement> {
    val form = (filled as? JsonObject)?.get("form") as? JsonObject ?: return emptyMap()
    if (!site) return form
    val org = ScreenValues.lookup("data.org", filled) as? JsonObject ?: JsonObject(emptyMap())
    val defaults = ScreenValues.lookup("const.defaults", filled) as? JsonObject ?: JsonObject(emptyMap())
    val keys = form.keys.filterNot { it.startsWith("ov_") }.toSet() + org.keys + defaults.keys
    return keys.associateWith { key ->
      if ((form["ov_$key"] as? JsonPrimitive)?.booleanOrNull == true) form[key] ?: JsonNull
      else org[key] ?: defaults[key] ?: JsonNull
    }
  }

  // Weglot (libs/plugins/weglot/src/lib/model/weglot-settings.ts)

  private val weglotKey = Regex("^wg_[A-Za-z0-9]{16,64}$")
  private val weglotLanguagePattern = Regex("^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$")
  private const val WEGLOT_MAX_TARGET_LANGUAGES = 30

  private fun text(value: JsonElement?): String? = (value as? JsonPrimitive)?.takeIf { it.isString }?.content

  /** One language code, normalized, or null (`parseWeglotLanguage`). */
  internal fun weglotLanguage(raw: JsonElement?): String? {
    val code = text(raw)?.trim()?.lowercase() ?: return null
    return code.takeIf { weglotLanguagePattern.matches(it) }
  }

  /**
   * The target list as typed, commas, semicolons or spaces between codes (`parseWeglotLanguageList`): the codes in the
   * order typed without repeats, and the entries it could not read.
   */
  internal fun weglotLanguageList(raw: JsonElement?): Pair<List<String>, List<String>> {
    val codes = mutableListOf<String>()
    val invalid = mutableListOf<String>()
    val typed = text(raw) ?: return codes to invalid
    for (entry in typed.split(Regex("[\\s,;]+"))) {
      if (entry.isEmpty()) continue
      val code = weglotLanguage(JsonPrimitive(entry))
      if (code == null) invalid += entry else if (code !in codes) codes += code
    }
    return codes to invalid
  }

  /** The Weglot card's pre-save check (`validateWeglotConfig`): switched off, anything may be saved. */
  internal fun weglot(values: Map<String, JsonElement>): String? {
    val enabled = values["enabled"] as? JsonPrimitive
    if (enabled == null || enabled.isString || enabled.booleanOrNull != true) return null
    val apiKey = text(values["apiKey"])?.trim().orEmpty()
    if (apiKey.isEmpty()) return "Add your Weglot API key before turning translation on."
    if (!weglotKey.matches(apiKey)) {
      return "That is not a Weglot API key. Copy the key that starts with wg_ from your Weglot project settings."
    }
    val source = weglotLanguage(values["sourceLanguage"]) ?: return "Enter the language your site is written in as a code, such as en."
    val (codes, invalid) = weglotLanguageList(values["targetLanguages"])
    if (invalid.isNotEmpty()) return "Not a language code: ${invalid.joinToString(", ")}. Use codes such as fr or pt-br."
    if (codes.isEmpty()) return "Add at least one language to translate into."
    if (source in codes) return "The languages to translate into cannot include the language your site is written in."
    if (codes.size > WEGLOT_MAX_TARGET_LANGUAGES) return "Weglot translates into at most $WEGLOT_MAX_TARGET_LANGUAGES languages here."
    return null
  }
}
