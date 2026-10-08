package com.aglyn.site

import com.aglyn.contracts.MediaSort
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.pluginhost.DeepLinks
import com.aglyn.pluginhost.NativeLinkTarget
import com.aglyn.pluginhost.NativePluginRegistry
import com.aglyn.site.media.FolderPick
import com.aglyn.site.media.MediaItem
import com.aglyn.site.media.MediaScope
import com.aglyn.site.media.formatBytes
import com.aglyn.site.media.mediaQuery
import com.aglyn.site.pages.PageNode
import com.aglyn.site.pages.SiteRouting
import com.aglyn.site.pages.livePageUrl
import com.aglyn.site.pages.movableParents
import com.aglyn.site.pages.pageStatus
import com.aglyn.site.pages.pageTree
import com.aglyn.site.sites.SiteDomainFilter
import com.aglyn.site.sites.SUBDOMAIN_PATTERN
import com.aglyn.site.sites.suggestSubdomain
import com.aglyn.core.listquery.planListQuery
import com.aglyn.core.listquery.toFirestoreQuery
import com.aglyn.contracts.Contracts
import com.aglyn.site.sites.sitesRequest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SiteTest {
  private val registry = NativePluginRegistry().also { registry ->
    val result = registry.load(listOf(SitePlatformEntry))
    assertEquals(listOf(SITE_PLATFORM_ID), result.loaded, result.failed.toString())
  }

  private fun doc(id: String, vararg fields: Pair<String, Any?>) = FirestoreDoc(id, "hosts/h/screens/$id", mapOf(*fields))

  @Test
  fun registersEveryDeclaredContribution() {
    assertTrue(registry.screen("site.pages")!!.requiresSite)
    assertEquals(listOf("site.sites-open", "site.pages-open", "site.media-open"), registry.quickActions().map { it.id })
  }

  @Test
  fun opensTheConsolesPagesSitesAndMediaNatively() {
    val links = registry.deepLinks()
    assertEquals(NativeLinkTarget.Screen("site.pages", mapOf("orgSlug" to "acme", "hostSlug" to "shop")), DeepLinks.resolve("https://app.aglyn.com/acme/hosts/shop/screens", links))
    assertEquals(
      NativeLinkTarget.Screen("site.pages", mapOf("orgSlug" to "acme", "hostSlug" to "shop", "screenId" to "p1", "versionId" to "v1")),
      DeepLinks.resolve("/acme/hosts/shop/screens/p1/versions/v1/view", links),
    )
    assertEquals(NativeLinkTarget.Screen("site.sites", mapOf("orgSlug" to "acme")), DeepLinks.resolve("/acme/hosts", links))
    assertEquals(NativeLinkTarget.Screen("site.media", mapOf("orgSlug" to "acme")), DeepLinks.resolve("/acme/media", links))
    // The Besigner itself still opens in the web view.
    assertEquals(NativeLinkTarget.Besigner("/acme/hosts/shop/screens/p1/versions/v1/besigner"), DeepLinks.resolve("/acme/hosts/shop/screens/p1/versions/v1/besigner", links))
  }

  @Test
  fun buildsTheHubTreeInSiblingOrderWithLiveAddresses() {
    val pages = listOfNotNull(
      PageNode.from(doc("home", "displayName" to "Home", "slug" to "/", "order" to 0L)),
      PageNode.from(doc("blog", "displayName" to "Blog", "slug" to "blog", "order" to 2L)),
      PageNode.from(doc("post", "displayName" to "Post", "slug" to "post", "parentId" to "blog")),
      PageNode.from(doc("folder", "displayName" to "Legal", "kind" to "group", "order" to 1L)),
      PageNode.from(doc("terms", "displayName" to "Terms", "slug" to "terms", "parentId" to "folder")),
      PageNode.from(doc("orphan", "displayName" to "Orphan", "parentId" to "missing", "order" to 3L)),
      PageNode.from(doc("gone", "displayName" to "Gone", "deletedAt" to FirestoreTimestamp(1))),
      PageNode.from(doc("mail", "displayName" to "Mail", "kind" to "email")),
    )
    val routing = SiteRouting(mapOf("home" to "/", "post" to "blog/post", "terms" to "terms"), subdomain = "shop")
    val tree = pageTree(pages, routing)
    assertEquals(listOf("home", "folder", "terms", "blog", "post", "orphan"), tree.map { it.page.id })
    assertEquals(listOf(0, 0, 1, 0, 1, 0), tree.map { it.depth })
    assertEquals("/blog/post", tree.first { it.page.id == "post" }.livePath)
    assertTrue(tree.first().home)
    assertEquals("Draft", pageStatus(tree.first { it.page.id == "blog" }).label)
    assertEquals("Group", pageStatus(tree.first { it.page.id == "folder" }).label)
    assertEquals("https://shop.aglyn.app/blog/post", livePageUrl(routing, "/blog/post"))
    assertEquals(listOf("folder", "home", "orphan", "terms"), movableParents(pages, "blog").map { it.id }.sorted())
  }

  @Test
  fun plansTheSitesListOnTheMembersOwnRows() {
    val query = planListQuery(Contracts.siteListDeclaration, sitesRequest("org1", "dem", SiteDomainFilter.CONNECTED))
      .toFirestoreQuery("users/u/hostMemberships", 30)
    assertTrue(FirestoreFilter("orgId", FilterOp.EQ, "org1") in query.filters)
    assertTrue(FirestoreFilter("hasCustomDomain", FilterOp.EQ, true) in query.filters)
    assertTrue(FirestoreFilter("searchTokens", FilterOp.ARRAY_CONTAINS, "dem") in query.filters)
    assertEquals("my-new-site", suggestSubdomain("My New Site!"))
    assertTrue(SUBDOMAIN_PATTERN.matches("my-new-site"))
  }

  @Test
  fun plansTheLibraryQueryAsTheConsoleDoes() {
    val site = mediaQuery(MediaScope.Site("h"), FolderPick.One("f1"), null, "image", MediaSort.NAME, "Hero-banner")
    assertEquals("hosts/h/media", site.collectionPath)
    assertTrue(FirestoreFilter("folderId", FilterOp.EQ, "f1") in site.filters)
    assertTrue(FirestoreFilter("kind", FilterOp.EQ, "image") in site.filters)
    assertTrue(FirestoreFilter("nameTokens", FilterOp.ARRAY_CONTAINS, "hero") in site.filters)
    assertEquals(listOf(FirestoreOrder("nameLower")), site.orderBy)
    // A reader limited to some sites: the scope is the array clause, and search is "starts with".
    val scoped = mediaQuery(MediaScope.Org("o", "h"), FolderPick.Root, listOf("org", "host:h"), null, MediaSort.NEWEST, "Hero")
    assertEquals("orgs/o/media", scoped.collectionPath)
    assertTrue(FirestoreFilter("visibleTo", FilterOp.ARRAY_CONTAINS_ANY, listOf("org", "host:h")) in scoped.filters)
    assertTrue(FirestoreFilter("folderId", FilterOp.EQ, null) in scoped.filters)
    assertTrue(scoped.filters.none { it.field == "nameTokens" })
  }

  @Test
  fun readsAFileAndBuildsItsAddresses() {
    val item = MediaItem.from(
      FirestoreDoc("m1", "hosts/h/media/m1", mapOf("fileName" to "hero.jpg", "contentType" to "image/jpeg", "sizeBytes" to 2_621_440L, "cdnPath" to "/api/media/cdn/h/m1")),
    )!!
    assertEquals("https://console.test/api/media/cdn/h/m1", item.src("https://console.test"))
    assertEquals("https://console.test/api/media/cdn/h/m1?w=320", item.thumbnail("https://console.test"))
    assertEquals("2.5 MB", formatBytes(item.sizeBytes))
    assertNull(MediaItem.from(FirestoreDoc("m2", "hosts/h/media/m2", mapOf("deletedAt" to FirestoreTimestamp(1)))))
  }
}
