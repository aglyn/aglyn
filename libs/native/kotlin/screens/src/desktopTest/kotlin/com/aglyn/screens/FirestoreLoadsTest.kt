package com.aglyn.screens

import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestorePage
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.Live
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The Firestore reads a spec makes: filters of every operator, server counts and sums, and a plan feature's gate. */
class FirestoreLoadsTest {
  private class Reader(val docs: Map<String, Map<String, Any?>> = emptyMap(), val counts: Long? = 7, val sums: Double? = 1234.5) : FirestoreReader {
    val queries = mutableListOf<FirestoreQuery>()
    var asked = ""
    override suspend fun get(path: String): FirestoreDoc? = docs[path]?.let { FirestoreDoc(path.substringAfterLast('/'), path, it) }
    override suspend fun page(query: FirestoreQuery): FirestorePage { queries += query; return FirestorePage(emptyList(), null) }
    override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = emptyFlow()
    override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = emptyFlow()
    override suspend fun count(query: FirestoreQuery): Long? { queries += query; return counts }
    override suspend fun sum(query: FirestoreQuery, field: String): Double? { queries += query; asked = field; return sums }
  }

  private val context = Json.parseToJsonElement("""{"site":{"id":"h1"},"params":{"q":"Ada Lovelace"}}""")

  @Test
  fun everyOperatorBecomesAFilterAndTheValueIsRendered() {
    val reader = Reader()
    val spec = Json.parseToJsonElement(
      """{"collection":"hosts/{site.id}/giftCards","orderBy":"createdAtMs desc","limit":20,
         "where":[["balanceCents",">",0],["status","!=","void"],["searchTokens","array-contains","{params.q:token}"],["kind","in",["a","b"]],["n","<=",5]]}""",
    )
    runBlocking { FirestoreLoads.query(reader, spec, context) }
    val query = reader.queries.single()
    assertEquals("hosts/h1/giftCards", query.collectionPath)
    assertEquals(listOf(FilterOp.GT, FilterOp.NE, FilterOp.ARRAY_CONTAINS, FilterOp.IN, FilterOp.LTE), query.filters.map { it.op })
    assertEquals(listOf(0.0, "void", "ada", listOf("a", "b"), 5.0), query.filters.map { it.value })
    assertEquals(20, query.limit)
  }

  @Test
  fun anAggregateAsksTheServerForTheWholeCollectionAndReadsNoRows() {
    val reader = Reader()
    val spec = Json.parseToJsonElement("""{"collection":"hosts/h1/giftCards","limit":50,"where":[["balanceCents",">",0]],"aggregate":{"count":true,"sum":"balanceCents"}}""")
    val result = runBlocking { FirestoreLoads.query(reader, spec, context) }.jsonObject
    assertEquals(7.0, (result["count"] as JsonPrimitive).content.toDouble())
    assertEquals(1234.5, (result["sum"] as JsonPrimitive).content.toDouble())
    assertEquals("balanceCents", reader.asked)
    assertTrue(result["items"]!!.jsonArray.isEmpty())
    assertTrue(reader.queries.all { it.limit == null }, "a capped list is never the answer")
  }

  @Test
  fun aReaderThatCannotAnswerLeavesTheFiguresOutSoTheScreenSaysSo() {
    val result = runBlocking { FirestoreLoads.query(Reader(counts = null, sums = null), Json.parseToJsonElement("""{"collection":"hosts/h1/c","aggregate":{"count":true,"sum":"x"}}"""), context) }.jsonObject
    assertTrue("count" !in result && "sum" !in result)
    assertEquals("Unavailable", ScreenValues.render("{data.live.sum|'Unavailable':cents}", ScreenContext.with(context, "data", Json.parseToJsonElement("""{"live":${result}}"""))))
  }

  @Test
  fun anEntitlementReadsTheWorkspaceDocumentAndNamesThePlanThatHasTheFeature() {
    val business = Reader(docs = mapOf("orgs/o1" to mapOf("plan" to "business")))
    val free = Reader(docs = mapOf("orgs/o1" to mapOf("plan" to "free")))
    val override = Reader(docs = mapOf("orgs/o1" to mapOf("plan" to "free", "entitlements" to mapOf("features" to mapOf("giftCards" to true)))))
    fun gate(reader: Reader) = runBlocking { FirestoreLoads.entitlement(reader, "giftCards", "o1") }.jsonObject
    assertEquals("true", (gate(business)["carried"] as JsonPrimitive).content)
    assertEquals("false", (gate(free)["carried"] as JsonPrimitive).content)
    assertEquals("true", (gate(override)["carried"] as JsonPrimitive).content, "a per-workspace override wins over the plan")
    assertEquals("Business", (gate(free)["label"] as JsonPrimitive).content)
    assertEquals(JsonNull, gate(free).let { runBlocking { FirestoreLoads.entitlement(free, "nothingLikeIt", "o1") }.jsonObject["label"] })
  }
}
