package com.aglyn.plugins.crm

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The workspace's own CRM (AGL-3946): every record, base fields, the routes scoped to the workspace, a site for new records. */
class CrmWorkspaceScopeTest {
  private val owner = mapOf("role" to "owner")

  @Test
  fun theWholeWorkspaceListsEveryRecord() {
    val scope = crmScopeOf("o1", null, "u1", emptyMap(), owner)
    assertTrue(scope.workspaceWide)
    assertNull(scope.readTokens)
    assertTrue(scopedQuery(scope, "contacts").filters.none { it.field == "visibleTo" })
    assertEquals(mapOf("orgId" to "o1"), scope.routeScope)
    assertTrue(scope.createTokens.isEmpty())
  }

  @Test
  fun aSiteScopeStillNarrowsItsReads() {
    val scope = crmScopeOf("o1", "h1", "u1", emptyMap(), owner)
    assertEquals(listOf("org", "host:h1"), scopedQuery(scope, "contacts").filters.single { it.field == "visibleTo" }.value)
  }

  @Test
  fun aNewRecordIsMadeOnThePickedSite() {
    val site = crmScopeOf("o1", null, "u1", emptyMap(), owner).forSite("h1")
    assertEquals("h1", site.hostId)
    assertEquals(listOf("org", "host:h1"), site.readTokens)
    assertEquals(listOf("host:h1"), site.createTokens)
  }
}
