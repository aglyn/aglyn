package com.aglyn.site

import com.aglyn.contracts.ListQuerySortDirection
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.site.artifacts.ArtifactKind
import com.aglyn.site.artifacts.artifactCountQueries
import com.aglyn.site.artifacts.artifactLiveCount
import com.aglyn.site.artifacts.artifactPlan
import com.aglyn.site.artifacts.artifactQuery
import com.aglyn.site.artifacts.artifactQuotaLimit
import com.aglyn.site.artifacts.artifactQuotaReadout
import com.aglyn.site.artifacts.artifactSortChoices
import com.aglyn.site.artifacts.artifactSortLabel
import com.aglyn.site.artifacts.quotaKey
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The components, layouts and templates lists' header sorts and per-plan count (AGL-3668), as the console's three pages give them. */
class ArtifactListTest {
  @Test
  fun offersTheConsolesHeaderSortsAndPlansThem() {
    // Every declared column order but the default walk; labels read like the console's headers.
    val components = artifactSortChoices(ArtifactKind.COMPONENT).map(::artifactSortLabel)
    assertTrue("Display name ↑" in components)
    assertTrue("Display name ↓" in components)
    assertTrue("Used in ↑" in components)
    assertTrue("Updated ↓" in components)
    assertTrue("ID ↓" in components)
    assertFalse("ID ↑" in components)
    assertTrue(artifactSortChoices(ArtifactKind.LAYOUT).isNotEmpty())
    assertTrue(artifactSortChoices(ArtifactKind.TEMPLATE).isNotEmpty())

    // A header sort orders the query by the column's stored value, the document id breaking ties for the next page.
    val byName = artifactSortChoices(ArtifactKind.LAYOUT).first { it.column == "displayName" && it.direction == ListQuerySortDirection.DESC }
    val sorted = artifactQuery(ArtifactKind.LAYOUT, "h", "", null, sort = byName)
    assertEquals(listOf(FirestoreOrder("nameLower", descending = true), FirestoreOrder("__name__", descending = true)), sorted.orderBy)
    assertTrue(artifactPlan(ArtifactKind.LAYOUT, "", null, byName).notices.isEmpty())
    // The default walk is the document id alone.
    assertEquals(listOf(FirestoreOrder("__name__")), artifactQuery(ArtifactKind.LAYOUT, "h", "", null).orderBy)

    // A column that sorts only with nothing else on falls back to the default header order, and says so.
    val plan = artifactPlan(ArtifactKind.LAYOUT, "hero", null, byName)
    assertEquals(1, plan.notices.size)
    assertTrue(plan.notices[0].startsWith("Sorted by"))
    assertNotEquals("nameLower", plan.orderBy.path)
  }

  @Test
  fun readsThePlansCapAndCountsAsTheCreateRouteDoes() {
    val body = Json.parseToJsonElement("""{"quotas":{"componentsPerHost":1,"sharedLayoutsPerHost":null,"templatesPerHost":50}}""")
    assertEquals(1L, artifactQuotaLimit(body, ArtifactKind.COMPONENT))
    assertNull(artifactQuotaLimit(body, ArtifactKind.LAYOUT))
    assertEquals(50L, artifactQuotaLimit(body, ArtifactKind.TEMPLATE))
    assertNull(artifactQuotaLimit(null, ArtifactKind.COMPONENT))
    assertEquals("componentsPerHost", ArtifactKind.COMPONENT.quotaKey)
    assertEquals("sharedLayoutsPerHost", ArtifactKind.LAYOUT.quotaKey)
    assertEquals("templatesPerHost", ArtifactKind.TEMPLATE.quotaKey)
    assertEquals("3/10 layouts on your plan", artifactQuotaReadout(3, 10, true, "layout"))
    assertEquals("3/∞ components on your plan", artifactQuotaReadout(3, null, true, "component"))
    assertEquals("1 template · checking your plan…", artifactQuotaReadout(1, null, false, "template"))

    // Components and layouts: everything less the tombstones. Templates: everything that is not a starter's page.
    val (layouts, tombstones) = artifactCountQueries(ArtifactKind.LAYOUT, "h")
    assertEquals("hosts/h/layouts", layouts.collectionPath)
    assertTrue(layouts.filters.isEmpty())
    assertEquals(listOf(FirestoreFilter("deletedAt", FilterOp.GT, FirestoreTimestamp(0))), tombstones?.filters)
    val (templates, none) = artifactCountQueries(ArtifactKind.TEMPLATE, "h")
    assertEquals(listOf(FirestoreFilter("source.type", FilterOp.NE, "starter")), templates.filters)
    assertNull(none)
    assertEquals(5, artifactLiveCount(7, 2))
    assertEquals(0, artifactLiveCount(1, 2))
    assertEquals(4, artifactLiveCount(4, null))
  }
}
