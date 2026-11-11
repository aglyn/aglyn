// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.screens

import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestorePage
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.Live
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * A site's plugin switches act on the lists the server holds (AGL-4047, the console's #2552): the screen holds them while
 * the site's read is only the cache's, a press applies the move to the server's lists rather than a copy read earlier,
 * and a read that failed is refused.
 */
class SitePluginSwitchTest : SpecTestBase() {
  private val org = mapOf("enabledPlugins" to listOf("commerce", "accounts", "crm", "bookings"))

  /** The site document answers from the cache first ([cached]), then from the server ([server]) unless that is null. */
  private class Reader(
    val org: Map<String, Any?>,
    val cached: Map<String, Any?>?,
    val server: Map<String, Any?>?,
    val fails: Boolean = false,
  ) : FirestoreReader {
    override suspend fun get(path: String): FirestoreDoc? = if (path.startsWith("orgs/")) FirestoreDoc("o1", path, org) else null
    override suspend fun page(query: FirestoreQuery): FirestorePage = FirestorePage(emptyList(), null)
    override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = emptyFlow()
    override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = flow {
      if (fails) {
        emit(Live.Failed(IllegalStateException("permission-denied")))
        return@flow
      }
      cached?.let { emit(Live.Ready(FirestoreDoc("h1", path, it), fromCache = true)) }
      server?.let { emit(Live.Ready(FirestoreDoc("h1", path, it), fromCache = false)) } ?: awaitCancellation()
    }
  }

  private val siteSpec = ScreenSpec.parseFile(File(root, "libs/native/screens/site.screens.json").readText())
  private val list = siteSpec.first { it.id == "core.site.plugins" }

  @BeforeTest
  fun shortDeadline() {
    FirestoreLoads.serverDeadlineMs = 100
  }

  @AfterTest
  fun usualDeadline() {
    FirestoreLoads.serverDeadlineMs = 12_000
  }

  private fun model(reader: Reader, writer: RecordingWriter = RecordingWriter()): ScreenModel {
    val session = ScreenSession(orgName = "Acme", orgRole = "owner", siteName = "Shop", origin = "https://console.test", orgPermissions = OWNER, sitePermissions = OWNER)
    return ScreenModel(list, session.context(Site(), emptyMap()), Site().api, reader, writer)
  }

  private fun toggle(on: Boolean): ActionSpec =
    ActionSpec.parse(list.blocks.first { it.id == "site" }.raw.jsonObject["toggle"]!!.jsonObject[if (on) "on" else "off"])!!

  private val press = Json.parseToJsonElement("""{"site":{"id":"h1"},"org":{"id":"o1"},"item":{"id":"bookings"}}""")

  private fun crmState(model: ScreenModel): String =
    ScreenValues.lookup("data.plugins.rows", model.context)!!.jsonArray.first { it.jsonObject["id"]?.jsonPrimitive?.content == "crm" }
      .jsonObject["state"]!!.jsonPrimitive.content

  @Test
  fun theListWaitsForTheServerAndHoldsTheSwitchesWhileOnlyTheCacheHasAnswered() {
    val confirmed = model(Reader(org, cached = emptyMap(), server = mapOf("disabledPlugins" to listOf("crm"))))
    runBlocking { confirmed.load() }
    assertFalse(ScreenValues.condition("data.plugins.checking", confirmed.context))
    assertEquals("off-for-site", crmState(confirmed), "the rows are the server's lists, not the cache's")
    assertFalse("checking" in confirmed.shown())

    val cachedOnly = model(Reader(org, cached = emptyMap(), server = null))
    runBlocking { cachedOnly.load() }
    assertTrue(ScreenValues.condition("data.plugins.checking", cachedOnly.context))
    assertTrue("checking" in cachedOnly.shown())
    assertEquals("Checking this site’s plugin list with the server…", ScreenValues.render("{data.plugins.checkingText}", cachedOnly.context))
    val disabled = list.blocks.first { it.id == "site" }.raw.jsonObject["toggle"]!!.jsonObject["disabled"]!!.jsonPrimitive.content
    assertTrue(ScreenValues.condition(disabled, ScreenContext.with(cachedOnly.context, "item", JsonObject(emptyMap()))))
  }

  @Test
  fun aPressAppliesTheMoveToTheServersListsNotTheCopyOnScreen() {
    // Since the cache's snapshot, crm was switched off for this site elsewhere: switching bookings off must keep it off.
    val writer = RecordingWriter()
    val model = model(Reader(org, cached = emptyMap(), server = mapOf("disabledPlugins" to listOf("crm"))), writer)
    val outcome = runBlocking { model.run(toggle(on = false), press) }
    assertTrue(outcome is ActionOutcome.Done, outcome.toString())
    assertEquals(listOf("merge hosts/h1 {disabledPlugins=[crm, bookings],enabledPlugins=[]}"), writer.calls)
  }

  @Test
  fun aPressTheServerHasNotConfirmedOrAReadThatFailedSavesNothing() {
    val unconfirmed = RecordingWriter()
    val held = runBlocking { model(Reader(org, cached = emptyMap(), server = null), unconfirmed).run(toggle(on = true), press) }
    assertEquals(SwitchboardRows.UNCONFIRMED_TEXT, (held as ActionOutcome.Failed).message)
    assertTrue(unconfirmed.calls.isEmpty())

    val unread = RecordingWriter()
    val failed = runBlocking { model(Reader(org, cached = null, server = null, fails = true), unread).run(toggle(on = true), press) }
    assertEquals(SwitchboardRows.UNREADABLE_TEXT, (failed as ActionOutcome.Failed).message)
    assertTrue(unread.calls.isEmpty())
  }
}
