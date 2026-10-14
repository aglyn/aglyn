package com.aglyn.screens

import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestorePage
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.Live
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** A list fed by a Firestore query reads a bigger window each time it is asked for more, and stops offering more when the window falls short. */
class QueryGrowthTest : SpecTestBase() {
  private class Rows(val total: Int) : FirestoreReader {
    val limits = mutableListOf<Int?>()
    override suspend fun get(path: String): FirestoreDoc? = null
    override suspend fun page(query: FirestoreQuery): FirestorePage {
      limits += query.limit
      val docs = (1..minOf(total, query.limit ?: total)).map { FirestoreDoc("d$it", "rows/d$it", mapOf("n" to it.toLong())) }
      return FirestorePage(docs, null)
    }
    override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = emptyFlow()
    override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = emptyFlow()
  }

  private fun screen(limit: Int) = ScreenSpec.parse(
    Json.parseToJsonElement(
      """{"id":"core.x","title":"X","load":{"rows":{"query":{"collection":"hosts/h1/rows","limit":$limit}}},
          "blocks":[{"type":"list","id":"rows","items":"data.rows.items","load":"rows","primary":"{item.n}"}]}""",
    ),
  )!!

  private fun modelFor(total: Int, limit: Int, reader: Rows = Rows(total)): Pair<ScreenModel, Rows> {
    val session = ScreenSession(orgName = "Acme", orgRole = "owner", siteName = "Shop", origin = "https://console.test")
    return ScreenModel(screen(limit), session.context(Site(), emptyMap()), Site().api, reader) to reader
  }

  private fun ScreenModel.rows() = (ScreenValues.lookup("data.rows.items", context) as JsonArray).size

  @Test
  fun aFullWindowOffersMoreAndEachAskReadsAnotherPage() = runTest {
    val (model, reader) = modelFor(total = 5, limit = 2)
    model.load()
    assertEquals(2, model.rows())
    assertEquals("2", model.cursors["rows"], "a window that came back full may have more behind it")
    model.loadMore("rows")
    assertEquals(4, model.rows())
    assertEquals("4", model.cursors["rows"])
    model.loadMore("rows")
    assertEquals(5, model.rows())
    assertNull(model.cursors["rows"], "the window fell short, so that was everything")
    assertEquals(listOf<Int?>(2, 4, 6), reader.limits)
  }

  @Test
  fun aWindowThatFellShortOffersNothingMore() = runTest {
    val (model, reader) = modelFor(total = 1, limit = 2)
    model.load()
    assertEquals(1, model.rows())
    assertNull(model.cursors["rows"])
    model.loadMore("rows")
    assertEquals(listOf<Int?>(2), reader.limits, "nothing to ask for")
  }

  @Test
  fun aReloadKeepsTheGrownWindow() = runTest {
    val (model, reader) = modelFor(total = 9, limit = 3)
    model.load()
    model.loadMore("rows")
    model.load()
    assertEquals(6, model.rows(), "an action that reloads does not shrink the list the person grew")
    assertEquals(listOf<Int?>(3, 6, 6), reader.limits)
  }
}
