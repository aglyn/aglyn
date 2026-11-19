package com.aglyn.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** The picker's Plan, Your role and Pinned filters (the console's WORKSPACE_FILTER_FIELDS). */
class WorkspacePickerFilterTest {
  @Test
  fun eachFilterIsAnExactMatch() {
    val acme = WorkspaceOrg("a", "Acme", "acme", "owner")
    assertTrue(WorkspacePickerFilter().admits(acme, null, false))
    assertTrue(WorkspacePickerFilter(plan = "pro").admits(acme, "pro", false))
    assertFalse(WorkspacePickerFilter(plan = "pro").admits(acme, null, false), "a plan not yet read is no match")
    assertFalse(WorkspacePickerFilter(role = "admin").admits(acme, "pro", false))
    assertTrue(WorkspacePickerFilter(role = "owner", pinned = true).admits(acme, "pro", true))
    assertFalse(WorkspacePickerFilter(pinned = false).admits(acme, "pro", true))
    assertEquals(2, WorkspacePickerFilter(plan = "pro", pinned = true).count)
    assertEquals("Free", WorkspacePickerFilter.PLANS.first().second)
  }
}
