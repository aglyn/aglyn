package com.aglyn.plugins.data

import com.aglyn.contracts.DatasetFieldType
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.site.artifacts.ArtifactRow
import com.aglyn.site.content.ContentEntry
import com.aglyn.site.content.sortedCollections
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
import kotlin.test.assertNotNull

/**
 * The documents a long-lived production workspace holds, in its older shapes (libs/native/contracts/production-shapes.json,
 * which the native seed writes too): every list here shows each one where the console does (AGL-3993). The Swift
 * `ProductionShapesTests` reads the same file.
 */
class ProductionShapesTest {
  private val shapes = ProductionShapes(File(System.getProperty("aglyn.contractsDir"), "production-shapes.json"))

  @Test
  fun listsEveryDatasetInItsOldestShape() {
    val rows = shapes.documents("orgs/{org}/datasets").map(DatasetRow::from)
    assertEquals(listOf("Classes", "FAQ", "Team"), rows.map { it.name }.sorted())
    val classes = assertNotNull(rows.firstOrNull { it.id == "lk-ds-classes" })
    // No `names`: the plural is the display name, as the console's card says it.
    assertEquals("Classes", classes.plural)
    assertEquals("", classes.singular)
    assertEquals(listOf("org"), classes.visibleTo)
    assertEquals(listOf("name", "level", "description"), classes.model.orderedFields().map { it.first })
    assertEquals(DatasetFieldType.SORTED, classes.model.fields?.get("level")?.type)
    val records = shapes.documents("orgs/{org}/datasets/lk-ds-classes/records").map(RecordRow::from)
    assertEquals(listOf("Wheel basics", "Hand building"), records.map { it.title(classes.model) })
  }

  @Test
  fun listsEveryContentCollectionAndEntry() {
    val collections = sortedCollections(shapes.documents("hosts/{site}/collections"))
    assertEquals(listOf("Changelog", "Journal"), collections.map { it.name })
    assertEquals("lk-classes", collections.first { it.id == "journal" }.listScreenId)
    assertEquals(true, collections.first { it.id == "changelog" }.excludeFromSearch)
    val entries = shapes.documents("hosts/{site}/collections/journal/entries").map(ContentEntry::from)
    assertEquals(listOf("Glazing week", "The new kiln", "Spring schedule"), entries.map { it.title })
    assertEquals(listOf("published", "published", "draft"), entries.map { it.status })
    // An entry saved without a category reads as uncategorized, never dropped.
    assertEquals(listOf("studio", null, null), entries.map { it.categoryId })
    assertEquals(2, shapes.documents("hosts/{site}/collections/changelog/entries").map(ContentEntry::from).size)
  }

  @Test
  fun listsComponentsWhoseNodesAreAByteMapAndALayoutWithANullDelete() {
    val components = shapes.documents("hosts/{site}/components").mapNotNull(ArtifactRow::from)
    assertEquals(listOf("Studio hero", "Class card", "Email footer"), components.map { it.name })
    assertEquals(listOf("site", "site", "email"), components.map { it.kind })
    assertEquals(listOf("lk-cmp-hero-v1", "lk-cmp-card-v1", "lk-cmp-footer-v1"), components.map { it.versionId })
    assertEquals(listOf("Studio layout"), shapes.documents("hosts/{site}/layouts").mapNotNull(ArtifactRow::from).map { it.name })
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
