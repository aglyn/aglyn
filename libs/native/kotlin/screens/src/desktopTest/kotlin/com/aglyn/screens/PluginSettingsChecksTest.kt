// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.screens

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * A plugin settings form's pre-save check over the console's own answers: each case in
 * `plugin-settings-check-cases.generated.json` is what the schema's `validate` says to a set of values.
 */
class PluginSettingsChecksTest {
  private val root: File = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "libs/native/screens").isDirectory }

  private fun checks(): JsonObject =
    (Json.parseToJsonElement(File(root, "libs/native/contracts/plugin-settings-check-cases.generated.json").readText()) as JsonObject)["checks"] as JsonObject

  @Test
  fun everyCheckAnswersAsTheConsolesValidate() {
    val checks = checks()
    assertNotNull(checks["weglot"])
    for ((name, cases) in checks) {
      assertTrue((cases as JsonArray).isNotEmpty(), name)
      for (case in cases) {
        val values = (case as JsonObject)["values"] as JsonObject
        val expected = (case["result"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
        assertEquals(expected, PluginSettingsChecks.refusal(name, values), "$name $values")
      }
    }
  }

  /** On a site the check is asked over the values the site will run with: its override, else the workspace's, else the default. */
  @Test
  fun aSiteIsCheckedOverWhatItWillRunWith() {
    fun obj(vararg pairs: Pair<String, Any>): JsonObject = JsonObject(
      pairs.associate { (key, value) ->
        key to when (value) {
          is Boolean -> JsonPrimitive(value)
          is String -> JsonPrimitive(value)
          else -> value as JsonElement
        }
      },
    )
    val defaults = obj("enabled" to false, "apiKey" to "", "sourceLanguage" to "en", "targetLanguages" to "")
    val org = obj("enabled" to true, "apiKey" to "wg_0123456789abcdef", "targetLanguages" to "fr")
    fun site(form: JsonObject): String? {
      val filled = obj("const" to obj("defaults" to defaults), "data" to obj("org" to org), "form" to form)
      return PluginSettingsChecks.refusal("weglot", PluginSettingsChecks.values(filled, site = true))
    }
    assertNull(site(obj("ov_enabled" to false, "enabled" to false, "ov_apiKey" to false, "apiKey" to "")))
    assertEquals(
      "Add your Weglot API key before turning translation on.",
      site(obj("ov_enabled" to false, "enabled" to true, "ov_apiKey" to true, "apiKey" to "")),
    )
    assertEquals(
      "The languages to translate into cannot include the language your site is written in.",
      site(obj("ov_targetLanguages" to true, "targetLanguages" to "en, fr")),
    )
    assertNull(PluginSettingsChecks.refusal("unknown", obj("enabled" to true)))
  }

  /**
   * Weglot's key and language codes are kept as typed (the schema's `verbatim`, the console's `autoCapitalize="none"`):
   * a keyboard that capitalizes or corrects would make a typed key "Wg_…", which the check refuses.
   */
  @Test
  fun keysAndCodesAreKeptAsTyped() {
    val screens = ScreenSpec.parseFile(File(root, "libs/native/screens/plugin-settings.screens.json").readText())
    for (id in listOf("core.pluginSettings.weglot", "core.sitePluginSettings.weglot")) {
      val form = screens.first { it.id == id }.blocks.first { it.type == "form" }
      val fields = (form.raw as JsonObject)["fields"]!!.let { it as JsonArray }.mapNotNull { FieldSpec.parse(it) }
      assertEquals(listOf("apiKey", "sourceLanguage", "targetLanguages"), fields.filter { it.verbatim }.map { it.key }, id)
    }
    assertTrue(FieldSpec.parse(Json.parseToJsonElement("""{"key":"apiKey","kind":"text","verbatim":true}"""))!!.verbatim)
    assertTrue(!FieldSpec.parse(Json.parseToJsonElement("""{"key":"name","kind":"text"}"""))!!.verbatim)
  }
}
