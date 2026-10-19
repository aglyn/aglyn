package com.aglyn.plugins.workflows

import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreTimestamp
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * A long-lived production site's automation in its older shapes (libs/native/contracts/production-shapes.json, which
 * the native seed writes too): the hub lists each one where the console does (AGL-3993). The Swift
 * `ProductionShapesTests` reads the same file.
 */
class ProductionShapesTest {
  private val shapes = ProductionShapes(File(System.getProperty("aglyn.contractsDir"), "production-shapes.json"))

  @Test
  fun listsTheWorkflowThatPostsToAWebhook() {
    val rows = visibleWorkflows(shapes.documents("hosts/{site}/workflows"))
    assertEquals(listOf("Post enrollments"), rows.map { it.name })
    assertTrue(rows.single().caption.startsWith("1 step · on "))
  }

  @Test
  fun listsTheLiveActionsAndLeavesTheRetiredInteractionsOut() {
    val list = actionListOf(shapes.documents("hosts/{site}/actions"))
    // Seven live form and CRM actions; the three deleted element interactions (two `migratedToNode`) are not listed,
    // nor counted as interactions still on their elements.
    assertEquals(7, list.actions.size)
    assertEquals(0, list.elementInteractions)
    assertTrue(list.actions.all { it.enabled })
    assertEquals(setOf("formSubmission", "dealWon", "contactCreated"), list.actions.map { it.event }.toSet())
  }

  @Test
  fun listsTheOutboundWebhook() {
    val rows = visibleWebhooks(shapes.documents("hosts/{site}/webhooks"))
    assertEquals(listOf("Send enrollments to the studio sheet"), rows.map { it.name })
    assertEquals(false, rows.single().inbound)
  }
}

/**
 * The production-shaped fixture, its placeholders filled the way the seed fills them (`expandFixtureValue` in
 * tools/scripts/seed-native/legacy-workspace.mjs), its values as the Firestore reader hands them over.
 */
class ProductionShapes(file: File, private val nowMs: Long = System.currentTimeMillis()) {
  private val root = Json.parseToJsonElement(file.readText()).jsonObject
  private val ids = root.getValue("ids").jsonObject.mapValues { it.value.jsonPrimitive.content }
  private val rows = root.getValue("documents").jsonArray.map { row ->
    row.jsonObject.getValue("path").jsonPrimitive.content to (plain(row.jsonObject.getValue("data")) as Map<*, *>)
  }

  private fun text(value: String) = value.replace("{org}", ids.getValue("org"))
    .replace("{secondSite}", ids.getValue("secondSite")).replace("{site}", ids.getValue("site")).replace("{uid}", "seed-member")

  private fun plain(element: JsonElement): Any? = when (element) {
    is JsonNull -> null
    is JsonPrimitive -> when {
      element.isString -> text(element.content)
      element.booleanOrNull != null -> element.booleanOrNull
      element.longOrNull != null -> element.longOrNull
      else -> element.content.toDouble()
    }
    is JsonArray -> element.map(::plain)
    is JsonObject -> {
      val days = element["\$daysAgo"]?.jsonPrimitive?.longOrNull
      val epochDays = element["\$epochMsDaysAgo"]?.jsonPrimitive?.longOrNull
      val bytes = element["\$bytes"]?.jsonPrimitive?.longOrNull
      when {
        days != null -> FirestoreTimestamp((nowMs - days * DAY_MS) / 1000)
        epochDays != null -> nowMs - epochDays * DAY_MS
        bytes != null -> (0 until bytes.toInt()).associate { it.toString() to ((it * 37) % 256).toLong() }
        else -> element.entries.associate { (key, value) -> text(key) to plain(value) }
      }
    }
  }

  /** The documents directly under [collection], written with the fixture's placeholders (`hosts/{site}/actions`). */
  @Suppress("UNCHECKED_CAST")
  fun documents(collection: String): List<FirestoreDoc> = rows.mapNotNull { (path, data) ->
    val parts = path.split('/')
    if (parts.size % 2 != 0 || parts.dropLast(1).joinToString("/") != collection) return@mapNotNull null
    FirestoreDoc(parts.last(), text(path), data as Map<String, Any?>)
  }

  private companion object {
    const val DAY_MS = 24L * 60 * 60 * 1000
  }
}
