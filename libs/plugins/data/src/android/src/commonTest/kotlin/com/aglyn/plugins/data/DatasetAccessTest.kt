package com.aglyn.plugins.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DatasetAccessTest {
  private val writer = mapOf("data.manage" to true, "org.eraseRecords" to true, "data.viewRecords" to true, "data.export" to true)
  private fun site(role: String?, stamp: Map<String, Boolean> = emptyMap()): Map<String, Any?> =
    mapOf("memberRoles" to (role?.let { mapOf("u" to it) } ?: emptyMap<String, String>()), "memberPermissions" to mapOf("u" to stamp))

  @Test fun onePlacementIsOneHostToken() {
    assertEquals("h1", oneSitePlacement(listOf("host:h1")))
    assertNull(oneSitePlacement(listOf("host:h1", "host:h2")))
    assertNull(oneSitePlacement(listOf("org:*")))
    assertNull(oneSitePlacement(null))
  }

  @Test fun everySiteAnswersToTheWorkspaceKey() {
    val access = datasetAccess(writer, true, "editor", listOf("org:*"), null, "u")
    assertTrue(access.canWrite)
    assertEquals("Your role does not include \"Manage data\" — ask an organization admin", datasetAccess(emptyMap(), true, "viewer", listOf("org:*"), null, "u").writeRefusal)
  }

  @Test fun aSiteNarrowsAWorkspaceWriterButSharingStaysTheirs() {
    val access = datasetAccess(writer, true, "editor", listOf("host:h1"), site("viewer", mapOf("data.siteManage" to false)), "u")
    assertFalse(access.canWrite)
    assertTrue(access.sharingOnly)
    assertTrue(access.writeRefusal.contains("Manage this site"))
  }

  @Test fun aSiteRaisesAViewer() {
    assertTrue(datasetAccess(emptyMap(), true, "viewer", listOf("host:h1"), site("editor", mapOf("data.siteManage" to true)), "u").canWrite)
  }

  @Test fun aSiteMemberCannotDeleteWhatIsSharedBeyondOneSite() {
    val access = datasetAccess(writer, false, "editor", listOf("host:h1", "host:h2"), null, "u")
    assertFalse(access.canDelete)
    assertTrue(access.deleteRefusal.startsWith("This dataset is shared beyond one site"))
  }

  @Test fun readsAndExportsAskTheirOwnKeys() {
    val access = datasetAccess(mapOf("data.viewRecords" to false, "data.export" to false), true, "viewer", listOf("org:*"), null, "u")
    assertFalse(access.canRead)
    assertFalse(access.canExport)
  }
}
