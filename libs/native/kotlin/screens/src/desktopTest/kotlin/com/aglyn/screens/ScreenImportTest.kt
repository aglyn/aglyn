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
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The records import wizard (`transfer-import.screens.json`) and the grammar it leans on: a file read in the
 * encoding it was saved in, sent in parts, an action asked until the route says it is done, and the choices
 * each step keeps for the next. Apple replays the same cases (ScreenImportTests).
 */
class ScreenImportTest {
  private val root: File = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "libs/native/screens").isDirectory }

  @BeforeTest
  fun reset() {
    ScreenValues.timeZone = "UTC"
    ScreenStash.clear()
  }

  @AfterTest
  fun clear() = ScreenStash.clear()

  private fun spec(id: String) = ScreenSpec.parseFile(File(root, "libs/native/screens/transfer-import.screens.json").readText()).first { it.id == id }

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

  private fun body(sent: List<HttpRequestData>, at: Int) = json((sent[at].body as TextContent).text)

  private val plain get() = ScreenSpec.parse(json("""{"id":"core.x","title":"X"}"""))!!

  @Test
  fun aChosenFileIsReadInTheEncodingItWasSavedIn() {
    fun bytes(vararg values: Int) = ByteArray(values.size) { values[it].toByte() }
    assertEquals("a,b", ScreenValues.decodeFileText(bytes(0xEF, 0xBB, 0xBF) + "a,b".encodeToByteArray()))
    assertEquals("a,b", ScreenValues.decodeFileText(bytes(0xFF, 0xFE, 0x61, 0x00, 0x2C, 0x00, 0x62, 0x00)))
    assertEquals("a,b", ScreenValues.decodeFileText(bytes(0xFE, 0xFF, 0x00, 0x61, 0x00, 0x2C, 0x00, 0x62)))
    assertEquals("café", ScreenValues.decodeFileText("café".encodeToByteArray()))
    // A spreadsheet's "CSV" is Windows-1252: é is one byte, and 0x80 is the euro sign.
    assertEquals("café", ScreenValues.decodeFileText(bytes(0x63, 0x61, 0x66, 0xE9)))
    assertEquals("€1", ScreenValues.decodeFileText(bytes(0x80, 0x31)))
  }

  @Test
  fun aFileIsCutIntoPartsThatEachFitTheBudgetOnceEncoded() {
    val text = "a\"b\n€😀/".repeat(40)
    val parts = ScreenValues.splitUpload(text, 100)
    assertTrue(parts.size > 1)
    assertEquals(text, parts.joinToString(""))
    for (part in parts) {
      // JSON-encoded size, as the route counts it: quotes and line breaks cost two, a euro sign three, an emoji four.
      val cost = part.codePoints().toArray().sumOf { code ->
        when {
          code == '"'.code || code == '\\'.code || code == 0x0A -> 2
          code < 0x80 -> 1
          code < 0x800 -> 2
          code < 0x10000 -> 3
          else -> 4
        }.toInt()
      }
      assertTrue(cost <= 100)
    }
    assertEquals(listOf(""), ScreenValues.splitUpload("", 10))
    assertEquals(listOf("abc"), ScreenValues.splitUpload("abc", 10))
  }

  @Test
  fun aFileGoesUpInPartsWithTheJobTheFirstAnswerNamed() = runTest {
    val sent = mutableListOf<HttpRequestData>()
    val api = client(
      200 to """{"job":{"id":"j7"},"complete":false}""", 200 to """{"job":{"id":"j7"},"complete":false}""", 200 to """{"job":{"id":"j7"},"complete":true}""",
      sent = sent,
    )
    val model = ScreenModel(plain, JsonObject(emptyMap()), api)
    val upload = ActionSpec.parse(
      json(
        """{"label":"Upload","url":"/api/transfer/upload",
           "body":{"orgId":"o1","content":"{form.file}","delimiter?":"{form.delimiter}","headerRow":"{form.headerRow}"},
           "chunk":{"field":"content","bytes":10,"idFrom":"job.id","idKey":"jobId","firstOnly":["delimiter","headerRow"],"until":"complete"}}""",
      ),
    )!!
    val outcome = model.run(upload, json("""{"form":{"file":"abcdefghijklmnopqrstuvwxyz","delimiter":";","headerRow":true}}"""))
    assertIs<ActionOutcome.Done>(outcome)
    assertEquals(3, sent.size)
    assertEquals(json("""{"orgId":"o1","content":"abcdefghij","delimiter":";","headerRow":true,"part":0,"parts":3}"""), body(sent, 0))
    assertEquals(json("""{"orgId":"o1","content":"klmnopqrst","part":1,"parts":3,"jobId":"j7"}"""), body(sent, 1))
    assertEquals(json("""{"orgId":"o1","content":"uvwxyz","part":2,"parts":3,"jobId":"j7"}"""), body(sent, 2))

    // A file that has not landed whole is not an upload.
    val short = mutableListOf<HttpRequestData>()
    val lone = ScreenModel(plain, JsonObject(emptyMap()), client(200 to """{"job":{"id":"j8"},"complete":false}""", sent = short))
    val failed = lone.run(upload, json("""{"form":{"file":"abc"}}"""))
    assertIs<ActionOutcome.Failed>(failed)
    assertEquals("The file did not finish uploading. Try again.", failed.message)
    assertEquals(1, short.size)
    assertNull((body(short, 0) as JsonObject)["part"])
  }

  @Test
  fun anActionIsAskedAgainUntilTheRouteIsDoneAndTheStashShowsEachPass() = runTest {
    val sent = mutableListOf<HttpRequestData>()
    val api = client(
      200 to """{"done":false,"progress":{"rowsDone":10,"rowCount":30}}""", 200 to """{"done":false,"progress":{"rowsDone":20,"rowCount":30}}""",
      200 to """{"done":true,"progress":{"rowsDone":30,"rowCount":30}}""", sent = sent,
    )
    val apply = ActionSpec.parse(
      json(
        """{"label":"Import","url":"/api/transfer/apply","body":{"jobId":"j1"},
           "repeat":{"until":"response.done","max":10,"stop":"response.job.status == failed"},
           "stash":{"importProgress":"{response.progress}"}}""",
      ),
    )!!
    val done = ScreenModel(plain, JsonObject(emptyMap()), api).run(apply, JsonObject(emptyMap()))
    assertIs<ActionOutcome.Done>(done)
    assertEquals(3, sent.size)
    assertEquals(json("""{"rowsDone":30,"rowCount":30}"""), ScreenStash.values["importProgress"])

    // A route that says the job failed ends it with the route's own words.
    ScreenStash.clear()
    val failing = mutableListOf<HttpRequestData>()
    val careful = ActionSpec.parse(
      json(
        """{"label":"Import","url":"/api/transfer/apply",
           "repeat":{"until":"response.done","stop":"response.job.status == failed","stopMessage":"{response.job.error.message|'Stopped.'}"}}""",
      ),
    )!!
    val stopped = ScreenModel(
      plain, JsonObject(emptyMap()),
      client(200 to """{"done":false,"job":{"status":"applying"}}""", 200 to """{"done":false,"job":{"status":"failed","error":{"message":"The file changed."}}}""", sent = failing),
    ).run(careful, JsonObject(emptyMap()))
    assertIs<ActionOutcome.Failed>(stopped)
    assertEquals("The file changed.", stopped.message)
    assertEquals(2, failing.size)

    // And it stops at the ceiling rather than asking for ever.
    val endless = mutableListOf<HttpRequestData>()
    ScreenModel(plain, JsonObject(emptyMap()), client(*Array(5) { 200 to """{"done":false}""" }, sent = endless))
      .run(ActionSpec.parse(json("""{"label":"Go","url":"/api/x","repeat":{"until":"response.done","max":3}}"""))!!, JsonObject(emptyMap()))
    assertEquals(3, endless.size)
  }

  @Test
  fun aFollowUpRunsWithTheStashJustMadeAndItsFailureFailsTheAction() = runTest {
    val sent = mutableListOf<HttpRequestData>()
    val upload = ActionSpec.parse(
      json(
        """{"label":"Upload","url":"/api/transfer/upload","stash":{"importJob":"{response.job.id}"},
           "after":{"label":"Read","url":"/api/transfer/analyze","body":{"jobId":"{stash.importJob}"},"stash":{"importMapping":"{response.match.mapping}"}}}""",
      ),
    )!!
    val model = ScreenModel(plain, JsonObject(emptyMap()), client(200 to """{"job":{"id":"j1"}}""", 200 to """{"match":{"mapping":{"0":"email"}}}""", sent = sent))
    assertIs<ActionOutcome.Done>(model.run(upload, JsonObject(emptyMap())))
    assertEquals(json("""{"jobId":"j1"}"""), body(sent, 1))
    assertEquals(json("""{"0":"email"}"""), ScreenStash.values["importMapping"])

    val other = ScreenModel(plain, JsonObject(emptyMap()), client(200 to """{"job":{"id":"j2"}}""", 500 to """{"error":"The file could not be read."}""", sent = mutableListOf()))
    val failed = other.run(upload, JsonObject(emptyMap()))
    assertIs<ActionOutcome.Failed>(failed)
    assertEquals("The file could not be read.", failed.message)
  }

  @Test
  fun eachScopeKnowsItsPositionAndAnActionMayAskToReload() {
    val context = json("""{"data":{"headers":["A","B","C"]}}""")
    val scopes = ScreenValues.scopes("data.headers", null, "item != B", context)
    assertEquals(listOf("0:A", "2:C"), scopes.map { ScreenValues.render("{index}:{item}", it) })
    assertTrue(ActionSpec.parse(json("""{"label":"Go","stash":{"a":1},"reload":true}"""))!!.reload)
    assertFalse(ActionSpec.parse(json("""{"label":"Go","stash":{"a":1}}"""))!!.reload)
  }

  private val analysis = """
    {"headers":["Email","Name","Plan"],"rowCount":2,
     "samples":[["a@x.com","Ann","pro"],["b@x.com","Bo","free"]],
     "match":{"mapping":{"0":"email"},"proposals":[{"column":0,"fieldId":"email","reason":"exactAlias","confidence":0.99}]},
     "mappingProblems":{"duplicates":[],"unmappedRequired":[],"invalid":[]}}"""

  private val info = """
    {"fields":[{"id":"email","label":"Email","matchKey":true},{"id":"name","label":"Name"},
               {"id":"created","label":"Created","system":true},{"id":"score","label":"Score","derived":true}]}"""

  @Test
  fun theColumnsStepShowsEachColumnWithItsValuesAndProposalAndKeepsTheMapping() = runTest {
    val columns = spec("core.settings.data.import.columns")
    val list = columns.blocks.first { it.title == "Columns" }
    val context = json("""{"org":{"id":"o1"},"const":${columns.raw.obj("constants")},"data":{"analysis":$analysis,"info":$info},"stash":{"importMapping":{"0":"email"},"importFile":"people.csv"}}""")
    val rows = ScreenValues.scopes("data.analysis.headers", null, null, context)
    fun line(key: String, row: Int) = ScreenValues.render(list.string(key).orEmpty(), rows[row])
    assertEquals("Email", line("primary", 0))
    assertEquals("a@x.com, b@x.com", line("secondary", 0))
    assertEquals("Proposed: Email · Same name", line("tertiary", 0))
    assertEquals("Email", line("trailing", 0))
    assertEquals("Ignored", line("trailing", 1))
    assertEquals("Proposed: nothing · no match", line("tertiary", 1))
    assertEquals("pro, free", line("secondary", 2))

    // Choosing a field for a column keeps it under the column's position; the choice offers only what a file can write.
    val choose = ActionSpec.parse(list.raw.arr("actions").first())!!
    assertTrue(choose.reload)
    val sent = mutableListOf<HttpRequestData>()
    val model = ScreenModel(columns, JsonObject(emptyMap()), client(sent = sent))
    val withStash = { scope: JsonElement -> ScreenContext.with(scope, "stash", json("""{"importMapping":{"0":"email"}}""")) }
    model.run(choose, withStash(ScreenContext.with(rows[1], "form", json("""{"field":"name"}"""))))
    assertEquals(json("""{"0":"email","1":"name"}"""), ScreenStash.values["importMapping"])
    assertEquals(listOf("", "email", "name"), choose.prompt.first().choices(rows[1]).map { it.first })
    // Ignoring a column takes it out of the mapping.
    ScreenStash.clear()
    model.run(choose, withStash(ScreenContext.with(rows[0], "form", json("""{"field":""}"""))))
    assertEquals(json("{}"), ScreenStash.values["importMapping"])

    // Continue waits for a usable mapping: no field two columns share, no required field left out, something mapped.
    val next = ActionSpec.parse(columns.blocks.last { it.type == "actions" }.raw.arr("items").first())!!
    assertTrue(ScreenValues.condition(next.whenCondition, context))
    val shared = ScreenContext.with(
      context, "data",
      json("""{"info":$info,"analysis":${analysis.replace(""""duplicates":[]""", """"duplicates":[{"fieldId":"email","columns":[0,1]}]""")}}"""),
    )
    assertFalse(ScreenValues.condition(next.whenCondition, shared))
    assertFalse(ScreenValues.condition(next.whenCondition, ScreenContext.with(context, "stash", json("""{"importMapping":{}}"""))))
    val problems = columns.blocks.first { it.type == "list" && it.title != "Columns" }
    assertEquals(
      listOf("Email is chosen for more than one column. Choose one column for it."),
      ScreenValues.scopes(problems.string("items").orEmpty(), null, null, shared).map { ScreenValues.render(problems.string("primary").orEmpty(), it) },
    )
  }

  @Test
  fun continuingFromTheColumnsKeepsTheListsProposalsUnderTheChoicesAlreadyMade() = runTest {
    val columns = spec("core.settings.data.import.columns")
    val next = ActionSpec.parse(columns.blocks.last { it.type == "actions" }.raw.arr("items").first())!!
    val answer = """
      {"picklists":[
        {"fieldId":"status","proposals":{"actv":{"action":"mapTo","valueId":"a"},"old":{"action":"leaveBlank"}}},
        {"fieldId":"tier","proposals":{"gold":{"action":"addValue"}}}]}"""
    val sent = mutableListOf<HttpRequestData>()
    ScreenStash.set(json("""{"importJob":"j1","importMapping":{"0":"email"},"importPicklists":{"status":{"old":{"action":"refuseRow"}}}}"""))
    val scope = ScreenContext.with(json("""{"org":{"id":"o1"}}"""), "stash", ScreenStash.values)
    ScreenModel(columns, JsonObject(emptyMap()), client(200 to answer, sent = sent)).run(next, scope)
    // The person's earlier choice wins over the proposal; the rest of the proposals are on screen to change.
    assertEquals(
      json("""{"status":{"actv":{"action":"mapTo","valueId":"a"},"old":{"action":"refuseRow"}},"tier":{"gold":{"action":"addValue"}}}"""),
      ScreenStash.values["importPicklists"],
    )
    assertEquals(json("""{"orgId":"o1","jobId":"j1","mapping":{"0":"email"}}"""), body(sent, 0))
  }

  @Test
  fun choosingWhatAListValueBecomesKeepsItUnderItsFieldAndValue() = runTest {
    val values = spec("core.settings.data.import.values")
    val list = values.blocks.first { it.title == "Values a list does not hold" }
    val picklists = """
      [{"fieldId":"status","spec":{"restricted":true},"proposals":{},
        "set":{"values":[{"id":"a","label":"Active","active":true},{"id":"z","label":"Old","active":false}]},
        "unmatched":[{"key":"actv","value":"actv","count":2,"suggestions":[{"valueId":"a","label":"Active","confidence":0.8}]}]}]"""
    val context = json(
      """{"const":${values.raw.obj("constants")},"data":{"analysis":{"picklists":$picklists},"info":$info},
          "stash":{"importPicklists":{"status":{"old":{"action":"leaveBlank"},"actv":{"action":"mapTo","valueId":"a"}}}}}""",
    )
    val rows = ScreenValues.scopes("data.analysis.picklists", "unmatched", null, context)
    assertEquals(1, rows.size)
    assertEquals("“actv”", ScreenValues.render(list.string("primary").orEmpty(), rows[0]))
    assertEquals("Closest: Active", ScreenValues.render(list.string("tertiary").orEmpty(), rows[0]))
    assertEquals("Map to a list value", ScreenValues.render(list.string("trailing").orEmpty(), rows[0]))
    val choose = ActionSpec.parse(list.raw.arr("actions").first())!!
    val fields = choose.prompt
    assertEquals(listOf("action", "valueId", "label", "meaning", "group"), fields.map { it.key })
    assertEquals(listOf("a"), fields[1].choices(rows[0]).map { it.first }) // an inactive value is not offered
    assertEquals(FieldValue.Text("a"), initialValue(fields[1], rows[0]))
    val answered = ScreenContext.with(rows[0], "form", json("""{"action":"addValue","label":"Actively","meaning":"","group":""}"""))
    assertTrue(ScreenValues.condition(fields[2].whenCondition, answered))
    assertFalse(ScreenValues.condition(fields[3].whenCondition, answered)) // this list names no meanings
    ScreenModel(values, JsonObject(emptyMap()), client(sent = mutableListOf())).run(choose, answered)
    assertEquals(
      json("""{"status":{"old":{"action":"leaveBlank"},"actv":{"action":"addValue","label":"Actively"}}}"""),
      ScreenStash.values["importPicklists"],
    )
  }

  @Test
  fun theReviewPlansAgainWithThePoliciesAndTheRowChoicesAndAsksForEveryAcknowledgement() = runTest {
    val review = spec("core.settings.data.import.review")
    val plan = """{"summary":{"create":1},"acknowledgementsRequired":["overwriteNonBlank"],"ambiguous":[],"conflicts":[],"warnings":[],"sample":[],"recordLabels":{}}"""
    val sent = mutableListOf<HttpRequestData>()
    ScreenStash.set(
      json(
        """{"importJob":"j1","importMapping":{"0":"email"},"importKeys":["email"],
            "importPolicy":{"record":{"onMatch":"update","onNew":"create","onAmbiguous":"ask"},"fieldDefault":{"mode":"fillBlanks","blank":"leave"}},
            "importFields":{"name":{"mode":"overwrite"}},"importRows":{"2":{"action":"skip"}}}""",
      ),
    )
    val ambiguous = review.blocks.first { it.title == "Rows that match more than one record" }
    val actions = ambiguous.raw.arr("actions").mapNotNull { ActionSpec.parse(it) }
    assertEquals(listOf("record", "skip"), actions.map { it.id })
    val scope = ScreenContext.with(
      ScreenContext.withItem(ScreenContext.with(json("""{"org":{"id":"o1"}}"""), "stash", ScreenStash.values), json("""{"row":5,"recordIds":["r1","r2"]}""")),
      "form", json("""{"record":"r2"}"""),
    )
    ScreenModel(review, JsonObject(emptyMap()), client(200 to plan, sent = sent)).run(actions[0], scope)
    assertEquals(
      json(
        """{"orgId":"o1","jobId":"j1","mapping":{"0":"email"},"matchKeys":["email"],
            "policy":{"record":{"onMatch":"update","onNew":"create","onAmbiguous":"ask"},"fieldDefault":{"mode":"fillBlanks","blank":"leave"},
                      "fields":{"name":{"mode":"overwrite"}},"rows":{"2":{"action":"skip"},"5":{"recordId":"r2"}}}}""",
      ),
      body(sent, 0),
    )
    assertEquals(json("""{"2":{"action":"skip"},"5":{"recordId":"r2"}}"""), ScreenStash.values["importRows"])
    assertEquals(json("1"), ScreenValues.lookup("summary.create", ScreenStash.values.getValue("importPlan")))

    // Import asks for every acknowledgement the plan requires; with none to ask, it runs straight away.
    val items = review.blocks.last { it.type == "actions" }.raw.arr("items")
    val apply = ActionSpec.parse(items.first())!!
    val applyNow = ActionSpec.parse(items.last())!!
    fun offered(plan: String) = listOf(apply, applyNow)
      .filter { ScreenValues.condition(it.whenCondition, json("""{"stash":{"importPlan":$plan}}""")) }.map { it.id }
    assertEquals(listOf("apply"), offered("""{"acknowledgementsRequired":["overwriteNonBlank"]}"""))
    assertEquals(listOf("applyNow"), offered("""{"acknowledgementsRequired":[]}"""))
    val ack = apply.prompt.first()
    assertTrue(ack.unmet(json("""["x"]"""), ScreenContext.with(JsonObject(emptyMap()), "stash", ScreenStash.values)))
    assertEquals(JsonPrimitive("response.done"), (apply.repeating as JsonObject)["until"])
  }

  @Test
  fun theOpenStepSendsAnImportToWhereItStands() {
    val open = spec("core.settings.data.import.open")
    val actions = open.blocks.first { it.type == "actions" }.raw.arr("items").mapNotNull { ActionSpec.parse(it) }
    fun shown(status: String) = actions.filter { ScreenValues.condition(it.whenCondition, json("""{"data":{"status":{"job":{"status":"$status"}}}}""")) }.map { it.id }
    assertEquals(listOf("continue"), shown("draft"))
    assertEquals(listOf("continue"), shown("planned"))
    assertEquals(listOf("resume"), shown("applying"))
    assertEquals(listOf("resume"), shown("failed"))
    assertEquals(listOf("results"), shown("applied"))
    assertEquals(listOf("results"), shown("undone"))
  }

  /** The console's own answers for the two comparisons a site item import shows, replayed. */
  @Test
  fun theItemDiffAndMergeKeysReplayTheConsolesCases() {
    val file = json(File(root, "libs/native/contracts/function-cases.generated.json").readText()) as JsonObject
    val functions = file.getValue("functions") as JsonObject
    for (name in listOf("packageJsonDiff", "packageMergeKeys", "packageItemChanges")) {
      val cases = ((functions.getValue(name) as JsonObject).getValue("cases") as kotlinx.serialization.json.JsonArray)
      assertTrue(cases.size > 5, name)
      for (one in cases) {
        val args = (((one as JsonObject).getValue("args")) as kotlinx.serialization.json.JsonArray).toList()
        assertEquals(one.getValue("result"), ScreenFunctions.call(name, args), "$name $args")
      }
    }
    assertEquals(null, ScreenFunctions.call("nothing", emptyList()))
  }
}
