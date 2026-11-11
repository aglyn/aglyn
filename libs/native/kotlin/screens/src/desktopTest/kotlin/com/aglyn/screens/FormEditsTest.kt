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
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * A settings Save pressed right after opening is never pressed on the cache's copy and never refused for it (AGL-4047, the
 * console's #2576): a document only the cache answered holds the forms seeded from it until the server's copy is in, what
 * was typed is kept as edits over that copy, and untouched fields follow it. The Apple FormEditsTests assert the same.
 */
class FormEditsTest : SpecTestBase() {
  /** `users/u1` is read from the cache ([cachedFirst]); listening has the server's copy ([server]) behind the cache's. */
  private class Reader(val cached: Map<String, Any?>, val server: Map<String, Any?>?, val cachedFirst: Boolean = true) : FirestoreReader {
    override suspend fun get(path: String): FirestoreDoc? = FirestoreDoc("u1", path, cached)
    override suspend fun getAnswer(path: String): Live.Ready<FirestoreDoc?> =
      Live.Ready(FirestoreDoc("u1", path, if (cachedFirst) cached else server ?: cached), fromCache = cachedFirst)
    override suspend fun page(query: FirestoreQuery): FirestorePage = FirestorePage(emptyList(), null)
    // `discounts` rows: the cache's on the first read; listening has the server's behind them.
    override suspend fun pageAnswer(query: FirestoreQuery): Live.Ready<FirestorePage> =
      Live.Ready(FirestorePage(listOf(FirestoreDoc("d1", "hosts/h1/discounts/d1", mapOf("code" to "OLD"))), null), fromCache = cachedFirst)
    override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = flow {
      emit(Live.Ready(listOf(FirestoreDoc("d1", "hosts/h1/discounts/d1", mapOf("code" to "OLD"))), fromCache = true))
      emit(Live.Ready(listOf(FirestoreDoc("d1", "hosts/h1/discounts/d1", mapOf("code" to "NEW"))), fromCache = false))
    }
    override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = flow {
      emit(Live.Ready(FirestoreDoc("u1", path, cached), fromCache = true))
      server?.let { emit(Live.Ready(FirestoreDoc("u1", path, it), fromCache = false)) } ?: awaitCancellation()
    }
  }

  @BeforeTest
  fun shortDeadline() {
    FirestoreLoads.serverDeadlineMs = 100
  }

  @AfterTest
  fun usualDeadline() {
    FirestoreLoads.serverDeadlineMs = 12_000
  }

  private val spec = ScreenSpec.parseFile("""{"screens":[{"id":"core.x","title":"X","load":{"me":{"doc":"users/{user.uid}"}}}]}""").first()

  private fun model(reader: Reader): ScreenModel {
    val session = ScreenSession(orgName = "Acme", orgRole = "owner", siteName = "Shop", origin = "https://console.test", orgPermissions = OWNER, sitePermissions = OWNER)
    return ScreenModel(spec, ScreenContext.with(session.context(Site(), emptyMap()), "user", Json.parseToJsonElement("""{"uid":"u1"}""")), Site().api, reader, null)
  }

  private fun city(model: ScreenModel) = ScreenValues.text(ScreenValues.lookup("data.me.city", model.context) ?: JsonPrimitive(""))

  @Test
  fun aCachedSeedIsHeldUntilTheServersCopyReplacesIt() {
    val model = model(Reader(mapOf("firstName" to "Ann", "city" to "Old"), mapOf("firstName" to "Ann", "city" to "Austin")))
    runBlocking {
      model.load()
      assertEquals(JsonPrimitive(true), ScreenValues.lookup("checking.me", model.context), "the cache's copy holds the form")
      assertEquals("Old", city(model))
      assertNull(ScreenValues.lookup("data.me.${FirestoreLoads.FROM_CACHE_KEY}", model.context), "the marker never reaches the data")
    }
    // The confirm pass runs beside the caller, which waits for it here.
    assertEquals(JsonObject(emptyMap()), ScreenValues.lookup("checking", model.context), "the server's copy lifts the hold")
    assertEquals("Austin", city(model), "and replaces the cache's")
  }

  @Test
  fun aServerAnswerOnTheFirstReadHoldsNothing() {
    val model = model(Reader(mapOf("city" to "Old"), mapOf("city" to "Austin"), cachedFirst = false))
    runBlocking { model.load() }
    assertEquals(JsonObject(emptyMap()), ScreenValues.lookup("checking", model.context))
    assertEquals("Austin", city(model))
  }

  @Test
  fun aCachedListIsHeldUntilTheServersRowsReplaceIt() {
    val listSpec = ScreenSpec.parseFile("""{"screens":[{"id":"core.x","title":"X","load":{"discounts":{"query":{"collection":"hosts/h1/discounts"}}}}]}""").first()
    val session = ScreenSession(orgName = "Acme", orgRole = "owner", siteName = "Shop", origin = "https://console.test", orgPermissions = OWNER, sitePermissions = OWNER)
    val model = ScreenModel(listSpec, session.context(Site(), emptyMap()), Site().api, Reader(emptyMap(), null), null)
    runBlocking {
      model.load()
      assertEquals(JsonPrimitive(true), ScreenValues.lookup("checking.discounts", model.context), "a row's prompt is held while its list is the cache's")
      assertEquals(JsonPrimitive("OLD"), ScreenValues.lookup("data.discounts.items.0.code", model.context))
    }
    assertEquals(JsonObject(emptyMap()), ScreenValues.lookup("checking", model.context))
    assertEquals(JsonPrimitive("NEW"), ScreenValues.lookup("data.discounts.items.0.code", model.context), "the server's rows replace the cache's")
  }

  @Test
  fun editsAreKeptOverAFresherSeedAndLandedOnesFollowIt() {
    val typed = mapOf("firstName" to FieldValue.Text("Annie"), "city" to FieldValue.Text("Dallas"))
    // The server's copy arrives: the typed name and city are kept; untouched fields were never edits.
    assertEquals(typed, FormEdits.settled(typed, null, mapOf("firstName" to FieldValue.Text("Ann"), "city" to FieldValue.Text("Austin"))))
    // A save landed: what the seed shows now, and what the press wrote (formatted on the way), follow the seed again.
    val pressed = mapOf("firstName" to FieldValue.Text("Annie"), "phone" to FieldValue.Text("512 555 0123"))
    val after = FormEdits.settled(
      typed + ("phone" to FieldValue.Text("512 555 0123")), pressed,
      mapOf("firstName" to FieldValue.Text("Annie"), "city" to FieldValue.Text("Austin"), "phone" to FieldValue.Text("+15125550123")),
    )
    assertEquals(mapOf("city" to FieldValue.Text("Dallas")), after, "typed while the save ran, so still unsaved")
  }

  @Test
  fun aFormIsHeldOnlyByTheLoadsItReads() {
    val checking = Json.parseToJsonElement("""{"me":true,"site":true}""")
    assertEquals(listOf("me"), FormEdits.heldBy("data.me", listOf("{item.firstName}"), checking))
    assertEquals(listOf("site"), FormEdits.heldBy(null, listOf("{data.site.name ?? data.org.name}"), checking))
    assertEquals(emptyList(), FormEdits.heldBy(null, listOf("{data.settings.x}"), Json.parseToJsonElement("""{"set":true}""")), "not a longer key")
    assertEquals(emptyList(), FormEdits.heldBy("data.me", emptyList(), Json.parseToJsonElement("""{"me":false}""")))
    assertEquals("Checking your profile with the server…", FormEdits.checkingText("profile"))
    assertEquals("Checking your settings with the server…", FormEdits.checkingText(null))
  }
}
