package com.aglyn.site

import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestorePage
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.FirestoreWriter
import com.aglyn.core.Live
import com.aglyn.site.artifacts.ArtifactKind
import com.aglyn.site.artifacts.ArtifactsApi
import com.aglyn.site.artifacts.TemplateContent
import com.aglyn.site.artifacts.TemplatePlaceholder
import com.aglyn.site.artifacts.TemplateSource
import com.aglyn.site.artifacts.TemplatesApi
import com.aglyn.site.artifacts.emailBlockStarter
import com.aglyn.site.artifacts.pageAddressProblem
import com.aglyn.site.pages.PagesApi
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** A tree the console's encoder made: root -> n1 (text "Hi {{name}}", size 16), as base64 msgpack. */
private const val TREE_BYTES = "gqRyb290g6MkaWSkcm9vdKtjb21wb25lbnRJZKNkaXalbm9kZXORom4xom4xg6MkaWSibjGrY29tcG9uZW50SWSkdGV4dKVwcm9wc4KoY2hpbGRyZW6rSGkge3tuYW1lfX2kc2l6ZRA="

private class DocsReader(private val docs: Map<String, FirestoreDoc>) : FirestoreReader {
  override suspend fun get(path: String): FirestoreDoc? = docs[path]
  override suspend fun page(query: FirestoreQuery) = FirestorePage(emptyList(), null)
  override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = flowOf(Live.Ready(docs[path]))
  override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = flowOf(Live.Ready(emptyList()))
}

private class RecordingWriter : FirestoreWriter {
  val updates = mutableListOf<Pair<String, Map<String, Any?>>>()
  override suspend fun merge(path: String, data: Map<String, Any?>) = Unit
  override suspend fun update(path: String, data: Map<String, Any?>) {
    updates += path to data
  }
}

class TemplatesTest {
  private fun template(id: String = "t1", vararg fields: Pair<String, Any?>) =
    FirestoreDoc(id, "hosts/h/templates/$id", mapOf("displayName" to "Pricing", "kind" to "page", "nodes" to TREE_BYTES) + fields)

  private class Calls {
    val seen = mutableListOf<Pair<String, JsonObject>>()
    val client = ConsoleApiClient(
      origin = "https://console.test/",
      http = HttpClient(
        MockEngine { request ->
          val text = (request.body as? OutgoingContent.ByteArrayContent)?.bytes()?.decodeToString().orEmpty()
          seen += request.url.encodedPath to (if (text.isEmpty()) JsonObject(emptyMap()) else Json.parseToJsonElement(text).jsonObject)
          respond("""{"id":"made1","path":"/pricing"}""", HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
        },
      ),
      getIdToken = { "t" },
      sleep = {},
      maxAttempts = 1,
    )
  }

  @Test
  fun readsATemplateWhichEverFormItsTreeIsStoredIn() {
    val content = assertNotNull(TemplateContent.from(template("t1", "placeholders" to listOf(mapOf("name" to "name"), mapOf("name" to "prop.title"), mapOf("name" to "city", "label" to "Your city", "defaultValue" to "Austin")))))
    assertEquals(setOf("root", "n1"), content.nodes?.keys)
    // A {{prop.*}} token is bound to a property the template carries, never asked for.
    assertEquals(listOf(TemplatePlaceholder("name", "name", ""), TemplatePlaceholder("city", "Your city", "Austin")), content.placeholders)
    assertEquals("page", content.kind)
    // A plain map (an older template) is the tree already; a deleted template is gone.
    assertEquals(setOf("a"), TemplateContent.from(template("t2", "nodes" to mapOf("a" to mapOf("\$id" to "a"))))?.nodes?.keys)
    assertNull(TemplateContent.from(template("t3", "deletedAt" to 1L)))
  }

  @Test
  fun makesAComponentFromATemplateWithItsPlaceholdersFilled() = runTest {
    val calls = Calls()
    val api = TemplatesApi(calls.client, DocsReader(emptyMap()), RecordingWriter(), "h")
    val email = assertNotNull(TemplateContent.from(template("t1", "kind" to "component", "componentKind" to "email", "rootId" to "root", "placeholders" to listOf(mapOf("name" to "name")))))
    val id = api.useComponent(email, " Greeting ", mapOf("name" to "Ada"))
    assertEquals("made1", id)
    val (path, body) = calls.seen.single()
    assertEquals("/api/hosts/resources", path)
    assertEquals("reusableComponent", body["resource"]?.jsonPrimitive?.content)
    val data = body.getValue("data").jsonObject
    assertEquals("Greeting", data["displayName"]?.jsonPrimitive?.content)
    assertEquals("email", data["kind"]?.jsonPrimitive?.content)
    assertEquals("root", data["rootId"]?.jsonPrimitive?.content)
    assertEquals("Hi Ada", data.getValue("nodes").jsonObject.getValue("n1").jsonObject.getValue("props").jsonObject["children"]?.jsonPrimitive?.content)
  }

  @Test
  fun makesALayoutWithItsFirstVersion() = runTest {
    val calls = Calls()
    val api = TemplatesApi(calls.client, DocsReader(emptyMap()), RecordingWriter(), "h")
    val layout = assertNotNull(TemplateContent.from(template("t1", "kind" to "layout", "props" to listOf(mapOf("name" to "title")))))
    val id = api.useLayout(layout, "Shop frame", emptyMap())
    assertEquals(listOf("/api/hosts/resources", "/api/hosts/versions"), calls.seen.map { it.first })
    val (_, resource) = calls.seen[0]
    val (_, version) = calls.seen[1]
    assertEquals(id, resource["id"]?.jsonPrimitive?.content)
    assertEquals(version["id"]?.jsonPrimitive?.content, resource.getValue("data").jsonObject["versionId"]?.jsonPrimitive?.content)
    assertEquals("layout", version["kind"]?.jsonPrimitive?.content)
    assertEquals(id, version["parentId"]?.jsonPrimitive?.content)
    assertEquals(1, version.getValue("data").jsonObject.getValue("props").jsonArray.size)
  }

  @Test
  fun makesAPageAndPublishesItAtAnAddressNobodyHolds() = runTest {
    val calls = Calls()
    val api = TemplatesApi(calls.client, DocsReader(emptyMap()), RecordingWriter(), "h")
    val pages = PagesApi(calls.client, RecordingWriter(), "h")
    val page = assertNotNull(TemplateContent.from(template("t1", "seo" to mapOf("title" to "Pricing"), "description" to "Plans")))
    val taken = mutableSetOf("pricing")
    val used = api.usePage(page, "Pricing", "pricing", emptyMap(), taken, pages)
    assertEquals("pricing-2", used.slug)
    assertEquals("pricing", used.requestedSlug)
    assertEquals(setOf("pricing", "pricing-2"), taken)
    assertEquals(listOf("/api/hosts/resources", "/api/hosts/versions", "/api/hosts/pages"), calls.seen.map { it.first })
    assertEquals("screen", calls.seen[0].second["resource"]?.jsonPrimitive?.content)
    assertEquals("Pricing", calls.seen[0].second.getValue("data").jsonObject.getValue("seo").jsonObject["title"]?.jsonPrimitive?.content)
    assertEquals("Initial version", calls.seen[1].second.getValue("data").jsonObject["displayName"]?.jsonPrimitive?.content)
    assertEquals("publish", calls.seen[2].second["action"]?.jsonPrimitive?.content)
    assertEquals("pricing-2", calls.seen[2].second["slug"]?.jsonPrimitive?.content)
  }

  @Test
  fun aStarterSiteTakesTheRootBackFromThePlaceholderHome() = runTest {
    val calls = Calls()
    val writer = RecordingWriter()
    val host = FirestoreDoc("h", "hosts/h", mapOf("defaultHomeScreenId" to "home0", "screens" to mapOf("home0" to "/", "about0" to "about")))
    val api = TemplatesApi(calls.client, DocsReader(mapOf("hosts/h" to host)), writer, "h")
    val pages = PagesApi(calls.client, writer, "h")
    val bundle = listOf(
      assertNotNull(TemplateContent.from(template("a", "displayName" to "Home", "slug" to "home", "source" to mapOf("starterId" to "s", "starterOrder" to 0)))),
      assertNotNull(TemplateContent.from(template("b", "displayName" to "About", "slug" to "about", "source" to mapOf("starterId" to "s", "starterOrder" to 1)))),
      assertNotNull(TemplateContent.from(template("c", "displayName" to "Search", "slug" to "search", "source" to mapOf("starterId" to "s", "starterOrder" to 2)))),
    )
    val (made, skipped) = api.useBundle(bundle, pages)
    // The first page takes the root once the placeholder lets go of it; a slug the site cannot serve is named, not made.
    assertEquals(listOf("/", "about-2"), made.map { it.slug })
    assertEquals(1, skipped.size)
    assertTrue(skipped.single().startsWith("\"Search\" — "))
    assertEquals("unpublish", calls.seen.first { it.first == "/api/hosts/pages" }.second["action"]?.jsonPrimitive?.content)
    assertEquals("hosts/h", writer.updates.single().first)
  }

  @Test
  fun savesAComponentAsATemplateDeclaringTheNamesItAsksFor() = runTest {
    val calls = Calls()
    val api = TemplatesApi(calls.client, DocsReader(emptyMap()), RecordingWriter(), "h")
    val source = TemplateSource(
      "component",
      mapOf("n" to mapOf("\$id" to "n", "props" to mapOf("children" to "{{name}} {{var:abc}} {{prop.title}}"))),
      rootId = "n",
      componentKind = "email",
    )
    assertEquals(1, api.saveAsTemplate(source, "  Greeting  ", " A hello "))
    val data = calls.seen.single().second.getValue("data").jsonObject
    assertEquals("template", calls.seen.single().second["resource"]?.jsonPrimitive?.content)
    assertEquals("Greeting", data["displayName"]?.jsonPrimitive?.content)
    assertEquals("A hello", data["description"]?.jsonPrimitive?.content)
    assertEquals("email", data["componentKind"]?.jsonPrimitive?.content)
    assertEquals("name", (data.getValue("placeholders") as JsonArray).single().jsonObject["name"]?.jsonPrimitive?.content)
    // Nothing to capture is said, not saved.
    val problem = runCatching { api.saveAsTemplate(source.copy(nodes = emptyMap()), "x", "") }.exceptionOrNull()
    assertTrue(problem?.message.orEmpty().startsWith("Nothing to save yet"))
  }

  @Test
  fun readsAPagesTreeAndItsAddressFromItsCurrentVersion() = runTest {
    val docs = listOf(
      FirestoreDoc("p1", "hosts/h/screens/p1", mapOf("seo" to mapOf("title" to "About"))),
      FirestoreDoc("v1", "hosts/h/screens/p1/versions/v1", mapOf("nodes" to TREE_BYTES)),
      FirestoreDoc("h", "hosts/h", mapOf("screens" to mapOf("p1" to "about"))),
    ).associateBy { it.path }
    val api = TemplatesApi(Calls().client, DocsReader(docs), RecordingWriter(), "h")
    val source = assertNotNull(api.pageSource("p1", "v1"))
    assertEquals("about", source.slug)
    assertEquals(setOf("root", "n1"), source.nodes.keys)
    assertEquals(mapOf("title" to "About"), source.seo)
    assertNull(api.pageSource("p1", null))
    assertNull(api.layoutSource("l1", "v9"))
  }

  @Test
  fun refusesAnAddressTheSiteCannotServe() {
    assertNull(pageAddressProblem("pricing", "Pricing"))
    assertNull(pageAddressProblem("", "Pricing"))
    assertTrue(pageAddressProblem("a/b", "x")!!.startsWith("A slug is one path segment"))
    assertTrue(pageAddressProblem("search", "x")!!.contains("reserved"))
  }

  @Test
  fun anEmailBlockStartsAsTheHeaderOrFooterBandWithFreshIds() = runTest {
    var next = 0
    val (rootId, nodes) = assertNotNull(emailBlockStarter("header") { "n${++next}" })
    assertEquals("n1", rootId)
    assertEquals(setOf("n1", "n2", "n3"), nodes.keys)
    val root = nodes.getValue("n1") as Map<*, *>
    assertEquals("emailSection", root["componentId"])
    assertNull(root["parentId"])
    assertEquals(listOf("n2", "n3"), root["nodes"])
    assertEquals("n1", (nodes.getValue("n2") as Map<*, *>)["parentId"])
    assertEquals("n3", (nodes.getValue("n3") as Map<*, *>)["\$id"])
    assertEquals(4, assertNotNull(emailBlockStarter("footer")).second.size)
    // Blank, and a name nobody knows, start from nothing.
    assertNull(emailBlockStarter("blank"))
    assertNull(emailBlockStarter(null))
    // Creating an email component with a starter sends that tree; without one it sends the blank canvas.
    val calls = Calls()
    val components = ArtifactsApi(calls.client, RecordingWriter(), "h", ArtifactKind.COMPONENT)
    components.create("Top band", "", "email", "footer")
    components.create("Plain", "", "email", "blank")
    components.create("Page block", "", "site", "header")
    val sent = calls.seen.map { it.second.getValue("data").jsonObject }
    assertEquals("email", sent[0]["kind"]?.jsonPrimitive?.content)
    assertEquals(4, sent[0].getValue("nodes").jsonObject.size)
    assertEquals(1, sent[1].getValue("nodes").jsonObject.size)
    assertNull(sent[2]["kind"])
    assertEquals(1, sent[2].getValue("nodes").jsonObject.size)
  }

  @Test
  fun readsWhatTheSiteChangedOnTopOfItsTheme() {
    val answer = Json.parseToJsonElement(
      """{"stale":true,"themeName":"Sunset","changes":[
        {"path":"colorSchemes.dark.primary.main","label":"Color · dark · primary","scheme":"dark","themeValue":"#90caf9","overrideValue":"#00e5ff"},
        {"path":"spacing","label":"Spacing","themeValue":8,"overrideValue":4},
        {"path":"fonts","label":"Fonts","themeValue":null,"overrideValue":{"heading":["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]}},
        {"label":"No path"}]}""",
    ).jsonObject
    val changes = com.aglyn.site.setup.themeChangesOf(answer["changes"])
    assertEquals(listOf("colorSchemes.dark.primary.main", "spacing", "fonts"), changes.map { it.path })
    assertEquals("dark", changes[0].scheme)
    assertTrue(changes[0].isColor)
    assertEquals("8", changes[1].themeValue)
    assertEquals(false, changes[1].isColor)
    assertNull(changes[2].themeValue)
    // A structure is shown compact and cut at sixty characters.
    assertEquals(58, changes[2].overrideValue?.length)
    assertTrue(changes[2].overrideValue!!.endsWith("…"))
    assertEquals(emptyList(), com.aglyn.site.setup.themeChangesOf(null))
  }

  @Test
  fun readsAComponentsIconAndSearchesTheIconSet() = runTest {
    val chosen = com.aglyn.site.artifacts.componentIconOf(FirestoreDoc("c1", "hosts/h/components/c1", mapOf("icon" to mapOf("iconId" to "cart", "iconPath" to "M1 1h2"))))
    assertEquals(com.aglyn.site.artifacts.ComponentIcon("cart", "M1 1h2"), chosen)
    assertEquals(mapOf("iconId" to "cart", "iconPath" to "M1 1h2"), chosen?.stored())
    // Cleared (an empty map), never chosen and unreadable all read as no icon.
    assertNull(com.aglyn.site.artifacts.componentIconOf(FirestoreDoc("c1", "p", mapOf("icon" to emptyMap<String, Any?>()))))
    assertNull(com.aglyn.site.artifacts.componentIconOf(FirestoreDoc("c1", "p", emptyMap())))
    assertNull(com.aglyn.site.artifacts.componentIconOf(FirestoreDoc("c1", "p", mapOf("icon" to "cart"))))

    val http = HttpClient(
      MockEngine { request ->
        assertEquals("/api/hosts/icons", request.url.encodedPath)
        assertEquals("cart", request.url.parameters["search"])
        respond("""{"icons":[{"id":"cart","name":"Cart","path":"M1 1h2"},{"id":"cart-outline","name":"Cart Outline","path":"M2 2"},{"name":"No id"}]}""", HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
      },
    )
    val client = ConsoleApiClient("https://console.test/", http, getIdToken = { "t" }, sleep = {}, maxAttempts = 1)
    val found = com.aglyn.site.artifacts.searchComponentIcons(client, " cart ")
    assertEquals(listOf("cart", "cart-outline"), found.map { it.id })
    assertEquals("Cart Outline", found[1].name)
  }

  @Test
  fun savesAComponentsIconOnlyWhenTheDialogChangedIt() = runTest {
    val writer = RecordingWriter()
    val api = ArtifactsApi(Calls().client, writer, "h", ArtifactKind.COMPONENT)
    api.saveDetails("c1", "Header", "The top band")
    assertEquals(false, writer.updates.single().second.containsKey("icon"))
    writer.updates.clear()
    api.saveDetails("c1", "Header", "The top band", icon = com.aglyn.site.artifacts.ComponentIcon("cart", "M1 1h2").stored())
    assertEquals(mapOf("iconId" to "cart", "iconPath" to "M1 1h2"), writer.updates.single().second["icon"])
    writer.updates.clear()
    // A cleared icon is an empty map, as the console's picker writes it.
    api.saveDetails("c1", "Header", "The top band", icon = emptyMap())
    assertEquals(emptyMap<String, Any?>(), writer.updates.single().second["icon"])
  }
}
