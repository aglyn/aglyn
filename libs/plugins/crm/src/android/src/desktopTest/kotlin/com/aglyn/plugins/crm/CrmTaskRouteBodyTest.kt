package com.aglyn.plugins.crm

import kotlin.test.Test
import kotlin.test.assertEquals

/** What the task routes are sent: the scope always, and only the fields a call names. */
class CrmTaskRouteBodyTest {
  private val owner = mapOf("role" to "owner")

  @Test
  fun aSiteSaveKeepsItsSiteWhenTheTaskNamesNoFilingSite() {
    val site = crmScopeOf("o1", "h1", "u1", emptyMap(), owner)
    // A new task saved on a site: no filing site of its own, which must not take the site's place.
    assertEquals(mapOf("hostId" to "h1", "task" to "t"), crmTaskRouteBody(site, "taskId" to null, "hostId" to null, "task" to "t"))
    assertEquals(mapOf("hostId" to "h1", "taskId" to "x"), crmTaskRouteBody(site, "taskId" to "x"))
  }

  @Test
  fun theWorkspacesOwnCrmNamesTheOrgAndAFilingSiteWhenThereIsOne() {
    val workspace = crmScopeOf("o1", null, "u1", emptyMap(), owner)
    assertEquals(mapOf("orgId" to "o1", "task" to "t"), crmTaskRouteBody(workspace, "hostId" to null, "task" to "t"))
    assertEquals(mapOf("orgId" to "o1", "hostId" to "h2", "task" to "t"), crmTaskRouteBody(workspace, "hostId" to "h2", "task" to "t"))
  }
}
