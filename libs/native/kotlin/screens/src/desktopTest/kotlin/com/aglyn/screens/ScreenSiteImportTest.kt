package com.aglyn.screens

import com.aglyn.core.ConsoleApiClient
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Importing a site package (`site-import.screens.json`), step by step as the console's wizard takes it: the
 * defaults for each kind of change, a choice per item, the missing items and what to do about each, the
 * values a merge keeps, and what must be acknowledged before the import writes. Apple replays the same
 * cases (ScreenSiteImportTests).
 */
class ScreenSiteImportTest {
  private val root: File = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "libs/native/screens").isDirectory }

  @BeforeTest
  fun reset() = ScreenStash.clear()

  @AfterTest
  fun clear() = ScreenStash.clear()

  private fun spec(id: String) = ScreenSpec.parseFile(File(root, "libs/native/screens/site-import.screens.json").readText()).first { it.id == id }

  private fun json(text: String): JsonElement = Json.parseToJsonElement(text)

  private fun client(vararg responses: Pair<Int, String>, sent: MutableList<HttpRequestData>): ConsoleApiClient {
    val queue = ArrayDeque(responses.toList())
    val engine = MockEngine { request ->
      sent += request
      val (status, body) = queue.removeFirstOrNull() ?: (200 to "{}")
      respond(body, HttpStatusCode.fromValue(status), headersOf("Content-Type", "application/json"))
    }
    return ConsoleApiClient("http://localhost", HttpClient(engine) { expectSuccess = false }, { "t" }, sleep = {})
  }

  private fun routed(vararg routes: Pair<String, String>): ConsoleApiClient {
    val engine = MockEngine { request ->
      val body = routes.firstOrNull { request.url.encodedPath.contains(it.first) }?.second ?: "{}"
      respond(body, HttpStatusCode.OK, headersOf("Content-Type", "application/json"))
    }
    return ConsoleApiClient("http://localhost", HttpClient(engine) { expectSuccess = false }, { "t" }, sleep = {})
  }

  private fun sentBody(sent: List<HttpRequestData>, at: Int) = json((sent[at].body as TextContent).text) as JsonObject

  /** A block's action, by its id (a button in an `actions` block or a row action of a list). */
  private fun action(screen: ScreenSpec, id: String): ActionSpec {
    for (block in screen.blocks) {
      for (key in listOf("items", "actions")) {
        val list = (block.raw as? JsonObject)?.get(key) as? JsonArray ?: continue
        for (raw in list) if ((raw as? JsonObject)?.get("id")?.jsonPrimitive?.contentOrNull == id) return ActionSpec.parse(raw)!!
      }
    }
    error("no action $id on ${screen.id}")
  }

  /** What a button sees: the site, what the wizard has kept, and the form or row it was pressed on. */
  private fun scope(extra: String = "{}"): JsonElement {
    val record = linkedMapOf<String, JsonElement>("site" to json("""{"id":"h1"}"""), "stash" to ScreenStash.values)
    (json(extra) as JsonObject).forEach { (key, value) -> record[key] = value }
    return JsonObject(record)
  }

  private fun row(key: String, choices: String = """["replace","keepBoth","merge","skip"]""") = """{"key":"$key","choices":$choices}"""

  private val plan = """
    {"plan":{"items":[
      {"key":"page/a","kind":"page","id":"a","name":"Home","status":"differs","comparison":"differs","proposed":"skip","needsChoice":true,"choices":["replace","keepBoth","merge","skip"],"deps":[],"missing":[]},
      {"key":"page/z","kind":"page","id":"z","name":"Terms","status":"differs","comparison":"differs","proposed":"skip","needsChoice":true,"choices":["replace","skip"],"deps":[],"missing":[]},
      {"key":"page/b","kind":"page","id":"b","name":"About","status":"new","comparison":"new","proposed":"create","needsChoice":false,"choices":["create","skip"],"deps":[{"kind":"layout","id":"other"}],"missing":[{"kind":"layout","id":"other"}]},
      {"key":"email/c","kind":"email","id":"c","status":"identical","comparison":"identical","proposed":"skip","needsChoice":false,"choices":["skip","replace","keepBoth"],"deps":[],"missing":[]}
    ],"counts":{"new":1,"identical":1,"differs":2,"missingDependency":0},"kinds":[]},
    "capRefusal":null,"warnings":[],"warningsTotal":0,"unknownKinds":[],"notSent":[]}
  """.trimIndent()

  private fun reviewed(warnings: String, total: Int) =
    """{"capRefusal":null,"warnings":$warnings,"warningsTotal":$total,"unknownKinds":[],"notSent":[]}"""

  private val dangling = """
    [{"code":"danglingReference","item":"page/b","dependency":"layout/other","message":"page/b points at layout/other."},
     {"code":"danglingReference","item":"page/a","dependency":"layout/other","message":"page/a points at layout/other."}]
  """.trimIndent()

  @Test
  fun theDefaultsDecideEveryItemButTheOnesThatDifferAndEachChoiceFollowsFromThem() = runTest {
    val sent = mutableListOf<HttpRequestData>()
    val api = client(200 to plan, sent = sent)
    val importing = spec("core.site.import")
    val model = ScreenModel(importing, JsonObject(emptyMap()), api)
    val submit = ActionSpec.parse(importing.blocks.first { it.id == "package" }["submit"])!!
    val file = """{"manifest":{"items":[]}}"""
    model.run(submit, scope("""{"form":{"package":$file}}"""))
    assertEquals(JsonPrimitive("plan"), sentBody(sent, 0)["action"])
    assertEquals(json(file), ScreenStash.values["package"])
    // New items are added and unchanged ones left; a changed item waits for the person.
    assertEquals(json("""{"page/b":"create","email/c":"skip"}"""), ScreenStash.values["decisions"])
    assertEquals(json("""{"page/a":"page/a","page/z":"page/z"}"""), ScreenStash.values["undecided"])
    assertEquals(JsonPrimitive("create"), (ScreenStash.values["bulk"] as JsonObject)["new"])

    val review = spec("core.site.import.review")
    val reviewing = ScreenModel(review, JsonObject(emptyMap()), api)
    // A default for the changed items, where an item can take it; the one that cannot stays undecided.
    val bulk = action(review, "bulk")
    reviewing.run(bulk, scope("""{"form":{"new":"create","differs":"keepBoth","identical":"skip"}}"""))
    assertEquals(json("""{"page/a":"keepBoth","page/b":"create","email/c":"skip"}"""), ScreenStash.values["decisions"])
    assertEquals(json("""{"page/z":"page/z"}"""), ScreenStash.values["undecided"])
    assertEquals(listOf("", "skip", "replace", "keepBoth"), bulk.prompt.first { it.key == "differs" }.choices(scope()).map { it.first })
    // A choice of its own beats the default, and the item no longer waits.
    val choose = action(review, "choose")
    reviewing.run(choose, scope("""{"item":${row("page/z", """["replace","skip"]""")},"form":{"decision":"skip"}}"""))
    assertEquals(json("""{"page/z":"skip"}"""), ScreenStash.values["overrides"])
    assertEquals(JsonPrimitive("skip"), (ScreenStash.values["decisions"] as JsonObject)["page/z"])
    assertEquals(JsonPrimitive("keepBoth"), (ScreenStash.values["decisions"] as JsonObject)["page/a"])
    assertEquals(json("{}"), ScreenStash.values["undecided"])
    // Setting the defaults again leaves the choice made.
    reviewing.run(bulk, scope("""{"form":{"new":"skip","differs":"replace","identical":"skip"}}"""))
    assertEquals(json("""{"page/a":"replace","page/z":"skip","page/b":"skip","email/c":"skip"}"""), ScreenStash.values["decisions"])
    assertEquals(json("{}"), ScreenStash.values["undecided"])
  }

  /**
   * The console's own answers (`packageDecisions`, replayed in native-site-import-matches-the-console.spec.ts)
   * for the defaults, the choices and the plan's proposals, through the screen's own expressions.
   */
  @Test
  fun everyItemIsDecidedAsTheConsoleDecidesIt() = runTest {
    val cases = json(File(root, "libs/native/screens/site-import-cases.json").readText()) as JsonObject
    val importing = spec("core.site.import")
    val model = ScreenModel(importing, JsonObject(emptyMap()), client(sent = mutableListOf()))
    val submit = ActionSpec.parse(importing.blocks.first { it.id == "package" }["submit"])!!
    val decide = submit.after!!
    val all = cases["decisions"] as JsonArray
    assertTrue(all.size > 5)
    for (one in all) {
      one as JsonObject
      ScreenStash.clear()
      ScreenStash.set(
        JsonObject(
          mapOf(
            "plan" to JsonObject(mapOf("plan" to JsonObject(mapOf("items" to one.getValue("items"))))),
            "bulk" to one.getValue("bulk"),
            "overrides" to one.getValue("overrides"),
          ),
        ),
      )
      model.run(decide, scope())
      val expect = one.getValue("expect") as JsonObject
      val name = one.getValue("name").jsonPrimitive.content
      assertEquals(expect["decisions"], ScreenStash.values["decisions"], name)
      assertEquals(
        (expect["undecided"] as JsonArray).map { it.jsonPrimitive.content },
        (ScreenStash.values["undecided"] as JsonObject).keys.sorted(),
        name,
      )
    }
  }

  @Test
  fun theMissingItemsComeFromThePlanAndEachAnswerIsSentBackWithTheDecisions() = runTest {
    ScreenStash.set(
      json(
        """{"package":{"manifest":{"items":[]}},"plan":$plan,
            "decisions":{"page/a":"merge","page/b":"create","page/z":"replace","email/c":"skip"},"depChoices":{},"merge":{}}""",
      ),
    )
    val sent = mutableListOf<HttpRequestData>()
    val api = client(
      200 to reviewed(dangling, 2),
      200 to reviewed("""[{"code":"droppedReference","item":"page/b","dependency":"layout/other","message":"Removed."}]""", 1),
      200 to reviewed("""[{"code":"mappedReference","item":"page/b","dependency":"layout/other","message":"Mapped."}]""", 1),
      sent = sent,
    )
    val review = spec("core.site.import.review")
    ScreenModel(review, JsonObject(emptyMap()), api).run(action(review, "next"), scope())
    val first = sentBody(sent, 0)
    assertEquals(JsonPrimitive("plan"), first["action"])
    assertEquals(JsonPrimitive("h1"), first["hostId"])
    assertEquals(JsonPrimitive("merge"), (first["decisions"] as JsonObject)["page/a"])
    assertNull(first["dependencyChoices"])  // nothing answered yet: not sent
    assertNull(first["mergeChoices"])
    // One prompt per missing item, however many items name it.
    assertEquals(setOf("layout/other"), (ScreenStash.values["prompts"] as JsonObject).keys)
    assertEquals(json("""{"danglingReference":"danglingReference"}"""), ScreenStash.values["warnCodes"])
    val by = ScreenStash.values["by"] as JsonObject
    assertEquals(json("""{"page/a":"page/a"}"""), by["merge"])
    assertEquals(json("""{"page/b":"page/b"}"""), by["create"])
    assertEquals(json("""{"page/z":"page/z"}"""), by["replace"])

    val missing = spec("core.site.import.deps")
    val deps = ScreenModel(missing, JsonObject(emptyMap()), api)
    val prompt = """{"key":"layout/other","value":{"code":"danglingReference","dependency":"layout/other"}}"""
    deps.run(action(missing, "drop"), scope("""{"item":$prompt}"""))
    assertEquals(json("""{"layout/other":"drop"}"""), sentBody(sent, 1)["dependencyChoices"])
    assertEquals(json("""{"layout/other":"drop"}"""), ScreenStash.values["depChoices"])
    assertEquals(json("""{"droppedReference":"droppedReference"}"""), ScreenStash.values["warnCodes"])
    // Importing a missing item is offered only when the file carries it.
    val importIt = action(missing, "import")
    assertFalse(ScreenValues.condition(importIt.whenCondition, scope("""{"item":$prompt}""")))
    assertTrue(ScreenValues.condition(importIt.whenCondition, scope("""{"item":{"key":"page/b"}}""")))

    // Pointing at an item the site has sends the id it holds.
    val pick = spec("core.site.import.pick")
    ScreenModel(pick, JsonObject(emptyMap()), api).run(
      action(pick, "use"),
      scope("""{"params":{"dep":"layout/other","kind":"layout"},"item":{"${'$'}id":"lay1","kind":"layout"}}"""),
    )
    assertEquals(json("""{"layout/other":{"mapTo":"lay1"}}"""), sentBody(sent, 2)["dependencyChoices"])
    assertEquals(json("""{"layout/other":{"mapTo":"lay1"}}"""), ScreenStash.values["depChoices"])
  }

  @Test
  fun whatMustBeAcknowledgedFollowsFromWhatTheImportWillDo() = runTest {
    ScreenStash.set(
      json(
        """{"package":{"manifest":{"items":[]}},
            "decisions":{"page/a":"merge","page/b":"create","page/z":"replace","email/c":"skip"},
            "depChoices":{"layout/other":"drop"},
            "merge":{"page/a":{"title":"package"},"page/b":{"x":"site"}},
            "by":{"merge":{"page/a":"page/a"},"replace":{"page/z":"page/z"},"create":{"page/b":"page/b"}},
            "warnCodes":{"droppedReference":"droppedReference"},
            "review":${reviewed(dangling, 5)}}""",
      ),
    )
    val apply = spec("core.site.import.apply")
    val sent = mutableListOf<HttpRequestData>()
    val api = client(200 to """{"importId":"i1","written":3,"counts":{},"warnings":[],"warningsTotal":0}""", sent = sent)
    val applying = ScreenModel(apply, json("""{"site":{"id":"h1"}}"""), api)
    applying.load()
    assertEquals(JsonPrimitive(true), ScreenValues.lookup("is.needsAck", applying.context))
    val write = action(apply, "apply")
    val ack = write.prompt.first()
    assertTrue(ack.coversAll)
    // Overwrites, each class of reference warning, and the warnings that did not fit the list.
    val ids = ack.choices(applying.context).map { it.first }
    assertEquals(listOf("overwrite", "droppedReference", "moreWarnings"), ids)
    assertTrue(ack.unmet(JsonArray(listOf(JsonPrimitive("overwrite"), JsonPrimitive("droppedReference"))), applying.context))
    assertFalse(ack.unmet(JsonArray(ids.map { JsonPrimitive(it) }), applying.context))
    assertTrue(ScreenValues.condition(write.whenCondition, applying.context))
    assertFalse(ScreenValues.condition(action(apply, "applyNow").whenCondition, applying.context))

    applying.run(write, scope("""{"form":{"ack":${JsonArray(ids.map { JsonPrimitive(it) })}}}"""))
    val body = sentBody(sent, 0)
    assertEquals(JsonPrimitive("apply"), body["action"])
    assertEquals(JsonPrimitive("replace"), (body["decisions"] as JsonObject)["page/z"])
    assertEquals(json("""{"layout/other":"drop"}"""), body["dependencyChoices"])
    // Only an item merged takes its key-by-key choices to the route.
    assertEquals(json("""{"page/a":{"title":"package"}}"""), body["mergeChoices"])
    assertEquals(JsonPrimitive("i1"), (ScreenStash.values["result"] as JsonObject)["importId"])

    // Nothing written over and no warning: the import needs no acknowledgement.
    ScreenStash.set(
      json("""{"decisions":{"page/b":"create"},"by":{"create":{"page/b":"page/b"}},"warnCodes":{},"review":${reviewed("[]", 0)}}"""),
    )
    val quiet = ScreenModel(apply, json("""{"site":{"id":"h1"}}"""), api)
    quiet.load()
    assertEquals(JsonPrimitive(false), ScreenValues.lookup("is.needsAck", quiet.context))
    assertTrue(ScreenValues.condition(action(apply, "applyNow").whenCondition, quiet.context))
    assertFalse(ScreenValues.condition(write.whenCondition, quiet.context))
  }

  @Test
  fun anItemShowsEachValueItChangesAndTheKeysAMergeChoosesBetween() = runTest {
    ScreenStash.set(json("""{"package":{"manifest":{"items":[]}},"decisions":{"page/a":"merge"},"merge":{"page/a":{"title":"package"}}}"""))
    val compare = """
      {"items":[{"key":"page/a","kind":"page","id":"a","incoming":{"title":"New","seo":{"x":1},"note":"file"},
       "existing":{"id":"a","content":{"title":"Old","seo":{"x":1},"note":""}}}]}
    """.trimIndent()
    val sent = mutableListOf<HttpRequestData>()
    val item = spec("core.site.import.item")
    val model = ScreenModel(item, json("""{"site":{"id":"h1"},"params":{"key":"page/a"}}"""), client(200 to compare, sent = sent))
    model.load()
    val body = sentBody(sent, 0)
    assertEquals(JsonPrimitive("compare"), body["action"])
    assertEquals(json("""["page/a"]"""), body["keys"])
    assertEquals(json("""{"manifest":{"items":[]}}"""), body["package"])
    val changes = ScreenValues.lookup("data.diff.changes", model.context) as JsonArray
    assertEquals(listOf("note", "title"), changes.map { (it as JsonObject)["label"]!!.jsonPrimitive.content })
    // A key the site has not set takes the file's value unless told otherwise.
    val keys = ScreenValues.lookup("data.keys", model.context) as JsonArray
    assertEquals(listOf("note", "title"), keys.map { (it as JsonObject)["key"]!!.jsonPrimitive.content })
    assertEquals(JsonPrimitive("package"), (keys.first() as JsonObject)["merged"])
    assertEquals(JsonPrimitive("site"), (keys.last() as JsonObject)["merged"])
    // Choosing whose value a key keeps is kept under the item.
    val choose = ActionSpec.parse(item.blocks.first { it.title == "Choose each value" }.raw.arr("actions").first())!!
    model.run(choose, scope("""{"params":{"key":"page/a"},"item":{"key":"note"},"form":{"side":"site"}}"""))
    assertEquals(json("""{"page/a":{"title":"package","note":"site"}}"""), ScreenStash.values["merge"])
  }

  @Test
  fun aDatasetShowsItsRecordsOneValueAtATimeAndAMergeShowsKeys() = runTest {
    ScreenStash.set(json("""{"package":{"manifest":{"items":[]}},"decisions":{"dataset/d":"replace"}}"""))
    val compare = """
      {"items":[{"key":"dataset/d","kind":"dataset","id":"d",
       "incoming":{"name":"Leads 2","records":[{"${'$'}id":"1","name":"A2"},{"${'$'}id":"3","name":"C"}]},
       "existing":{"id":"d","content":{"name":"Leads","records":[{"${'$'}id":"1","name":"A"},{"${'$'}id":"2","name":"B"}]}}}]}
    """.trimIndent()
    val item = spec("core.site.import.item")
    val model = ScreenModel(item, json("""{"site":{"id":"h1"},"params":{"key":"dataset/d"}}"""), client(200 to compare, sent = mutableListOf()))
    model.load()
    val diff = ScreenValues.lookup("data.diff", model.context) as JsonObject
    assertEquals(JsonPrimitive("records"), diff["recordField"])
    // The values but the records, and then each record value that differs (a record only a side holds, whole).
    assertEquals(listOf("name"), (diff["changes"] as JsonArray).map { (it as JsonObject)["label"]!!.jsonPrimitive.content })
    val records = ScreenValues.lookup("data.diff.records.changes", model.context) as JsonArray
    assertEquals(listOf("1 › name", "3", "2"), records.map { (it as JsonObject)["label"]!!.jsonPrimitive.content })
    assertEquals(listOf("changed", "added", "removed"), records.map { (it as JsonObject)["status"]!!.jsonPrimitive.content })
    assertEquals(
      JsonPrimitive("1 new record · 1 changed record · 1 record not in the file · 0 unchanged"),
      ScreenValues.lookup("data.diff.records.summary", model.context),
    )
    assertEquals("Not in the file", ScreenValues.render("{const.recordStatus[@item.status]}", ScreenContext.withItem(model.context, records[2])))
    // Merging shows the keys to choose between in place of the values.
    val merging = ScreenContext.with(model.context, "stash", json("""{"decisions":{"dataset/d":"merge"}}"""))
    val shown = item.blocks.filter { ScreenValues.condition(it.whenCondition, merging) }.mapNotNull { it.title }
    assertTrue("Choose each value" in shown)
    assertFalse("Values that change" in shown)
    assertTrue("Records" in shown)
  }

  @Test
  fun thePickListHoldsOnlyTheSiteItemsOfTheMissingItemsKind() = runTest {
    val catalog = """{"manifest":{"items":[{"${'$'}id":"lay1","kind":"layout","name":"Main"},{"${'$'}id":"p1","kind":"page","name":"Home"},{"${'$'}id":"lay2","kind":"layout","slug":"wide"}]},"kinds":[]}"""
    val model = ScreenModel(
      spec("core.site.import.pick"), json("""{"site":{"id":"h1"},"params":{"dep":"layout/other","kind":"layout"}}"""),
      routed("/api/hosts/export" to catalog),
    )
    model.load()
    val rows = ScreenValues.scopes("data.catalog.manifest.items", null, "item.kind == @params.kind", model.context)
    assertEquals(listOf("lay1", "lay2"), rows.map { (ScreenValues.lookup("item.\$id", it) as JsonPrimitive).content })
    assertEquals("layout and other", ScreenValues.render("{params.dep:head} and {params.dep:tail}", model.context))
  }
}
