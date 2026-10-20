package com.aglyn.site

import com.aglyn.contracts.ListQueryOp
import com.aglyn.contracts.MediaSort
import com.aglyn.core.FirestoreDoc
import com.aglyn.site.media.FolderPick
import com.aglyn.site.media.MediaFolder
import com.aglyn.site.media.MediaGridMove
import com.aglyn.site.media.MediaItem
import com.aglyn.site.media.mediaDeletedMessage
import com.aglyn.site.media.mediaFileType
import com.aglyn.site.media.mediaFolderIds
import com.aglyn.site.media.mediaFolderSubtree
import com.aglyn.site.media.mediaGridStep
import com.aglyn.site.media.mediaIconSize
import com.aglyn.site.media.mediaRequest
import com.aglyn.site.media.mediaRestoredMessage
import com.aglyn.site.media.mediaSelection
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The media file browser's pure parts (AGL-4004), as Apple's MediaBrowserTests: what a tile says a file is, which
 * preview it asks the CDN for, the subfolders a view reads, the keyboard's walk through the grid, and what a click selects.
 */
class MediaBrowserTest {
  private fun item(fields: Map<String, Any?>) = MediaItem.from(FirestoreDoc("m1", "hosts/h/media/m1", fields))!!

  @Test
  fun theTypeLabelIsTheConsolesMap() {
    assertEquals("PDF", mediaFileType("application/pdf").second)
    assertEquals("XLSX", mediaFileType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").second)
    assertEquals("CSV", mediaFileType("text/csv; charset=utf-8").second)
    assertEquals("MP3", mediaFileType("audio/mpeg").second)
    assertEquals("SVG", mediaFileType("image/svg+xml").second)
    assertEquals("JPEG", mediaFileType("image/jpeg").second)
    assertEquals("movie", mediaFileType("video/mp4").first)
    assertEquals("FILE", mediaFileType("").second)
    assertEquals("insert_drive_file", mediaFileType("application/x-unknown").first)
  }

  @Test
  fun theCaptionIsTypeAndSize() {
    val pdf = item(mapOf("fileName" to "menu.pdf", "contentType" to "application/pdf", "kind" to "pdf", "sizeBytes" to 1_310_720L))
    assertEquals("PDF · 1.2 MB", pdf.caption)
  }

  @Test
  fun anSvgAsksForTheIconPngNotAWidthVariant() {
    val svg = item(mapOf("contentType" to "image/svg+xml", "kind" to "image", "cdnPath" to "/api/media/cdn/h/m1"))
    assertEquals("https://app.test/api/media/cdn/h/m1?icon=png-384", svg.thumbnail("https://app.test/", 320))
    assertEquals(512, mediaIconSize(640))
    val png = item(mapOf("contentType" to "image/png", "kind" to "image", "cdnPath" to "/api/media/cdn/h/m1"))
    assertEquals("https://app.test/api/media/cdn/h/m1?w=320", png.thumbnail("https://app.test", 320))
  }

  @Test
  fun aFilmShowsItsPosterOnlyWhenItHasOne() {
    assertNull(item(mapOf("contentType" to "video/mp4", "kind" to "video", "cdnPath" to "/api/media/cdn/h/m1")).thumbnail("https://app.test"))
    val posted = item(mapOf("contentType" to "video/mp4", "kind" to "video", "cdnPath" to "/api/media/cdn/h/m1", "poster" to mapOf("path" to "p.jpg")))
    assertEquals("https://app.test/api/media/cdn/h/m1?poster=1&w=320", posted.thumbnail("https://app.test"))
  }

  @Test
  fun includeSubfoldersReadsTheSubtreeUntilItPassesThirty() {
    val folders = listOf(
      MediaFolder("a", "A", null, null),
      MediaFolder("b", "B", "a", null),
      MediaFolder("c", "C", "b", null),
      MediaFolder("d", "D", null, null),
    )
    val subtree = mediaFolderSubtree("a", folders)
    assertEquals(listOf("a", "b", "c"), subtree)
    assertEquals(listOf("a", "b", "c"), mediaFolderIds(FolderPick.One("a"), subtree, null).first)
    // Two scope tokens times sixteen folders passes Firestore's thirty disjunctions: only the open folder is read.
    val wide = listOf("a") + (1..15).map { "s$it" }
    val dropped = mediaFolderIds(FolderPick.One("a"), wide, listOf("org", "host:h"))
    assertEquals(listOf("a"), dropped.first)
    assertTrue(dropped.second)
    val request = mediaRequest(FolderPick.One("a"), null, null, MediaSort.NEWEST, "", subtree = subtree)
    assertEquals(ListQueryOp.IN, request.base?.first()?.op)
  }

  @Test
  fun arrowsWalkTheGridByRowAndColumn() {
    val ids = listOf("f:1", "a", "b", "c", "d", "e")
    assertEquals("f:1", mediaGridStep(ids, null, 3, MediaGridMove.DOWN))
    assertEquals("b", mediaGridStep(ids, "a", 3, MediaGridMove.RIGHT))
    assertEquals("d", mediaGridStep(ids, "a", 3, MediaGridMove.DOWN))
    assertNull(mediaGridStep(ids, "b", 3, MediaGridMove.UP))
    assertNull(mediaGridStep(ids, "e", 3, MediaGridMove.RIGHT))
  }

  @Test
  fun aClickSelectsTogglesOrExtendsTheRun() {
    val order = listOf("a", "b", "c", "d")
    assertEquals(setOf("c"), mediaSelection(setOf("a"), "a", "c", toggle = false, range = false, order = order))
    assertEquals(setOf("a", "c"), mediaSelection(setOf("a"), "a", "c", toggle = true, range = false, order = order))
    assertEquals(setOf("a"), mediaSelection(setOf("a", "c"), "a", "c", toggle = true, range = false, order = order))
    assertEquals(setOf("a", "b", "c"), mediaSelection(setOf("a"), "a", "c", toggle = false, range = true, order = order))
  }

  @Test
  fun aBulkDeleteNamesWhatItDeleted() {
    assertEquals("Deleted \"a.jpg\"", mediaDeletedMessage(listOf("a.jpg")))
    assertEquals("Deleted 2 files: \"a\" and \"b\"", mediaDeletedMessage(listOf("a", "b")))
    assertEquals("Deleted 5 files: \"a\", \"b\", \"c\" and 2 more", mediaDeletedMessage(listOf("a", "b", "c", "d", "e")))
    assertEquals("Restored 3 files: \"a\", \"b\" and \"c\"", mediaRestoredMessage(listOf("a", "b", "c")))
  }
}
