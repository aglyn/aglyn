package com.aglyn.shell

import com.aglyn.core.FirestoreDoc
import kotlin.test.Test
import kotlin.test.assertEquals

class PagesScreenTest {
  private fun screen(id: String, vararg fields: Pair<String, Any?>) = FirestoreDoc(id, "hosts/h1/screens/$id", mapOf(*fields))

  @Test
  fun listsPagesHomeFirstLeavingOutDeletedEmailsAndGroups() {
    val rows = pageRows(
      listOf(
        screen("menu", "displayName" to "Menu", "slug" to "menu", "versionId" to "menu-v1", "publishedAt" to 1L),
        screen("home", "displayName" to "Home", "slug" to "", "versionId" to "home-v3", "publishedAt" to 1L),
        screen("about", "displayName" to "about us", "slug" to "about"),
        screen("gone", "displayName" to "Gone", "deletedAt" to 1L),
        screen("mail", "displayName" to "Receipt", "kind" to "email"),
        screen("folder", "displayName" to "Folder", "kind" to "group"),
      ),
      homeScreenId = "home",
    )
    assertEquals(listOf("home", "about", "menu"), rows.map { it.id })
    assertEquals(PageRow("home", "Home", "", "home-v3", published = true, home = true), rows[0])
    assertEquals(null, rows[1].versionId)
    assertEquals(false, rows[1].published)
  }
}
