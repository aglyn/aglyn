package com.aglyn.core.listquery

import com.aglyn.contracts.ContractJsonFormat
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.ListQueryDeclaration
import com.aglyn.contracts.ListQueryPlan
import com.aglyn.contracts.ListQueryRequest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Replays list-query-cases.generated.json: the console planner's own plans, made in UTC. */
class ListQueryCasesTest {
  private val root = Json.parseToJsonElement(
    File(System.getProperty("aglyn.contractsDir"), "list-query-cases.generated.json").readText(),
  ).jsonObject

  private val encoder = Json(ContractJsonFormat) { encodeDefaults = false }

  private fun declaration(name: String): ListQueryDeclaration = when (name) {
    "ORDER_LIST_QUERY" -> Contracts.orderListQuery
    "PRODUCT_LIST_QUERY" -> Contracts.productListQuery
    "SITE_LIST_DECLARATION" -> Contracts.siteListDeclaration
    "FORM_LIST_QUERY" -> Contracts.formListQuery
    "SUBMISSION_LIST_QUERY" -> Contracts.submissionListQuery
    else -> error("no declaration $name")
  }

  @Test
  fun normalizersMatchTheConsole() {
    val cases = root.getValue("normalizers").jsonArray
    assertTrue(cases.isNotEmpty())
    for (case in cases) {
      val obj = case.jsonObject
      val input = obj.getValue("input").jsonPrimitive.content
      assertEquals(obj.getValue("key").jsonPrimitive.content, nameSearchKey(input), input)
      assertEquals(obj.getValue("token").jsonPrimitive.content, nameSearchToken(input), input)
      assertEquals(obj.getValue("reversed").jsonPrimitive.content, nameSearchReversed(input), input)
      assertEquals(obj.getValue("tokens").jsonArray.map { it.jsonPrimitive.content }, nameSearchTokens(input), input)
    }
  }

  @Test
  fun everyPlanMatchesTheConsole() {
    val cases = root.getValue("cases").jsonArray
    assertEquals("UTC", root.getValue("timeZone").jsonPrimitive.content)
    assertTrue(cases.size >= 40)
    val failures = mutableListOf<String>()
    for (case in cases) {
      val obj = case.jsonObject
      val label = "${obj.getValue("declaration").jsonPrimitive.content}: ${obj.getValue("label").jsonPrimitive.content}"
      val request = ContractJsonFormat.decodeFromJsonElement(ListQueryRequest.serializer(), obj.getValue("request"))
      val plan = planListQuery(declaration(obj.getValue("declaration").jsonPrimitive.content), request, NameSearchNormalizers, "UTC")
      val actual: JsonElement = encoder.encodeToJsonElement(ListQueryPlan.serializer(), plan)
      // The console writes `searched: null`; the Kotlin plan leaves an absent value out.
      val expected = JsonObject(obj.getValue("plan").jsonObject.filterNot { (key, value) -> key == "searched" && value is JsonNull })
      if (actual != expected) failures += "$label\n  expected $expected\n  actual   $actual"
    }
    assertEquals(emptyList(), failures, failures.joinToString("\n"))
  }
}

class ListQueryFirestoreTest {
  @Test
  fun aPlanBecomesAFirestoreQuery() {
    val plan = planListQuery(
      Contracts.orderListQuery,
      ListQueryRequest(clauses = listOf(com.aglyn.contracts.ListFilterRequest("createdAtMs", "onOrAfter", "2026-03-14"))),
      timeZone = "UTC",
    )
    val query = plan.toFirestoreQuery("hosts/h/orders", limit = 25)
    assertEquals(listOf(com.aglyn.core.FirestoreFilter("createdAtMs", com.aglyn.core.FilterOp.GTE, 1773446400000L)), query.filters)
    assertEquals(listOf(com.aglyn.core.FirestoreOrder("createdAtMs", descending = true)), query.orderBy)
  }
}
