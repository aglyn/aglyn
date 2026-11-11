// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.site

import com.aglyn.core.FirestoreDoc
import com.aglyn.core.rebased
import com.aglyn.core.seedCheckingText
import com.aglyn.site.content.ContentEntry
import com.aglyn.site.content.EntryDraft
import com.aglyn.site.setup.ThemeValues
import com.aglyn.site.setup.rebasedTheme
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * A newer copy under an open editor keeps what was typed and moves every other field to it (AGL-4047, the console's
 * `rebaseSeedEdits`, #2576 and #2581). The Apple SeedEditsTests assert the same.
 */
class SeedEditsTest {
  @Test
  fun aChangedValueKeepsItAndAnUntouchedOneFollowsTheNewCopy() {
    assertEquals("Mine", rebased("Mine", "Old", "Server"))
    assertEquals("Server", rebased("Old", "Old", "Server"))
    val fields = rebased(
      mapOf("title" to "Typed", "seo.title" to "Old", "cleared" to ""),
      mapOf("title" to "Old", "seo.title" to "Old", "cleared" to "Was"),
      mapOf("title" to "Server", "seo.title" to "Server", "cleared" to "Server", "added" to "New"),
    )
    assertEquals(mapOf("title" to "Typed", "seo.title" to "Server", "cleared" to "", "added" to "New"), fields)
    assertEquals("Checking your site settings with the server…", seedCheckingText("site settings"))
  }

  @Test
  fun theThemeEditorKeepsItsChangesOverANewerSavedTheme() {
    val previous = ThemeValues(mapOf("light" to mapOf("primary" to "#111111", "divider" to null)), "auto", "__system__", 4.0, null, null, null)
    val draft = previous.copy(colors = mapOf("light" to mapOf("primary" to "#222222", "divider" to null)), spacing = 6.0)
    val next = previous.copy(colors = mapOf("light" to mapOf("primary" to "#111111", "divider" to "#cccccc")), fontFamily = "Inter", spacing = 2.0)
    val out = rebasedTheme(draft, previous, next)
    assertEquals("#222222", out.colors["light"]?.get("primary"), "changed here")
    assertEquals("#cccccc", out.colors["light"]?.get("divider"), "untouched: the newer theme's")
    assertEquals("Inter", out.fontFamily)
    assertEquals(6.0, out.spacing)
    assertEquals(next, rebasedTheme(previous, previous, next), "an untouched editor is the newer theme")
  }

  @Test
  fun anEntryKeepsItsTypedFieldsOverANewerCopy() {
    fun draft(vararg fields: Pair<String, Any?>) =
      EntryDraft.of(ContentEntry.from(FirestoreDoc("e", "hosts/h/collections/c/entries/e", mapOf(*fields)))!!)
    val before = draft("title" to "Spring menu", "excerpt" to "Old", "tags" to listOf("a"))
    val typed = before.copy(title = "Spring menu 2026")
    val out = typed.rebased(before, draft("title" to "Spring menu", "excerpt" to "New", "tags" to listOf("a", "b")))
    assertEquals("Spring menu 2026", out.title)
    assertEquals("New", out.excerpt)
    assertEquals(listOf("a", "b"), out.tags)
  }
}
