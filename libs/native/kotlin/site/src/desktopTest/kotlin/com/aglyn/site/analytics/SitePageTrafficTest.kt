package com.aglyn.site.analytics

import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreFilter
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The console's `page-traffic.spec.ts` cases on the Kotlin port (AGL-4253), and the labels `site-page-labels.ts` gives. */
class SitePageTrafficTest {
  private val context = PagePathContext(
    routes = mapOf("home" to "/", "about" to "about", "tpl" to "blog", "pdp" to "pdp-template"),
    templateScreenIds = setOf("tpl", "pdp"),
    recordSegments = setOf("products"),
    contentCollectionSlugs = setOf("blog"),
  )

  @Test
  fun aRoutedPageIsAPage() {
    assertEquals(PagePathClass.Page("about"), classifyPagePath("/about", context))
    assertEquals(PagePathClass.Page("home"), classifyPagePath("/", context))
  }

  @Test
  fun aTemplateRoutedAtAPathIsNeverThePageThere() {
    assertEquals(PagePathClass.CollectionList("blog"), classifyPagePath("/blog", context))
    assertEquals(PagePathClass.Other, classifyPagePath("/pdp-template", context))
  }

  @Test
  fun aRecordAnEntryAndAPagedList() {
    assertEquals(PagePathClass.Record("products", "nova"), classifyPagePath("/products/nova", context))
    assertEquals(PagePathClass.Entry("blog", "hello"), classifyPagePath("/blog/hello", context))
    assertEquals(PagePathClass.CollectionList("blog"), classifyPagePath("/blog/page/2", context))
    assertEquals(PagePathClass.CollectionList("blog"), classifyPagePath("/blog/category/Open Source", context))
    assertEquals(PagePathClass.CollectionList("blog"), classifyPagePath("/blog/after/a%20b", context))
    assertEquals(PagePathClass.Other, classifyPagePath("/blog/page/0", context))
  }

  @Test
  fun anythingElseIsNotAPageOfTheSiteNow() {
    assertEquals(PagePathClass.Other, classifyPagePath("/wp-admin", context))
    assertEquals(PagePathClass.Other, classifyPagePath("/products/a/b", context))
  }

  @Test
  fun rollUpMergesOnePagesFormsAndDropsZeroCounts() {
    assertEquals(listOf("/" to 4.0, "a" to 3.0), rollUpPathViews(listOf(mapOf("/a" to 2.0, "/a/" to 1.0, "/b" to 0.0), mapOf("" to 4.0), emptyMap())))
    assertEquals("shop", normalizeCountedPath("/shop/"))
    assertEquals("shop", normalizeCountedPath("/shop?x=1"))
    assertEquals("/shop", displayCountedPath("shop"))
    assertEquals("/", displayCountedPath("/"))
  }

  @Test
  fun eachPathIsNamedForWhatItIs() {
    val facts = SitePageFacts(
      routes = mapOf("home" to "/", "pdp" to "pdp"),
      origin = "https://shop.example",
      collections = listOf(
        "c1" to mapOf("slug" to "blog", "displayName" to "Journal", "entryScreenId" to "pdp"),
        "c2" to mapOf("slug" to "summer", "kind" to "catalog", "name" to "Summer"),
      ),
    )
    val paths = listOf("/", "products/nova", "products/gone", "collections/summer", "blog", "blog/hello", "blog/missing", "wp-admin")
    val classes = paths.map { classifyPagePath(it, facts.context) }
    val reads = SitePageReads.of(classes)
    assertEquals(listOf("home"), reads.screenIds)
    assertEquals(listOf("nova", "gone"), reads.recordSlugs["products"])
    assertEquals(listOf("summer"), reads.recordSlugs["collections"])
    assertEquals(listOf("hello", "missing"), reads.entrySlugs["blog"])
    val found = SitePageFound(
      screens = mapOf("home" to mapOf("displayName" to "Welcome")),
      records = mapOf(
        "products" to mapOf("nova" to ("p1" to mapOf<String, Any?>("name" to "Nova Jacket"))),
        "collections" to mapOf("summer" to ("c2" to mapOf<String, Any?>("name" to "Summer", "kind" to "catalog"))),
      ),
      entries = mapOf("blog" to mapOf("hello" to ("e1" to mapOf<String, Any?>("title" to "Hello world")))),
    )
    val labels = paths.zip(classes).map { (path, one) -> sitePageLabel(path, one, facts, found) }

    assertEquals(SitePageLabel("/", SitePageGroup.PAGES, "Welcome", liveUrl = "https://shop.example", screenId = "home"), labels[0])
    assertEquals("Nova Jacket", labels[1].title)
    assertEquals(SitePageGroup("record:products", "Products"), labels[1].group)
    assertEquals("p1", labels[1].productId)
    assertEquals("https://shop.example/products/nova", labels[1].liveUrl)
    assertEquals("/products/gone", labels[2].title)
    assertEquals("Not a product on this site now", labels[2].note)
    assertNull(labels[2].liveUrl)
    assertEquals("Summer", labels[3].title)
    assertEquals("Collections", labels[3].group.label)
    assertNull(labels[3].productId)
    assertEquals("Journal (list page)", labels[4].title)
    assertEquals(SitePageGroup("content:blog", "Journal"), labels[4].group)
    assertEquals("Hello world", labels[5].title)
    assertEquals("Not in Journal now", labels[6].note)
    assertEquals(SitePageLabel("/wp-admin", SitePageGroup.OTHER, "/wp-admin", note = "No page answers this address now"), labels[7])
  }

  @Test
  fun aStoreCollectionIsOnlyACatalogOne() {
    assertTrue(SitePathKind.STORE_COLLECTIONS.accepts(mapOf("kind" to "catalog")))
    assertFalse(SitePathKind.STORE_COLLECTIONS.accepts(mapOf("kind" to "content")))
    assertTrue(SitePathKind.PRODUCTS.accepts(emptyMap()))
  }

  @Test
  fun kindsAreMostVisitedFirstAndOtherAddressesLast() {
    fun row(path: String, views: Double, group: SitePageGroup) = SitePageRow(path, views, SitePageLabel(path, group, path), null)
    val products = SitePageGroup("record:products", "Products")
    val groups = sitePageGroups(listOf(row("x", 50.0, SitePageGroup.OTHER), row("/", 5.0, SitePageGroup.PAGES), row("p/a", 4.0, products), row("p/b", 3.0, products)))
    assertEquals(listOf(products, SitePageGroup.PAGES, SitePageGroup.OTHER), groups.map { it.group })
    assertEquals(listOf(2, 1, 1), groups.map { it.count })
    assertEquals(listOf(7.0, 5.0, 50.0), groups.map { it.views })
  }

  @Test
  fun thePagesTableReadsTheWindowsDaysById() {
    val now = 1_792_108_800_000L // 2026-10-16T00:00:00Z
    val query = pagesDaysQuery("h1", 14, now)
    assertEquals(listOf(FirestoreFilter("__name__", FilterOp.GTE, "hosts/h1/analytics/2026-10-03")), query.filters)
    assertEquals(14, query.limit)
    assertEquals("https://shop.example", sitePublicOrigin(mapOf("cname" to "shop.example", "subdomain" to "shop")))
    assertEquals("https://shop.aglyn.app", sitePublicOrigin(mapOf("subdomain" to "shop")))
    assertNull(sitePublicOrigin(emptyMap()))
  }
}
