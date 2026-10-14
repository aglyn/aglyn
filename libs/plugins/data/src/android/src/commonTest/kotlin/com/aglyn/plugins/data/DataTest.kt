package com.aglyn.plugins.data

import com.aglyn.pluginhost.parseUtcMinute
import com.aglyn.pluginhost.utcMinute
import com.aglyn.contracts.DatasetFieldDefinition
import com.aglyn.contracts.DatasetFieldType
import com.aglyn.contracts.ListFilterRequest
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreOrder
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DataTest {
  private val menu = FirestoreDoc(
    "ds-menu",
    "orgs/o/datasets/ds-menu",
    mapOf(
      "displayName" to "Menu items",
      "names" to mapOf("singular" to "Menu item", "plural" to "Menu items"),
      "visibleTo" to listOf("org"),
      "model" to mapOf(
        "order" to listOf("name", "price", "category", "supplier"),
        "fields" to mapOf(
          "name" to mapOf("name" to "Name", "type" to "text", "required" to true, "slugFrom" to "x"),
          "price" to mapOf("name" to "Price", "type" to "float", "validation" to mapOf("min" to 0L)),
          "category" to mapOf("name" to "Category", "type" to "text", "validation" to mapOf("options" to listOf("Bread", "Cake"))),
          "supplier" to mapOf("name" to "Supplier", "type" to "reference", "reference" to mapOf("datasetId" to "ds-suppliers", "onDelete" to "restrict")),
        ),
      ),
    ),
  )

  @Test
  fun readsADatasetAndItsModel() {
    val row = DatasetRow.from(menu)
    assertEquals("Menu items", row.name)
    assertEquals(listOf("name", "price", "category", "supplier"), row.model.order)
    assertEquals(DatasetFieldType.FLOAT, row.model.fields!!["price"]!!.type)
    assertEquals(listOf("org"), row.visibleTo)
    assertEquals("Menu item", row.singular)
    val suppliers = DatasetRow.from(FirestoreDoc("ds-suppliers", "orgs/o/datasets/ds-suppliers", mapOf("fields" to listOf("company"))))
    assertEquals(listOf(row to "supplier"), suppliers.referencedBy(listOf(row)))
    // A v1 dataset: the flat columns as text fields.
    assertEquals("Company", suppliers.model.fields!!["company"]!!.name)
  }

  @Test
  fun listsWhatTheMemberMayList() {
    assertTrue(datasetsQuery("o", null).filters.isEmpty())
    assertEquals(listOf(FirestoreFilter("visibleTo", FilterOp.ARRAY_CONTAINS_ANY, listOf("org", "host:h"))), datasetsQuery("o", listOf("org", "host:h")).filters)
  }

  @Test
  fun pagesRecordsByDocumentNameWithTheFiltersOnTheQuery() {
    val model = DatasetRow.from(menu).model
    val all = recordsQuery("o", "ds-menu", model, emptyList(), "")
    assertEquals("orgs/o/datasets/ds-menu/records", all.collectionPath)
    assertEquals(listOf(FirestoreOrder("__name__")), all.orderBy)
    val filtered = recordsQuery("o", "ds-menu", model, listOf(ListFilterRequest("values.category", "equals", "Bread")), "sour dough")
    assertTrue(FirestoreFilter("filterValues.category", FilterOp.EQ, "Bread") in filtered.filters)
    assertTrue(FirestoreFilter("filterKeys", FilterOp.ARRAY_CONTAINS, "s:sour") in filtered.filters)
  }

  @Test
  fun aSchemaSaveKeepsTheKeysItDoesNotEdit() {
    val row = DatasetRow.from(menu)
    val renamed = row.model.copy(fields = row.model.fields!! + ("name" to row.model.fields!!["name"]!!.copy(name = "Title", required = null)))
    @Suppress("UNCHECKED_CAST")
    val name = (schemaModelJson(renamed, row.rawFields)["fields"] as Map<String, Map<String, Any?>>)["name"]!!
    assertEquals("Title", name["name"])
    assertEquals("x", name["slugFrom"])
    assertNull(name["required"])
  }

  @Test
  fun recordInputsRoundTripTheEditorsText() {
    val model = DatasetRow.from(menu).model
    val inputs = recordInputs(model, mapOf("name" to "Rye", "price" to 7L, "category" to "Bread"))
    assertEquals(mapOf("name" to "Rye", "price" to "7", "category" to "Bread", "supplier" to ""), inputs)
    val stamped = inputsForWrite(
      com.aglyn.contracts.DatasetModel(fields = mapOf("at" to DatasetFieldDefinition(name = "At", type = DatasetFieldType.TIMESTAMP)), order = listOf("at")),
      mapOf("at" to "2026-01-01T09:30"),
    )
    assertEquals("2026-01-01T09:30Z", stamped["at"])
    assertEquals(1767259800000L, parseUtcMinute("2026-01-01T09:30"))
    assertEquals("2026-01-01T09:30", utcMinute(1767259800000L))
  }

  @Test
  fun aRecordReadsByItsFirstValue() {
    val model = DatasetRow.from(menu).model
    val record = RecordRow("r", mapOf("name" to "Rye", "price" to 7.5, "category" to "Bread"), null, null)
    assertEquals("Rye", record.title(model))
    assertEquals("Price: 7.5 · Category: Bread", record.supporting(model))
    assertEquals("x1 (not found)", recordValueText(model.fields!!["supplier"]!!, "x1", emptyList()))
  }
}
