package com.aglyn.screens

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonObject
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Admin › Error pages' Maintenance mode switch (the console's ErrorScreensCard): the site document's `maintenance`, true
 * while it is on and deleted when it is turned off, written as the console writes it, with the site-wide republish.
 */
class SiteMaintenanceSpecTest {
  private val root: File = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "libs/native/screens").isDirectory }
  private val spec = ScreenSpec.parseFile(File(root, "libs/native/screens/site.screens.json").readText()).first { it.id == "core.site.errorPages" }

  private fun json(text: String): JsonElement = Json.parseToJsonElement(text)

  private class Recorder : com.aglyn.core.FirestoreWriter {
    val calls = mutableListOf<Pair<String, Map<String, Any?>>>()
    override suspend fun merge(path: String, data: Map<String, Any?>) { calls += path to data }
    override suspend fun delete(path: String) {}
    override suspend fun add(collectionPath: String, data: Map<String, Any?>): String = "new1"
  }

  @Test
  fun theSwitchWritesMaintenanceOnAndDeletesItOff() = runTest {
    val block = spec.blocks.first { it.id == "maintenance" }
    assertEquals("site.can[site.manage]", block.whenCondition)
    val submit = ActionSpec.parse(block.raw.jsonObject["submit"]!!)!!
    assertTrue(submit.siteWide, "the console's host-document write republishes the site")
    val field = block.raw.arr("fields").mapNotNull { FieldSpec.parse(it) }.single()
    assertEquals("toggle", field.kind)
    assertEquals("Maintenance mode — show visitors the 503 page at every address", field.label)
    assertEquals("true", ScreenValues.render(field.initial!!, json("""{"data":{"site":{"maintenance":true}}}""")))
    assertFalse(ScreenValues.render(field.initial!!, json("""{"data":{"site":{}}}""")) == "true")

    val writer = Recorder()
    val model = ScreenModel(spec, json("""{"site":{"id":"h1"}}"""), null, null, writer)
    model.run(submit, json("""{"site":{"id":"h1"},"form":{"maintenance":true}}"""))
    model.run(submit, json("""{"site":{"id":"h1"},"form":{"maintenance":false}}"""))
    assertEquals(listOf("hosts/h1", "hosts/h1"), writer.calls.map { it.first })
    assertEquals(true, writer.calls[0].second["maintenance"])
    assertEquals(com.aglyn.core.FirestoreDelete, writer.calls[1].second["maintenance"])
  }

  @Test
  fun visitSiteEntersAsTheTeamInPreviewOrMaintenance() {
    assertTrue(com.aglyn.core.SiteVisit.entersAsTeam(mapOf("maintenance" to true)))
    assertTrue(com.aglyn.core.SiteVisit.entersAsTeam(mapOf("preview" to true)))
    assertFalse(com.aglyn.core.SiteVisit.entersAsTeam(mapOf("preview" to "yes")))
    assertFalse(com.aglyn.core.SiteVisit.entersAsTeam(mapOf("maintenance" to false)))
    assertFalse(com.aglyn.core.SiteVisit.entersAsTeam(null))
  }

  /** Admin › Security lists the approved image hosts too, and every add and remove republishes the site, as the console's writes do. */
  @Test
  fun securityListsImageHostsAndEveryChangeRepublishes() {
    val security = ScreenSpec.parseFile(File(root, "libs/native/screens/site.screens.json").readText()).first { it.id == "core.site.security" }
    val lists = security.blocks.filter { it.type == "list" }
    assertEquals("Image hosts", lists.first().title)
    val removes = lists.flatMap { list -> list.raw.arr("actions").mapNotNull { ActionSpec.parse(it) } }
    val adds = security.blocks.filter { it.type == "actions" }.flatMap { block -> block.raw.arr("items").mapNotNull { ActionSpec.parse(it) } }
    assertEquals("addImage", adds.first().id)
    assertEquals(6, removes.size)
    assertEquals(6, adds.size)
    assertTrue((removes + adds).all { it.siteWide })
  }
}
