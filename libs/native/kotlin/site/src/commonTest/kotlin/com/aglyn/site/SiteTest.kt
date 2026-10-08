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
import com.aglyn.site.artifacts.ArtifactKind
import com.aglyn.site.artifacts.ArtifactRow
import com.aglyn.site.artifacts.ArtifactVersion
import com.aglyn.site.artifacts.artifactBesignerPath
import com.aglyn.site.artifacts.artifactQuery
import com.aglyn.site.artifacts.nestableParents
import com.aglyn.site.artifacts.versionToOpen
import com.aglyn.core.FirestoreDelete
import com.aglyn.site.content.ContentCategory
import com.aglyn.site.content.ContentCollection
import com.aglyn.site.content.ContentEntry
import com.aglyn.site.content.EntryDraft
import com.aglyn.site.content.contentSlug
import com.aglyn.site.content.entryQuery
import com.aglyn.site.content.newCategoryId
import com.aglyn.site.content.sortedCollections
import com.aglyn.site.setup.SetupSection
import com.aglyn.site.setup.ThemeEdit
import com.aglyn.site.setup.ThemeValues
import com.aglyn.site.setup.TRACKING_FIELDS
import com.aglyn.site.setup.parseLocales
import com.aglyn.site.setup.settingsPayload
import com.aglyn.site.setup.themeEdits
import com.aglyn.site.setup.trackingError
import com.aglyn.site.setup.verificationError
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

  @Test
  fun plansTheArtifactListsAsTheConsoleDoes() {
    val components = artifactQuery(ArtifactKind.COMPONENT, "h", "Hero ban", "email")
    assertEquals("hosts/h/components", components.collectionPath)
    assertTrue(FirestoreFilter("kind", FilterOp.EQ, "email") in components.filters)
    assertTrue(FirestoreFilter("nameTokens", FilterOp.ARRAY_CONTAINS, "hero") in components.filters)
    assertEquals(listOf(FirestoreOrder("__name__")), components.orderBy)
    // The template library lists only its library rows.
    val templates = artifactQuery(ArtifactKind.TEMPLATE, "h", "", null)
    assertTrue(FirestoreFilter("libraryRow", FilterOp.EQ, true) in templates.filters)
    assertEquals("hosts/h/layouts", artifactQuery(ArtifactKind.LAYOUT, "h", "", null).collectionPath)
  }

  @Test
  fun readsArtifactsAndPicksTheVersionTheBesignerOpens() {
    val row = ArtifactRow.from(FirestoreDoc("c1", "hosts/h/components/c1", mapOf("displayName" to "Hero", "kind" to "email")))!!
    assertNull(ArtifactRow.from(FirestoreDoc("c2", "hosts/h/components/c2", mapOf("deletedAt" to FirestoreTimestamp(1)))))
    val versions = listOf(ArtifactVersion("old", null, FirestoreTimestamp(1), null), ArtifactVersion("new", null, FirestoreTimestamp(5), null))
    assertEquals("new", versionToOpen(row, versions))
    assertEquals("old", versionToOpen(row, versions, asked = "old"))
    assertNull(versionToOpen(row, emptyList()))
    assertEquals("/components/c1/versions/v1/besigner", artifactBesignerPath(ArtifactKind.COMPONENT, "c1", "v1"))
    assertEquals("/templates/t1/preview", artifactBesignerPath(ArtifactKind.TEMPLATE, "t1", null, preview = true))
    assertTrue(com.aglyn.pluginhost.BesignerPaths.isBesignerPath("/acme/hosts/shop" + artifactBesignerPath(ArtifactKind.LAYOUT, "l1", "v1")!!))
  }

  @Test
  fun neverNestsALayoutInsideItself() {
    fun layout(id: String, parent: String?) = ArtifactRow.from(FirestoreDoc(id, "hosts/h/layouts/$id", mapOf("displayName" to id, "layoutId" to parent)))!!
    val layouts = listOf(layout("a", null), layout("b", "a"), layout("c", "b"), layout("d", null))
    // b sits under a; c under b. a may not go inside b or c (its own descendants).
    assertEquals(listOf("d"), nestableParents("a", layouts).map { it.id })
    assertEquals(listOf("a", "b", "d"), nestableParents("c", layouts).map { it.id })
  }

  @Test
  fun opensTheArtifactListsNatively() {
    val links = registry.deepLinks()
    assertEquals(NativeLinkTarget.Screen("site.components", mapOf("orgSlug" to "acme", "hostSlug" to "shop")), DeepLinks.resolve("/acme/hosts/shop/components", links))
    assertEquals(NativeLinkTarget.Screen("site.layouts", mapOf("orgSlug" to "acme", "hostSlug" to "shop", "id" to "l1")), DeepLinks.resolve("/acme/hosts/shop/layouts/l1", links))
    assertEquals(NativeLinkTarget.Screen("site.layouts", mapOf("orgSlug" to "acme", "hostSlug" to "shop")), DeepLinks.resolve("/acme/hosts/shop/layouts/list", links))
    assertEquals(NativeLinkTarget.Besigner("/acme/hosts/shop/components/c1/versions/v1/besigner"), DeepLinks.resolve("/acme/hosts/shop/components/c1/versions/v1/besigner", links))
    assertEquals(NativeLinkTarget.Besigner("/acme/hosts/shop/templates/t1/besigner"), DeepLinks.resolve("/acme/hosts/shop/templates/t1/besigner", links))
  }

  @Test
  fun buildsTheSettingsSaveAsTheConsoleForm() {
    val stored = mapOf("seo" to mapOf("title" to "Old", "titlePattern" to "{{page.name}}"))
    val payload = settingsPayload(
      mapOf("seo.title" to " New title ", "seo.titlePattern" to "", "seo.verification.google" to ""),
      stored,
      clearable = setOf("seo.titlePattern", "seo.verification.google"),
    )
    // A blank clearable field the site holds is deleted; one it never held is left out.
    assertEquals(mapOf("seo" to mapOf("title" to "New title", "titlePattern" to FirestoreDelete)), payload)
    assertEquals(SetupSection.SEO, SetupSection.of("hostSeo"))
    assertEquals(SetupSection.THEME, SetupSection.of("theme"))
    assertEquals(SetupSection.DETAILS, SetupSection.of(null))
  }

  @Test
  fun checksTrackingIdsLanguagesAndVerificationPastes() {
    val ga = TRACKING_FIELDS.first { it.path == "analytics.gaMeasurementId" }
    assertNull(trackingError(ga, "G-ABC1234"))
    assertNull(trackingError(ga, ""))
    assertTrue(trackingError(ga, "UA-1234") != null)
    assertEquals(listOf("en", "pt-BR") to null, parseLocales("en, pt-BR, en"))
    assertTrue(parseLocales("english").second != null)
    val names = mapOf("google" to "google-site-verification", "bing" to "msvalidate.01")
    val labels = mapOf("google" to "Google Search Console", "bing" to "Bing Webmaster Tools")
    assertNull(verificationError("google", "<meta name=\"google-site-verification\" content=\"abc_123\" />", names, labels))
    assertEquals(
      "That tag is for Bing Webmaster Tools — paste it in that field instead",
      verificationError("google", "<meta name=\"msvalidate.01\" content=\"ABC\" />", names, labels),
    )
  }

  @Test
  fun sendsOnlyTheThemeControlsThatChanged() {
    val before = ThemeValues(mapOf("light" to mapOf("primary" to "#111111", "divider" to null)), "auto", "__system__", 4.0, null, null, null)
    val after = before.copy(colors = mapOf("light" to mapOf("primary" to "#222222", "divider" to null)), fontFamily = "Inter", spacing = 6.0)
    assertEquals(
      listOf(ThemeEdit.Color("light", "primary", "#222222"), ThemeEdit.FontFamily("Inter"), ThemeEdit.Spacing(6.0)),
      themeEdits(before, after),
    )
    assertTrue(themeEdits(before, before).isEmpty())
  }

  @Test
  fun readsCollectionsAndPlansTheEntriesQuery() {
    val docs = listOf(
      FirestoreDoc("blog", "hosts/h/collections/blog", mapOf("displayName" to "Blog", "slug" to "blog", "categories" to listOf(mapOf("id" to "news", "name" to "News")))),
      FirestoreDoc("menu", "hosts/h/collections/menu", mapOf("displayName" to "Menu", "kind" to "catalog")),
      FirestoreDoc("a", "hosts/h/collections/a", mapOf("displayName" to "Announcements", "kind" to "content", "slug" to "news")),
    )
    assertEquals(listOf("a", "blog"), sortedCollections(docs).map(ContentCollection::id))
    val query = entryQuery("h", "blog", "published", "Spring men")
    assertEquals("hosts/h/collections/blog/entries", query.collectionPath)
    assertTrue(FirestoreFilter("status", FilterOp.EQ, "published") in query.filters)
    assertTrue(FirestoreFilter("titleTokens", FilterOp.ARRAY_CONTAINS, "spring") in query.filters)
    assertEquals("spring-menu-2026", contentSlug("  Spring Menu — 2026! "))
    assertEquals("news-2", newCategoryId("News", listOf(ContentCategory("news", "News"))))
  }

  @Test
  fun savesAnEntryAsTheEditorDoes() {
    val entry = ContentEntry.from(FirestoreDoc("e1", "hosts/h/collections/blog/entries/e1", mapOf("title" to "Spring", "slug" to "spring", "category" to "Old", "status" to "draft")))
    val draft = EntryDraft.of(entry).copy(title = "Spring menu", slug = "", categoryId = "news", coverImage = "", coverImageAlt = "ignored", tags = listOf(" a ", ""))
    val payload = draft.payload()
    assertEquals("spring-menu", payload["slug"])
    assertEquals(listOf("s", "sp", "spr", "spri", "sprin", "spring", "m", "me", "men", "menu"), payload["titleTokens"])
    assertEquals(FirestoreDelete, payload["coverImageAlt"])
    assertEquals(FirestoreDelete, payload["category"])
    assertEquals(listOf("a"), payload["tags"])
    assertEquals(false, entry.hasByline)
  }
}
