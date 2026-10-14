package com.aglyn.plugins.logic

import com.aglyn.contracts.FunctionValueType
import com.aglyn.contracts.HostFunctionParameter
import com.aglyn.contracts.HostVariableType
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreOrder
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LogicTest {
  private fun doc(id: String, data: Map<String, Any?>) = FirestoreDoc(id, "hosts/h/variables/$id", data)

  @Test
  fun readsTheCardsWindowWithoutTheDeletedOnes() {
    val query = ceilingQuery(variablesPath("h"))
    assertEquals("hosts/h/variables", query.collectionPath)
    assertEquals(listOf(FirestoreOrder("__name__")), query.orderBy)
    assertEquals(LOGIC_CEILING + 1, query.limit)
    val (rows, truncated) = liveWindow(
      listOf(doc("b", mapOf("name" to "zip", "type" to "text")), doc("a", mapOf("name" to "Phone", "type" to "number", "value" to "5")), doc("c", mapOf("name" to "gone", "deletedAt" to 1L))),
      VariableRow::from,
    ) { it.name }
    assertEquals(listOf("Phone", "zip"), rows.map { it.name })
    assertEquals(HostVariableType.NUMBER, rows.first().type)
    assertTrue(!truncated)
  }

  @Test
  fun aFunctionSavesItsWholeDefinition() {
    val definition = emptyFunction().copy(name = "  Shipping cost  ")
    val fields = functionSaveFields(definition)
    assertEquals("Shipping cost", fields["name"])
    @Suppress("UNCHECKED_CAST")
    val parameters = fields["parameters"] as List<Map<String, Any?>>
    assertEquals("P1", parameters.single()["name"])
    assertEquals("number", parameters.single()["type"])
    @Suppress("UNCHECKED_CAST")
    val operation = (fields["operations"] as List<Map<String, Any?>>).single()
    assertEquals("<=", (operation["if"] as Map<*, *>)["comparator"])
    assertEquals("", fields["returnValue"])
    assertEquals(listOf("P1", "P3"), definition.assignableNames())
    assertEquals(listOf("P1"), emptyFunction().copy(variables = null, parameters = listOf(HostFunctionParameter(name = "P1", type = FunctionValueType.TEXT), HostFunctionParameter(name = "2bad"))).assignableNames())
  }

  @Test
  fun aDependentOpensItsBesignerPage() {
    assertEquals("/screens/s1/versions/v1/besigner", dependentBesignerPath("screen", "s1", "v1"))
    assertEquals("/layouts/l1/versions/v2/besigner", dependentBesignerPath("layout", "l1", "v2"))
    assertNull(dependentBesignerPath("workflow", "w", "v"))
    assertNull(dependentBesignerPath("screen", "s1", null))
  }

  // reference-audit.spec.ts, replayed.
  private val known = KnownTargets(
    workflows = setOf("wf-1", "Welcome flow"),
    functions = setOf("fn-1"),
    datasets = setOf("ds-1"),
    lists = setOf("list-1"),
    campaigns = emptySet(),
    overlays = setOf("ov-1"),
    webhooks = setOf("hook-1"),
  )

  private fun action(id: String, name: String, vararg steps: Map<String, Any?>) = FirestoreDoc(id, "hosts/h/actions/$id", mapOf("name" to name, "steps" to steps.toList()))

  @Test
  fun anIntactReferenceByIdOrNamePasses() {
    val issues = auditHostReferences(
      listOf(action("a1", "On signup", mapOf("type" to "runWorkflow", "workflowId" to "wf-1"), mapOf("type" to "runWorkflow", "workflowName" to "Welcome flow"), mapOf("type" to "enrollList", "listId" to "list-1"))),
      emptyList(), emptyList(), known,
    )
    assertEquals(emptyList(), issues)
  }

  @Test
  fun aDanglingIdIsFlaggedAcrossStepKinds() {
    val issues = auditHostReferences(
      listOf(action("a1", "Broken", mapOf("type" to "runWorkflow", "workflowId" to "wf-gone"), mapOf("type" to "updateDataset", "datasetId" to "ds-gone"), mapOf("type" to "showOverlay", "overlayId" to "ov-gone"))),
      emptyList(), emptyList(), known,
    )
    assertEquals(listOf("workflow", "dataset", "overlay"), issues.map { it.refType })
    assertEquals(ReferenceIssue("action", "a1", "Broken", "workflow", "wf-gone"), issues[0])
  }

  @Test
  fun workflowsAndComputedVariablesAreAudited() {
    val workflow = FirestoreDoc("wf-1", "hosts/h/workflows/wf-1", mapOf("name" to "Welcome flow", "steps" to listOf(mapOf("functionId" to "fn-1", "functionName" to "greet"), mapOf("functionId" to "fn-gone", "functionName" to ""))))
    val variable = FirestoreDoc("v1", "hosts/h/variables/v1", mapOf("name" to "total", "workflowId" to "wf-gone"))
    val issues = auditHostReferences(emptyList(), listOf(workflow), listOf(variable), known)
    assertEquals(listOf("function", "workflow"), issues.map { it.refType })
    assertEquals(listOf("workflow", "variable"), issues.map { it.source })
  }

  @Test
  fun aRedirectToADeletedScreenIsFlagged() {
    val issues = auditHostReferences(listOf(action("a1", "Go", mapOf("type" to "redirect", "screenId" to "gone"))), emptyList(), emptyList(), KnownTargets(screens = setOf("home")))
    assertEquals(listOf(ReferenceIssue("action", "a1", "Go", "screen", "gone")), issues)
  }

  @Test
  fun anUnloadedKindAndAnEmptyReferenceStayQuiet() {
    val issues = auditHostReferences(
      listOf(action("a1", "Unloaded", mapOf("type" to "runWorkflow", "workflowId" to "anything"))),
      emptyList(), listOf(FirestoreDoc("v1", "hosts/h/variables/v1", mapOf("name" to "plain"))), KnownTargets(),
    )
    assertEquals(emptyList(), issues)
  }

  @Test
  fun aKnownSetHoldsIdsAndTrimmedNamesOfLiveDocs() {
    val docs = listOf(
      FirestoreDoc("a", "p/a", mapOf("name" to " Alpha ")),
      FirestoreDoc("b", "p/b", mapOf("name" to "Beta", "deletedAt" to 1L)),
      FirestoreDoc("c", "p/c", mapOf("displayName" to "Home")),
    )
    assertEquals(setOf("a", "Alpha", "c"), knownSet(docs))
    assertEquals(setOf("a", "c", "Home"), knownSet(docs, "displayName"))
  }
}
