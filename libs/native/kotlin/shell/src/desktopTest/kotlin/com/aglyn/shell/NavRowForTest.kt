package com.aglyn.shell

import com.aglyn.contracts.NativeNavListId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Which sidebar row a place sits under: what the breadcrumbs, the highlight and the docs link read. */
class NavRowForTest {
  private fun row(id: String, screen: String, params: Map<String, String> = emptyMap(), sections: List<NavSectionItem> = emptyList()) = NavItem(
    key = NavKeys.of(screen, params), rowId = id, listId = NativeNavListId.SITE, label = id, icon = "circle", screen = screen,
    params = params, description = null, sections = sections, actions = emptyList(), pluginId = null, keywords = emptyList(),
  )

  private val sell = NavGroupItem(
    "sell", "Sell", foldable = true, dynamic = null,
    rows = listOf(
      row("orders", "commerce.orders"),
      row("products", "commerce.products", sections = listOf(NavSectionItem(NavKeys.of("commerce.inventory"), "inventory", "Inventory", "commerce.inventory", emptyMap()))),
    ),
  )
  private val website = NavGroupItem("website", "Website", foldable = true, dynamic = null, rows = listOf(row("seo", "site.setup", mapOf("section" to "seo"))))
  private val groups = listOf(website, sell)

  @Test
  fun aRowsOwnKeyAndItsSectionsKeysFindIt() {
    assertEquals("orders", groups.rowFor(NavKeys.of("commerce.orders"))?.rowId)
    assertEquals("products", groups.rowFor(NavKeys.of("commerce.inventory"))?.rowId)
  }

  @Test
  fun aPlaceOpenedWithParamsOfItsOwnStillSitsUnderItsRow() {
    // An order picked from Recents or a link: the Orders row, so the page keeps its breadcrumbs (AGL-3946 pair review).
    assertEquals("orders", groups.rowFor(NavKeys.of("commerce.orders", mapOf("order" to "o-1042")))?.rowId)
    assertEquals("products", groups.rowFor(NavKeys.of("commerce.inventory", mapOf("q" to "tin")))?.rowId)
    assertEquals("seo", groups.rowFor(NavKeys.of("site.setup", mapOf("section" to "domains")))?.rowId)
  }

  @Test
  fun aScreenNoRowOpensHasNoRow() {
    assertNull(groups.rowFor(NavKeys.of("crm.contact", mapOf("id" to "c-1"))))
    assertNull(groups.rowFor("pushed:anything"))
  }
}
