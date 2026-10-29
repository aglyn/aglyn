package com.aglyn.site

import com.aglyn.contracts.MediaSort
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.FilterOp
import com.aglyn.ui.PickedFile
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.assertFailsWith
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.pluginhost.DeepLinks
import com.aglyn.pluginhost.NativeLinkTarget
import com.aglyn.pluginhost.NativePluginRegistry
import com.aglyn.site.media.ChosenMedia
import com.aglyn.site.media.FolderPick
import com.aglyn.site.media.MediaFilters
import com.aglyn.site.media.MediaItem
import com.aglyn.site.media.MediaScope
import com.aglyn.site.media.formatBytes
import com.aglyn.site.media.mediaPlan
import com.aglyn.site.media.mediaPlanNotices
import com.aglyn.site.media.mediaQuery
import com.aglyn.site.media.megabytesInput
import com.aglyn.site.pages.PageNode
import com.aglyn.site.pages.SiteRouting
import com.aglyn.site.pages.livePageUrl
import com.aglyn.site.pages.movableParents
import com.aglyn.site.pages.pageStatus
import com.aglyn.site.pages.pageTree
import com.aglyn.site.sites.SiteDomainFilter
import com.aglyn.site.sites.SUBDOMAIN_PATTERN
import com.aglyn.site.sites.createSiteBody
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
import com.aglyn.site.setup.FONT_UPLOAD_MAX_BYTES
import com.aglyn.site.setup.FontRole
import com.aglyn.site.setup.FontUploadPlan
import com.aglyn.site.setup.FontsApi
import com.aglyn.site.setup.InstalledFace
import com.aglyn.site.setup.InstalledFont
import com.aglyn.site.setup.PreparedFont
import com.aglyn.site.setup.ThemeFontOption
import com.aglyn.site.setup.filterFonts
import com.aglyn.site.setup.fontFileSize
import com.aglyn.site.setup.installedFontsOf
import com.aglyn.site.setup.isFontFileName
import com.aglyn.site.setup.themePresetsOf
import com.aglyn.site.setup.themeCatalogOf
import com.aglyn.site.setup.themeValuesOf
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
import kotlin.test.assertFalse
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
  fun createsTheSiteWithTheStarterInTheSameRequest() {
    val body = createSiteBody("org1", "  My Shop ", " MyShop ")
    assertEquals("My Shop", body["displayName"]?.jsonPrimitive?.content)
    assertEquals("myshop", body["subdomain"]?.jsonPrimitive?.content)
    assertEquals("org1", body["orgId"]?.jsonPrimitive?.content)
    // The console's "Create the starter site"; without it the server may leave the site empty for a guided start the app does not have.
    assertEquals("starter", body["start"]?.jsonPrimitive?.content)
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
  fun plansTheLibraryFiltersAsTheConsoleDoes() {
    val filters = MediaFilters(orientation = "landscape", alt = "false", tag = " Hero ", minMegabytes = "1", maxMegabytes = "2.5")
    assertEquals(5, filters.count)
    assertEquals(0, MediaFilters().count)
    val site = mediaQuery(MediaScope.Site("h"), FolderPick.All, null, "image", MediaSort.NEWEST, "", filters = filters)
    assertTrue(FirestoreFilter("orientation", FilterOp.EQ, "landscape") in site.filters)
    assertTrue(FirestoreFilter("hasAlt", FilterOp.EQ, false) in site.filters)
    // Tags are stored trimmed and lower-cased, so the one asked for is too.
    assertTrue(FirestoreFilter("tags", FilterOp.ARRAY_CONTAINS, "hero") in site.filters)
    // The size is typed in megabytes and stored in bytes.
    assertTrue(FirestoreFilter("sizeBytes", FilterOp.GTE, 1_048_576L) in site.filters)
    assertTrue(FirestoreFilter("sizeBytes", FilterOp.LTE, 2_621_440L) in site.filters)
    // A reader limited to some sites has no Tags filter: the scope holds the query's one array clause.
    val scoped = mediaQuery(MediaScope.Org("o", "h"), FolderPick.All, listOf("org", "host:h"), null, MediaSort.NEWEST, "", filters = filters)
    assertTrue(scoped.filters.none { it.field == "tags" })
    // A blank box asks nothing, and a megabyte box takes digits and one point.
    assertEquals(emptyList(), MediaFilters(tag = "  ", minMegabytes = " ").clauses(scoped = false))
    assertEquals("12.57", megabytesInput("1a2.5.7"))
    // The day a file was uploaded and who uploaded it: a range on the creation time, and an equality.
    val dated = mediaQuery(MediaScope.Site("h"), FolderPick.All, null, null, MediaSort.NEWEST, "", filters = MediaFilters(uploadedAfter = "2026-03-14", uploadedBefore = "2026-03-15", uploadedBy = "u1"))
    assertEquals(3, MediaFilters(uploadedAfter = "2026-03-14", uploadedBefore = "2026-03-15", uploadedBy = "u1").count)
    assertTrue(FirestoreFilter("uploadedBy", FilterOp.EQ, "u1") in dated.filters)
    assertTrue(dated.filters.any { it.field == "createdAt" && it.op == FilterOp.GTE })
    assertTrue(dated.filters.any { it.field == "createdAt" && it.op == FilterOp.LT })
    // A search and a tag are both array clauses, which one query cannot hold: the plan says which it left out.
    val notices = mediaPlanNotices(mediaPlan(FolderPick.All, null, null, MediaSort.NEWEST, "hero", MediaFilters(tag = "sunset")))
    assertTrue(notices.isNotEmpty(), notices.toString())
  }

  @Test
  fun choosesAFileTheWayTheConsolesPickerStoresIt() {
    fun file(id: String, vararg fields: Pair<String, Any?>) = MediaItem.from(FirestoreDoc(id, "hosts/h/media/$id", mapOf("fileName" to "$id.jpg", "contentType" to "image/jpeg") + fields))!!
    // A site's own file: its reference.
    assertEquals("media:h/m1", ChosenMedia(file("m1", "cdnPath" to "/api/media/cdn/h/m1"), MediaScope.Site("h")).reference)
    // A workspace file shared with only some sites is requested through the form that names this site; an org-wide one is not.
    assertEquals("media:org:o1:h/m2", ChosenMedia(file("m2", "cdnPath" to "/api/media/cdn/org:o1/m2", "visibleTo" to listOf("host:h")), MediaScope.Org("o1", "h")).reference)
    assertEquals("media:org:o1/m3", ChosenMedia(file("m3", "cdnPath" to "/api/media/cdn/org:o1/m3", "visibleTo" to listOf("org")), MediaScope.Org("o1", "h")).reference)
    // No CDN path: the Storage address names the asset; any other address is kept.
    val storage = "https://firebasestorage.googleapis.com/v0/b/bucket/o/hosts%2Fh%2Fmedia%2Fm4?alt=media"
    assertEquals("media:h/m4", ChosenMedia(file("m4", "url" to storage), MediaScope.Site("h")).reference)
    assertEquals("https://elsewhere.test/p.png", ChosenMedia(file("m5", "url" to "https://elsewhere.test/p.png"), MediaScope.Site("h")).reference)
    // A film's measured length, in whole seconds.
    assertEquals(63L, file("m6", "video" to mapOf("durationMs" to 63_400L, "width" to 1920L, "height" to 1080L)).videoSeconds)
    assertNull(file("m7").videoSeconds)
    // A film's captured poster frame is recorded on its document; without one, its poster address is no picture.
    assertTrue(file("m8", "poster" to mapOf("width" to 640L)).hasPoster)
    assertEquals(false, file("m9").hasPoster)
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
  fun readsTheStyleComponentsCatalogAndSendsOnlyTheLooksThatChanged() {
    val catalog = themeCatalogOf(
      Json.parseToJsonElement(
        """{"componentLooks":{"groups":[{"group":"button","label":"Buttons"}],"fields":[{"id":"button.variant","group":"button","label":"Button style","kind":"select","options":[{"value":"contained","label":"Filled"},{"value":"outlined","label":"Outlined"}]},{"id":"input.border","group":"input","label":"Input border color","kind":"color","options":[{"value":"primary","label":"Primary","token":"primary"}]}]}}""",
      ),
    )
    assertEquals(listOf("button" to "Buttons"), catalog.lookGroups)
    assertEquals(listOf("button.variant", "input.border"), catalog.looks.map { it.id })
    assertEquals("primary", catalog.looks[1].options[0].token)
    val values = themeValuesOf(Json.parseToJsonElement("""{"componentLooks":{"button.variant":"","input.border":"__custom__","card.variant":"outlined"}}"""))
    assertEquals("outlined", values.componentLooks["card.variant"])
    val after = values.copy(componentLooks = mapOf("button.variant" to "outlined", "input.border" to "__custom__", "card.variant" to ""))
    // A Custom look is left alone; "Theme default" is the empty choice that clears one.
    assertEquals(listOf(ThemeEdit.ComponentLook("button.variant", "outlined"), ThemeEdit.ComponentLook("card.variant", "")), themeEdits(values, after))
    assertEquals(mapOf("control" to "componentLook", "field" to "card.variant", "value" to ""), ThemeEdit.ComponentLook("card.variant", "").body())
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

  @Test
  fun readsTheBuiltInThemesAndFiltersTheFontBrowser() {
    val presets = themePresetsOf(Json.parseToJsonElement("""[{"id":"ocean","name":"Ocean","description":"Cool blues","swatches":["#0a3d62","#3c6382"]},{"name":"no id"},{"id":"bare"}]"""))
    assertEquals(listOf("ocean", "bare"), presets.map { it.id })
    assertEquals(listOf("#0a3d62", "#3c6382"), presets[0].swatches)
    assertEquals("bare", presets[1].name)
    assertTrue(themePresetsOf(null).isEmpty())
    val fonts = listOf(ThemeFontOption("Open Sans", "sans-serif"), ThemeFontOption("Playfair Display", "serif"), ThemeFontOption("Open Dyslexic", "display"))
    assertEquals(listOf("Open Sans", "Open Dyslexic"), filterFonts(fonts, " open ", null).map { it.family })
    assertEquals(listOf("Playfair Display"), filterFonts(fonts, "display play", null).map { it.family })
    assertEquals(listOf("Open Dyslexic"), filterFonts(fonts, "open", "display").map { it.family })
    assertEquals(3, filterFonts(fonts, "", null).size)
  }

  private val preparedFont = """{"face":{"family":"Acme Sans","weight":400,"style":"normal","category":"sans-serif","metrics":{"unitsPerEm":1000},
    "contentHash":"abcd","fileName":"acme-sans-400.woff2","bytesIn":4000,"bytesOut":1200,"warnings":["Subset to latin"],"license":{"embedding":"installable"},"unicodeRange":"U+0000-00FF"},"woff2":"d09GMg=="}"""

  @Test
  fun namesTheFilesTheInstallerTakesAndReadsAPreparedFace() {
    assertTrue(isFontFileName("Inter.WOFF2"))
    assertTrue(isFontFileName("a.ttf"))
    assertFalse(isFontFileName("photo.png"))
    assertFalse(isFontFileName("ttf"))
    assertEquals("512 B", fontFileSize(512))
    assertEquals("2 KB", fontFileSize(2048))
    assertEquals("1.5 MB", fontFileSize(3L * 1024 * 1024 / 2))
    val font = PreparedFont.of(Json.parseToJsonElement(preparedFont))!!
    assertEquals("Acme Sans", font.family)
    assertEquals("400", font.weightLabel)
    assertEquals(listOf("Subset to latin"), font.warnings)
    assertEquals(listOf<Byte>(0x77, 0x4F, 0x46, 0x32), font.woff2.toList())
    assertEquals(setOf("family", "weight", "style", "category", "metrics", "unicodeRange"), font.installable.keys)
    assertNull(PreparedFont.of(Json.parseToJsonElement("""{"face":{}}""")))
    assertNull(PreparedFont.of(null))
  }

  @Test
  fun installsAFontThroughTheConsolesRoutes() = runTest {
    val seen = mutableListOf<Triple<String, String?, String>>()
    val engine = MockEngine { request ->
      val text = (request.body as? io.ktor.http.content.OutgoingContent.ByteArrayContent)?.bytes()?.decodeToString().orEmpty()
      seen += Triple(request.url.encodedPath, request.url.parameters["hostId"], text)
      val answer = when (request.url.encodedPath) {
        "/api/fonts/prepare" -> preparedFont
        "/api/fonts/theme" -> when (Json.parseToJsonElement(text).jsonObject["op"]?.jsonPrimitive?.content) {
          "plan" -> """{"plan":{"mode":"replace","mediaId":"m1"}}"""
          else -> """{"fonts":[{"family":"Acme Sans","category":"sans-serif","roles":["body"],"faces":[{"weight":400,"style":"normal","label":"400"}]}]}"""
        }
        "/api/media/replace" -> if (seen.count { it.first == "/api/media/replace" } == 1) "{}" else """{"contentHash":"h2"}"""
        else -> """{"mediaId":"m2"}"""
      }
      respond(answer, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
    }
    val api = FontsApi(ConsoleApiClient(origin = "https://console.test/", http = HttpClient(engine), getIdToken = { "t" }, sleep = {}, maxAttempts = 1), "h1")
    assertFailsWith<ConsoleApiError> { api.prepare(PickedFile("photo.png", "image/png", byteArrayOf(1))) }
    assertFailsWith<ConsoleApiError> { api.prepare(PickedFile("big.ttf", "font/ttf", ByteArray(FONT_UPLOAD_MAX_BYTES + 1))) }
    assertTrue(seen.isEmpty())
    val font = api.prepare(PickedFile("acme.ttf", "font/ttf", byteArrayOf(1, 2)))
    val plan = api.plan(font)
    assertEquals(FontUploadPlan.Replace("m1"), plan)
    val stored = api.store(font, plan)
    assertTrue(stored.replaced)
    val fonts = api.install(font, stored.mediaId, stored.version)
    assertEquals(listOf(InstalledFont("Acme Sans", "sans-serif", listOf(FontRole.BODY), listOf(InstalledFace(400, null, "normal", "400")))), fonts)
    assertTrue(seen.all { it.second == null || it.second == "h1" })
    assertEquals(listOf("/api/fonts/prepare", "/api/fonts/theme", "/api/media/replace", "/api/fonts/theme"), seen.map { it.first })
    assertEquals(emptyList(), installedFontsOf(null))
  }

  @Test
  fun listsTheRoutedPagesForTheKeywordPickerAndReadsTheReportTheRouteAnswers() {
    val pages = com.aglyn.site.setup.seoKeywordPages(
      mapOf("screens" to mapOf("s2" to "pricing", "s1" to "/", "s3" to 5)),
      mapOf("s1" to "Home", "s2" to ""),
    )
    assertEquals(listOf("/" to "Home", "/pricing" to "/pricing"), pages.map { it.path to it.name })
    val report = com.aglyn.contracts.ContractJsonFormat.decodeFromJsonElement(
      com.aglyn.contracts.SeoAuditReport.serializer(),
      Json.parseToJsonElement(
        """{"pages":[{"screenId":"s1","path":"/","name":"Home","versionId":null,"score":85,"findings":[{"code":"title-missing","severity":"high","message":"No title."},{"code":"keyword-missing","severity":"low","message":"Say it.","keyword":"pricing"}],"keywords":[]}],"skipped":2,"site":[{"code":"search-discouraged","severity":"high","message":"Hidden."}],"score":85,"notes":["A note"]}""",
      ),
    )
    assertEquals(3, com.aglyn.contracts.seoAuditFindingCount(report))
    assertEquals(2L, report.skipped)
    assertEquals(null, report.pages[0].versionId)
  }

  @Test
  fun saysWhereABusinessProfileValueComesFrom() {
    val host = mapOf("seo" to mapOf("entity" to mapOf("description" to "Dog grooming with a calm hand.", "areaServed" to listOf("Austin"))))
    val stored = mapOf("services" to listOf("Bath"), "audience" to "Owners", "sources" to mapOf("audience" to "ai"))
    val resolved = com.aglyn.contracts.resolveBusinessProfile(host, stored)
    assertEquals(
      "Empty here, so Aglyn AI uses “Dog grooming with a calm hand.” from your SEO settings.",
      com.aglyn.site.setup.businessOriginLine("whatYouDo", stored, resolved, "One sentence"),
    )
    assertEquals("Suggested by Aglyn AI. Edit it and it becomes yours.", com.aglyn.site.setup.businessOriginLine("audience", stored, resolved, "x"))
    assertEquals("One per line", com.aglyn.site.setup.businessOriginLine("services", stored, resolved, "One per line"))
    assertEquals(listOf("details", "business", "seo", "tracking", "theme", "emails", "integrations"), com.aglyn.site.setup.SetupSection.entries.map { it.id })
  }

  /**
   * Year founded (AGL-4102): read into the form, carried into the owner's save, its origin said like any other field, and a
   * year the console would refuse is refused here with the console's words.
   */
  @Test
  fun yearFoundedIsABusinessProfileField() {
    val stored = mapOf("whatYouDo" to "Racing", "founded" to "2019", "sources" to mapOf("founded" to "start"))
    val form = com.aglyn.site.setup.businessProfileForm(stored)
    assertEquals("2019", form["founded"])
    assertEquals("", com.aglyn.site.setup.businessProfileForm(null)["founded"])
    val edited = form + ("founded" to " 2015 ")
    val values = com.aglyn.site.setup.businessProfileValues(edited)
    assertEquals(" 2015 ", values["founded"])
    val write = com.aglyn.contracts.businessProfileOwnerWrite(stored, values)
    assertEquals("2015", write["founded"])
    assertEquals("owner", (write["sources"] as Map<*, *>)["founded"])
    val resolved = com.aglyn.contracts.resolveBusinessProfile(emptyMap(), stored)
    assertEquals(
      "Your answers when the site was started. Edit it and it becomes yours.",
      com.aglyn.site.setup.businessOriginLine("founded", stored, resolved, "Four digits, such as 2015"),
    )
    assertEquals("Four digits, such as 2015", com.aglyn.site.setup.businessOriginLine("founded", emptyMap(), null, "Four digits, such as 2015"))
    assertEquals(null, com.aglyn.site.setup.businessFoundedError(form))
    val wrong = form + ("founded" to "founded 2015!")
    assertEquals(com.aglyn.contracts.businessProfileFoundedProblem("founded 2015!", com.aglyn.core.nowMillis()), com.aglyn.site.setup.businessFoundedError(wrong))
    assertTrue(com.aglyn.site.setup.businessFoundedError(wrong) != null)
  }

  @Test
  fun integrationsOfferTheCardsOfPluginsRunningOnTheSite() {
    val registry = com.aglyn.pluginhost.NativePluginRegistry()
    val entries = listOf("live-chat", "marketing-platforms", "zapier").map { id ->
      com.aglyn.pluginhost.NativePluginManifestEntry(id, mapOf("widgets" to listOf("$id.card"))) { registrar ->
        registrar.widget("$id.card", id, order = 1, slot = com.aglyn.site.setup.INTEGRATIONS_SLOT) {}
      }
    }
    assertEquals(emptyList(), registry.load(entries).failed)
    val cards = registry.widgets(com.aglyn.pluginhost.NativeApp.AGLYN, com.aglyn.site.setup.INTEGRATIONS_SLOT)
    fun shown(org: Map<String, Any?>?, host: Map<String, Any?>?) =
      com.aglyn.site.setup.integrationWidgets(cards, com.aglyn.site.setup.runningPlugins(org, host)).map { it.pluginId }.sorted()
    // Live chat is off for a site until the site turns it on; Zapier has no switch, so its card is always offered.
    assertEquals(listOf("marketing-platforms", "zapier"), shown(null, emptyMap()))
    assertEquals(listOf("live-chat", "marketing-platforms", "zapier"), shown(null, mapOf("enabledPlugins" to listOf("live-chat"))))
    // A site that turned the email platforms off loses that card.
    assertEquals(
      listOf("live-chat", "zapier"),
      shown(mapOf("enabledPlugins" to listOf("live-chat")), mapOf("enabledPlugins" to listOf("live-chat"), "disabledPlugins" to listOf("marketing-platforms"))),
    )
    assertEquals(listOf("zapier"), shown(null, mapOf("disabledPlugins" to listOf("marketing-platforms"))))
  }

  @Test
  fun anAudioUploadCarriesItsRightsConfirmationAndOtherFilesCarryNone() = runTest {
    val bodies = mutableListOf<kotlinx.serialization.json.JsonObject>()
    val engine = MockEngine { request ->
      val text = (request.body as? io.ktor.http.content.OutgoingContent.ByteArrayContent)?.bytes()?.decodeToString().orEmpty()
      if (text.isNotEmpty()) bodies += Json.parseToJsonElement(text).jsonObject
      respond("""{"mediaId":"m1"}""", HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
    }
    val api = com.aglyn.site.media.MediaApi(ConsoleApiClient(origin = "https://console.test/", http = HttpClient(engine), getIdToken = { "t" }, sleep = {}, maxAttempts = 1), MediaScope.Site("h1"))
    val song = PickedFile("song.mp3", "audio/mpeg", byteArrayOf(1, 2, 3))
    assertTrue(com.aglyn.site.media.isAudioFile(song))
    assertTrue(!com.aglyn.site.media.isAudioFile(PickedFile("a.png", "image/png", byteArrayOf(1))))
    api.upload(song, null, rightsConfirmed = true)
    api.upload(PickedFile("a.png", "image/png", byteArrayOf(1)), null)
    assertEquals("true", bodies[0]["rightsConfirmed"]?.jsonPrimitive?.content)
    assertEquals("audio/mpeg", bodies[0]["contentType"]?.jsonPrimitive?.content)
    assertNull(bodies[1]["rightsConfirmed"])
    assertEquals("I own this audio or have a license to use it on my site", com.aglyn.site.media.AUDIO_RIGHTS_STATEMENT)
  }

  @Test
  fun aFilmIsReadOnTheDeviceAndItsPosterRidesTheUpload() = runTest {
    val bodies = mutableListOf<kotlinx.serialization.json.JsonObject>()
    val engine = MockEngine { request ->
      val text = (request.body as? io.ktor.http.content.OutgoingContent.ByteArrayContent)?.bytes()?.decodeToString().orEmpty()
      if (text.isNotEmpty()) bodies += Json.parseToJsonElement(text).jsonObject
      respond("""{"mediaId":"m1"}""", HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
    }
    var probed = 0
    val probe = com.aglyn.ui.VideoProbe { probed += 1; com.aglyn.ui.VideoProbeResult(2_500, 1920, 1080, byteArrayOf(9, 9, 9)) }
    val client = ConsoleApiClient(origin = "https://console.test/", http = HttpClient(engine), getIdToken = { "t" }, sleep = {}, maxAttempts = 1)
    val api = com.aglyn.site.media.MediaApi(client, MediaScope.Site("h1"), probe)
    api.upload(PickedFile("film.mp4", "video/mp4", byteArrayOf(1, 2, 3)), null)
    api.upload(PickedFile("a.png", "image/png", byteArrayOf(1)), null)
    // Only a film is probed; the poster is base64 and the three numbers ride together.
    assertEquals(1, probed)
    val video = bodies[0].getValue("video").jsonObject
    assertEquals(listOf("2500", "1920", "1080"), listOf("durationMs", "width", "height").map { video.getValue(it).jsonPrimitive.content })
    assertEquals("CQkJ", bodies[0]["poster"]?.jsonPrimitive?.content)
    assertNull(bodies[0]["posterError"])
    assertNull(bodies[1]["video"])
    assertNull(bodies[1]["poster"])
  }

  @Test
  fun whatAProbeAddsIsBoundedAsTheServerBoundsIt() {
    val ok = com.aglyn.site.media.videoProbeFields(com.aglyn.ui.VideoProbeResult(1_000, 640, 360, byteArrayOf(1)))
    assertEquals(setOf("video", "poster"), ok.keys)
    // No poster: the reason goes instead, cut to two hundred characters; and a poster hides the reason.
    val failed = com.aglyn.site.media.videoProbeFields(com.aglyn.ui.VideoProbeResult(1_000, 640, 360, null, "x".repeat(300)))
    assertEquals(setOf("video", "posterError"), failed.keys)
    assertEquals(200, (failed["posterError"] as String).length)
    assertEquals(setOf("video", "poster"), com.aglyn.site.media.videoProbeFields(com.aglyn.ui.VideoProbeResult(1_000, 640, 360, byteArrayOf(1), "ignored")).keys)
    // Length and frame size are all or nothing, and bounded: a day, and 16384 a side.
    assertEquals(emptySet(), com.aglyn.site.media.videoProbeFields(com.aglyn.ui.VideoProbeResult(1_000, null, 360)).keys)
    assertEquals(emptySet(), com.aglyn.site.media.videoProbeFields(com.aglyn.ui.VideoProbeResult(0, 640, 360)).keys)
    assertEquals(emptySet(), com.aglyn.site.media.videoProbeFields(com.aglyn.ui.VideoProbeResult(86_400_001, 640, 360)).keys)
    assertEquals(emptySet(), com.aglyn.site.media.videoProbeFields(com.aglyn.ui.VideoProbeResult(1_000, 16_385, 360)).keys)
    // Nothing found and nothing said adds nothing.
    assertEquals(emptySet(), com.aglyn.site.media.videoProbeFields(com.aglyn.ui.VideoProbeResult()).keys)
    assertEquals(emptySet(), com.aglyn.site.media.videoProbeFields(com.aglyn.ui.VideoProbeResult(reason = "   ")).keys)
  }

  @Test
  fun aPosterIsTakenATenthOfTheWayInButNeverPastTheFirstSecond() {
    assertEquals(0.1, com.aglyn.site.media.posterTimeSeconds(0.0))
    assertEquals(0.1, com.aglyn.site.media.posterTimeSeconds(Double.POSITIVE_INFINITY))
    assertEquals(0.5, com.aglyn.site.media.posterTimeSeconds(5.0))
    assertEquals(1.0, com.aglyn.site.media.posterTimeSeconds(600.0))
  }

  @Test
  fun theThemeLibraryListsOnlyTheSitesOwnAndInstalledThemesEachByItsKind() {
    fun entry(id: String, kind: String?, name: String) =
      FirestoreDoc(id, "hosts/h/themes/$id", listOfNotNull("name" to name, kind?.let { "kind" to it }).toMap())
    val listed = com.aglyn.site.setup.libraryThemes(
      listOf(
        entry("default", "default", "Platform default"),
        entry("installed--harvest", "installed", "Harvest"),
        entry("preset--mui", "preset", "Material UI"),
        entry("theme-cool", "custom", "Cool"),
        entry("theme-warm", "custom", "Warm"),
        entry("unknown", null, "No kind"),
      ),
    )
    assertEquals(listOf("theme-cool" to "custom", "theme-warm" to "custom", "installed--harvest" to "installed"), listed.map { it.id to it.kind })
  }
}
