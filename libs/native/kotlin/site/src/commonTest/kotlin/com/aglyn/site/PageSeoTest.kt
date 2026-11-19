package com.aglyn.site

import com.aglyn.site.pages.PageSeo
import com.aglyn.site.pages.PageSocialImage
import com.aglyn.site.pages.buildScreenSeoUpdate
import com.aglyn.site.pages.hasSeoTitleVariables
import com.aglyn.site.pages.inheritedSocialImageAlt
import com.aglyn.site.pages.resolveSeoTitleVariables
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The Apple `PageSeoTests` cases. */
class PageSeoTest {
  private fun resolve(title: String, site: String, sep: String) = resolveSeoTitleVariables(title, " Menu ", site, sep)

  @Test
  fun resolvesTitleVariablesAsTheLivePageRendersThem() {
    assertEquals("Menu | Bakery", resolve("{{page.name}} {{site.separator}} {{site.name}}", "Bakery", "|"))
    assertEquals("Menu – Bakery", resolve("{{page.name}} {{site.separator}} {{site.name}}", "Bakery", ""))
    assertEquals("Menu", resolve("{{page.name}} {{site.separator}} {{site.name}}", "", "|"))
    assertEquals("Menu {{oops}}", resolve("{{ page.name }} {{oops}}", "", ""))
    assertEquals("  Plain  title ", resolve("  Plain  title ", "", ""))
    assertTrue(hasSeoTitleVariables("a {{site.name}}"))
  }

  @Test
  fun aSaveCarriesForwardWhatTheCardDoesNotEdit() {
    val existing = mapOf("title" to "Old", "breadcrumb" to "Crumb", "image" to "media:h/1", "imageWidth" to 1200L, "imageHeight" to 630L, "keep" to true)
    val titled = buildScreenSeoUpdate(existing, "  New ", null, null, null)
    assertEquals("New", titled?.get("title"))
    assertEquals("Crumb", titled?.get("breadcrumb"))
    assertEquals(1200L, titled?.get("imageWidth"))
    assertEquals(true, titled?.get("keep"))
    val cleared = buildScreenSeoUpdate(existing, " ", null, null, PageSocialImage("", 0, 0, ""))
    assertNull(cleared?.get("title"))
    assertNull(cleared?.get("image"))
    assertNull(cleared?.get("imageHeight"))
    val picked = buildScreenSeoUpdate(null, null, null, null, PageSocialImage("media:h/2", 800, 400, "  "))
    assertEquals("media:h/2", picked?.get("image"))
    assertNull(picked?.get("imageAlt"))
    assertNull(buildScreenSeoUpdate(mapOf("title" to "x"), "", null, null, null))
  }

  @Test
  fun readsTheStoredSeoAndTheAltAPickBrings() {
    val seo = PageSeo.from(mapOf("title" to "T", "image" to "media:h/1", "imageWidth" to 1200L, "imageHeight" to 630L, "imageAlt" to "A cake"))
    assertEquals(PageSocialImage("media:h/1", 1200, 630, "A cake"), seo.image)
    assertNull(PageSeo.from(null).image)
    assertEquals("Bread", inheritedSocialImageAlt("", " Bread "))
    assertEquals("Mine", inheritedSocialImageAlt("Mine", "Bread"))
  }
}
