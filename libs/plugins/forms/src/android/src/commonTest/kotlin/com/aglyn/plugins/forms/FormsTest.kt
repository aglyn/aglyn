package com.aglyn.plugins.forms

import com.aglyn.contracts.Contracts
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class FormsTest {
  @Test
  fun listsFormsInUseUnlessTheChipAsks() {
    val inUse = formsQuery("h", FormStatusFilter.IN_USE, "")
    assertEquals("hosts/h/forms", inUse.collectionPath)
    assertTrue(FirestoreFilter("retired", FilterOp.EQ, false) in inUse.filters)
    val retired = formsQuery("h", FormStatusFilter.RETIRED, "quo")
    assertTrue(FirestoreFilter("retired", FilterOp.EQ, true) in retired.filters)
    assertTrue(FirestoreFilter("searchTokens", FilterOp.ARRAY_CONTAINS, "quo") in retired.filters)
    assertTrue(formsQuery("h", FormStatusFilter.ALL, "").filters.isEmpty())
    assertEquals("retired", Contracts.formInUse.path)
  }

  @Test
  fun stampsTheSameSearchKeysTheConsoleWrites() {
    val fields = formListFields("contact", "Contact us", "contact-us")
    assertEquals("contact us", fields["nameLower"])
    @Suppress("UNCHECKED_CAST")
    val tokens = fields["searchTokens"] as List<String>
    assertTrue("us" in tokens && "cont" in tokens && "contact" in tokens)
    assertEquals("request-a-quote", normalizeFormSlug("  Request a Quote! "))
  }

  @Test
  fun readsAFormsQuestionsAndRouting() {
    val form = FormRow.from(
      FirestoreDoc(
        "contact",
        "hosts/h/forms/contact",
        mapOf(
          "displayName" to "Contact us",
          "fields" to listOf(mapOf("fieldName" to "email", "label" to "Email", "fieldType" to "email", "required" to true, "role" to "email")),
          "routing" to mapOf("lead" to true, "datasetId" to "leads"),
          "stats" to mapOf("submissions" to 4L, "leads" to 3L),
          "archivedAt" to null,
          "retired" to false,
        ),
      ),
    )
    assertTrue(form.routesLeads)
    assertEquals(4L, form.submissions)
    assertEquals("Email", form.fields.single().label)
    assertEquals("/forms/contact/versions/v1/besigner", formBesignerPath("contact", "v1"))
  }
}
