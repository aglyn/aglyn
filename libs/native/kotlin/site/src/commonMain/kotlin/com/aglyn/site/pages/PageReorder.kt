// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.site.pages

// Order within a level (the console's drag to reorder, AGL-2501): a page's place among its siblings, and the `index` the
// move route takes to put it one place earlier or later. The Apple kit's PagesTree.swift (`pageSiblingPlace`).

/** Where a page sits: its level's parent (null at the top level, or under a parent not read) and its place in order. */
data class PageSiblingPlace(val parentId: String?, val index: Int, val count: Int) {
  /** One place earlier; the route's index counts the siblings without the page. */
  val upIndex: Int? get() = if (index > 0) index - 1 else null

  /** One place later. */
  val downIndex: Int? get() = if (index < count - 1) index + 1 else null
}

/** The page's place among [pages] siblings, in the hub's order ([PAGE_SIBLING_ORDER]). */
fun pageSiblingPlace(id: String, pages: Map<String, PageNode>): PageSiblingPlace? {
  val page = pages[id] ?: return null
  fun level(node: PageNode): String? = node.parentId?.takeIf { it.isNotEmpty() && pages.containsKey(it) }
  val parent = level(page)
  val siblings = pages.values.filter { level(it) == parent }.sortedWith(PAGE_SIBLING_ORDER)
  val index = siblings.indexOfFirst { it.id == id }.takeIf { it >= 0 } ?: return null
  return PageSiblingPlace(parent, index, siblings.size)
}
