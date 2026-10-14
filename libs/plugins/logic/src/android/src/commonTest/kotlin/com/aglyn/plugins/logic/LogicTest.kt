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
}
