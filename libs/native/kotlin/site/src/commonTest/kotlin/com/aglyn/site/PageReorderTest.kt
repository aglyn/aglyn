// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.site

import com.aglyn.core.FirestoreDoc
import com.aglyn.site.pages.PageNode
import com.aglyn.site.pages.PageSiblingPlace
import com.aglyn.site.pages.pageSiblingPlace
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class PageReorderTest {
  private fun page(id: String, parent: String? = null, order: Long? = null): Pair<String, PageNode> = id to PageNode.from(
    FirestoreDoc(id, "hosts/h/screens/$id", buildMap { put("displayName", id); parent?.let { put("parentId", it) }; order?.let { put("order", it) } }),
  )!!

  @Test
  fun countsAPagesPlaceAmongItsSiblingsInTheHubsOrder() {
    val all = mapOf(
      page("home", order = 0), page("about", order = 1), page("pricing", order = 2),
      page("team", "about", 0), page("careers", "about", 1), page("orphan", "gone"),
    )
    assertEquals(PageSiblingPlace(null, 0, 4), pageSiblingPlace("home", all))
    assertNull(pageSiblingPlace("home", all)?.upIndex)
    assertEquals(1, pageSiblingPlace("home", all)?.downIndex)
    // A page under a parent not read sits at the top level, after every ordered page.
    assertEquals(PageSiblingPlace(null, 3, 4), pageSiblingPlace("orphan", all))
    assertNull(pageSiblingPlace("orphan", all)?.downIndex)
    val careers = pageSiblingPlace("careers", all)
    assertEquals(PageSiblingPlace("about", 1, 2), careers)
    assertEquals(0, careers?.upIndex)
    assertNull(careers?.downIndex)
    assertNull(pageSiblingPlace("nope", all))
  }
}
