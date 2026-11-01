package com.aglyn.site

import com.aglyn.site.sites.siteBrandMissedNotice
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Replays derived-values.generated.json's `siteBrand.noticeCases`: the console's own sentence. */
class SiteBrandCasesTest {
  @Test
  fun saysWhatDidNotMakeItAsTheConsole() {
    val root = Json.parseToJsonElement(File(System.getProperty("aglyn.contractsDir"), "derived-values.generated.json").readText()).jsonObject
    val cases = root.getValue("siteBrand").jsonObject.getValue("noticeCases").jsonArray
    assertTrue(cases.isNotEmpty())
    cases.forEach { entry ->
      val missed = entry.jsonObject.getValue("missed").jsonArray.map { it.jsonPrimitive.content }
      assertEquals(entry.jsonObject.getValue("notice").jsonPrimitive.contentOrNull, siteBrandMissedNotice(missed))
    }
  }
}
