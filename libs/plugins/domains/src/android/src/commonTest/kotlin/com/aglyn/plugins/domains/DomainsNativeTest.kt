package com.aglyn.plugins.domains

import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistry
import com.aglyn.screens.ScreenSpec
import com.aglyn.screens.ScreenValues
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals

class DomainsNativeTest {
  private val declared = mapOf(
    "screens" to listOf("domains.list", "domains.domain"),
    "widgets" to listOf(),
    "deepLinks" to listOf(),
  )

  @Test
  fun registersExactlyWhatItDeclares() {
    val registry = NativePluginRegistry()
    val result = registry.load(listOf(NativePluginManifestEntry("domains", declared, ::registerDomainsNative)))
    assertEquals(emptyList(), result.failed)
  }

  /** A row's status reads as the console's `domainStatus` does: one label for each status, the first that holds. */
  @Test
  fun eachRowShowsTheConsolesStatusLabel() {
    val spec = DomainsScreenJson.files.flatMap { ScreenSpec.parseFile(it) }.first { it.id == "domains.list" }
    val badges = spec.blocks.first { it.id == "domains" }.raw.jsonObject.getValue("badges").jsonArray
    fun label(row: String): List<String> {
      val scope = Json.parseToJsonElement("""{"item":$row}""")
      return badges.filter { ScreenValues.condition((it.jsonObject["when"] as? JsonPrimitive)?.content, scope) }
        .map { (it.jsonObject.getValue("text") as JsonPrimitive).content }
    }
    assertEquals(listOf("Starting transfer"), label("""{"status":"registering","origin":"transfer-in"}"""))
    assertEquals(listOf("Registering"), label("""{"status":"charging","origin":"purchase"}"""))
    assertEquals(listOf("Moving here"), label("""{"status":"transferring-in"}"""))
    assertEquals(listOf("Expired"), label("""{"status":"expired"}"""))
    assertEquals(listOf("Not completed"), label("""{"status":"declined"}"""))
    assertEquals(listOf("Renewal failing"), label("""{"status":"active","renewalFailing":true}"""))
    assertEquals(listOf("Confirm email"), label("""{"status":"active","renewalFailing":false,"verifyByMs":1800000000000}"""))
    assertEquals(listOf("Active"), label("""{"status":"active","renewalFailing":false,"verifyByMs":null}"""))
  }
}
