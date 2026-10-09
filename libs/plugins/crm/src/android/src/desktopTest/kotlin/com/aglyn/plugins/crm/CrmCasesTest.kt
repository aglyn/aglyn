package com.aglyn.plugins.crm

import com.aglyn.contracts.Contracts
import com.aglyn.contracts.ListFilterRequest
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDelete
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Replays the console's own answers (function-cases.generated.json) through the CRM's ports, and checks the list plans. */
class CrmCasesTest {
  private val functions = Json.parseToJsonElement(File("../../../../native/contracts/function-cases.generated.json").readText())
    .jsonObject.getValue("functions").jsonObject

  private fun cases(name: String) = functions.getValue(name).jsonObject.getValue("cases").jsonArray.map {
    it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result")
  }

  private fun plain(element: JsonElement?): Any? = when (element) {
    null, JsonNull -> null
    is JsonObject -> element.mapValues { plain(it.value) }
    is JsonArray -> element.map(::plain)
    is JsonPrimitive -> if (element.isString) element.content else element.booleanOrNull ?: element.longOrNull ?: element.doubleOrNull
  }

  @Suppress("UNCHECKED_CAST")
  private fun map(element: JsonElement?) = plain(element) as? Map<String, Any?>

  private fun group(element: JsonElement): ConsentGroup {
    val o = element.jsonObject
    return ConsentGroup(
      o.getValue("hostId").jsonPrimitive.content,
      o.getValue("groupId").jsonPrimitive.content,
      (o["name"] as? JsonPrimitive)?.contentOrNull,
      o.getValue("hostIds").jsonArray.map { it.jsonPrimitive.content },
      o.getValue("declared").jsonPrimitive.booleanOrNull == true,
    )
  }

  @Test
  fun consentGroupForHostCases() = cases("consentGroupForHost").forEach { (args, result) ->
    val got = consentGroupForHost(map(args[0]), args[1].jsonPrimitive.content)
    assertEquals(group(result), got, args.toString())
  }

  @Test
  fun scopeTokenCases() {
    cases("crmScopeTokens").forEach { (args, result) ->
      assertEquals(result.jsonArray.map { it.jsonPrimitive.content }, crmScopeTokens(map(args[0]), group(args[1])), args.toString())
    }
    cases("crmReadTokens").forEach { (args, result) ->
      assertEquals(result.jsonArray.map { it.jsonPrimitive.content }, crmReadTokens(group(args[0])), args.toString())
    }
  }

  @Test
  fun fieldListFieldCases() = cases("crmFieldListFields").forEach { (args, result) ->
    val definition = map(args[0]).orEmpty()
    val got = fieldListFields(definition["key"] as String, definition["label"] as String, definition["required"] == true, (definition["object"] as? String) ?: "contact")
    assertEquals(map(result), got, args.toString())
  }

  private fun pipeline(element: JsonElement) = Pipeline(
    "p", "P",
    element.jsonObject.getValue("stages").jsonArray.map {
      val s = it.jsonObject
      Stage(s.getValue("id").jsonPrimitive.content, s.getValue("name").jsonPrimitive.content, s.getValue("order").jsonPrimitive.longOrNull ?: 0, s.getValue("probability").jsonPrimitive.longOrNull ?: 0, s.getValue("kind").jsonPrimitive.content, null)
    },
    false, false,
  )

  @Test
  fun pipelineTotalsCases() = cases("pipelineTotals").forEach { (args, result) ->
    @Suppress("UNCHECKED_CAST") val deals = plain(args[0]) as List<Map<String, Any?>>
    val got = pipelineTotals(deals, pipeline(args[1]))
    val want = result.jsonObject
    assertEquals(want.getValue("count").jsonPrimitive.longOrNull?.toInt(), got.count, args.toString())
    assertEquals(want.getValue("amountCents").jsonPrimitive.longOrNull, got.amountCents)
    assertEquals(want.getValue("weightedCents").jsonPrimitive.longOrNull, got.weightedCents)
    assertEquals(want.getValue("unplaced").jsonObject.getValue("count").jsonPrimitive.longOrNull?.toInt(), got.unplacedCount)
    want.getValue("stages").jsonArray.forEachIndexed { index, stage ->
      val row = stage.jsonObject
      assertEquals(row.getValue("count").jsonPrimitive.longOrNull?.toInt(), got.stages[index].count)
      assertEquals(row.getValue("weightedCents").jsonPrimitive.longOrNull, got.stages[index].weightedCents)
    }
  }

  @Test
  fun leadFunnelCases() = cases("leadFunnel").forEach { (args, result) ->
    @Suppress("UNCHECKED_CAST") val leads = plain(args[0]) as List<Map<String, Any?>>
    val got = leadFunnel(leads)
    val want = result.jsonObject
    assertEquals(want.getValue("total").jsonPrimitive.longOrNull?.toInt(), got.total)
    assertEquals(want.getValue("open").jsonPrimitive.longOrNull?.toInt(), got.open)
    assertEquals(want.getValue("byStatus").jsonObject.mapValues { it.value.jsonPrimitive.longOrNull?.toInt() }, got.byStatus)
    assertEquals(want.getValue("reasons").jsonArray.map { it.jsonObject.getValue("label").jsonPrimitive.content to it.jsonObject.getValue("count").jsonPrimitive.longOrNull?.toInt() }, got.reasons)
  }

  private val owner = CrmScope("o1", "h1", "h1", "u1", "owner", true, listOf("org", "host:h1"), listOf("host:h1"), true, emptyMap())
  private val collaborator = owner.copy(role = "editor", orgWide = false)

  @Test
  fun listsAreScopedByTheReadersTokens() {
    val query = crmListQuery(CrmKind.LEAD, owner, crmFilters(CrmKind.LEAD, owner).first(), "", 25)
    assertEquals("orgs/o1/leads", query.collectionPath)
    assertTrue(query.filters.any { it.field == "visibleTo" && it.op == FilterOp.ARRAY_CONTAINS_ANY })
    assertTrue(query.filters.any { it.field == "status" && it.op == FilterOp.IN })
    assertEquals("lastSeenAtMs", query.orderBy.single().field)
  }

  @Test
  fun anOrgWideReadersFacetClauseStandsInForTheScope() {
    val mine = crmFilters(CrmKind.CONTACT, owner).first { it.key == "mine" }
    val query = crmListQuery(CrmKind.CONTACT, owner, mine, "", 25)
    assertTrue(query.filters.none { it.field == "visibleTo" })
    assertTrue(query.filters.any { it.field == "facetKeys" && it.value == "h1:owner=u1" })
    // A collaborator keeps the scope clause; the facet clause cannot join it.
    val scoped = crmListQuery(CrmKind.CONTACT, collaborator, crmFilters(CrmKind.CONTACT, collaborator).first { it.key == "mine" }, "", 25)
    assertTrue(scoped.filters.any { it.field == "visibleTo" })
  }

  @Test
  fun anEditWritesOnlyWhatChangedAndDeletesWhatWasCleared() {
    val fields = listOf(
      CrmField(com.aglyn.ui.FieldSpec("name", "Name")),
      CrmField(com.aglyn.ui.FieldSpec("amount", "Amount", com.aglyn.ui.FieldKind.MONEY), "amountCents", Stored.CENTS),
      CrmField(com.aglyn.ui.FieldSpec("custom.size", "Size"), "custom.size"),
      CrmField(com.aglyn.ui.FieldSpec("phone", "Phone")),
    )
    val before = formValues(fields, mapOf("name" to "A", "amountCents" to 1250L, "custom" to mapOf("size" to "M"), "phone" to "1"))
    assertEquals(mapOf("name" to "A", "amount" to "12.5", "custom.size" to "M", "phone" to "1"), before)
    val changes = changedFields(fields, before, before + mapOf("amount" to "20", "custom.size" to "L", "phone" to ""))
    assertEquals(mapOf("amountCents" to 2000L, "custom" to mapOf("size" to "L"), "phone" to FirestoreDelete), changes)
  }

  @Test
  fun theSuiteFollowsTheRules() {
    assertTrue(crmSuiteCarried(mapOf("plan" to "pro")))
    assertEquals(false, crmSuiteCarried(mapOf("plan" to "pro", "billingStatus" to "canceled")))
    assertEquals(false, crmSuiteCarried(mapOf("plan" to "free")))
    assertTrue(crmSuiteCarried(mapOf("plan" to "free", "entitlements" to mapOf("features" to mapOf("crm" to true)))))
    assertTrue(crmSuiteCarried(mapOf("entitlements" to mapOf("planComp" to mapOf("plan" to "starter")))))
  }

  @Test
  fun leadChipsAreTheConsolesStatuses() {
    val chips = crmFilters(CrmKind.LEAD, owner)
    assertEquals(Contracts.nativeCrmLeadOpenStatuses.joinToString(","), chips.first().clauses.single().value)
    assertTrue(chips.any { it.clauses == listOf(ListFilterRequest("status", "equals", "nurturing")) })
  }
}
