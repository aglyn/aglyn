package com.aglyn.screens

import com.aglyn.core.ConsoleApiClient
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * A site's Collaborators carry the AI plugin's "AI credits (site, month)" column (the console's hostMembers column
 * `ai-collaborator-credits`, gap sweep Site home row 9): each collaborator's credits on the site this month, 0 for someone
 * with none, and a dash for an invited collaborator or a reader the usage route refuses, as the console's cell reads.
 */
class SiteCollaboratorCreditsColumnTest {
  private val root: File = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "libs/native/screens").isDirectory }
  private val column = ScreenSpec.parseFile(File(root, "libs/plugins/ai/src/ios/Sources/AglynAiPlugin/Resources/ai.screens.json").readText())
    .first { it.id == "ai.collaboratorCreditsColumn" }

  private fun client(vararg responses: Pair<Int, String>, sent: MutableList<HttpRequestData>): ConsoleApiClient {
    val queue = ArrayDeque(responses.toList())
    val engine = MockEngine { request ->
      sent += request
      val (status, body) = queue.removeFirstOrNull() ?: (200 to "{}")
      respond(body, HttpStatusCode.fromValue(status), headersOf("Content-Type", "application/json"))
    }
    return ConsoleApiClient("http://localhost", HttpClient(engine) { expectSuccess = false }, { "t" }, sleep = {})
  }

  /** The collaborators list, read from a route here so the test needs no Firestore; the column is the real one. */
  private fun collaborators(): ScreenSpec = ScreenSpec.parse(
    Json.parseToJsonElement(
      """{"id":"core.x","title":"X","load":{"members":{"url":"/api/x/members"}},
          "blocks":[{"type":"list","items":"data.members.items","columnsZone":"hostMembersColumn","primary":"{item.email}"}]}""",
    ),
  )!!

  @Test
  fun theSiteListDrawsTheColumnZone() {
    val users = ScreenSpec.parseFile(File(root, "libs/native/screens/site.screens.json").readText()).first { it.id == "core.site.users" }
    val list = users.blocks.first { it.type == "list" && it.raw.str("title") == "Collaborators" }
    assertEquals("hostMembersColumn", list.raw.str("columnsZone"))
    assertEquals(listOf("hostMembersColumn"), column.raw.arr("zones").map { it.toString().trim('"') })
  }

  @Test
  fun eachCollaboratorReadsTheirCreditsOnTheSiteAndAnInvitedOneADash() = runTest {
    ScreenCatalog.add(listOf(column))
    val sent = mutableListOf<HttpRequestData>()
    val api = client(
      200 to """{"items":[{"uid":"u1","email":"a@x.test"},{"uid":"u2","email":"b@x.test"},{"email":"c@x.test","status":"invited"}]}""",
      200 to """{"month":"2026-11","rows":[],"hostCells":{"u1":1234,"u2":0}}""",
      sent = sent,
    )
    val context = Json.parseToJsonElement("""{"org":{"id":"o1"},"site":{"id":"h1"}}""")
    val model = ScreenModel(collaborators(), context, api)
    model.load()
    // One read for the people with an account: the invited row has no uid to ask about.
    assertEquals("/api/ai/usage", sent.last().url.encodedPath)
    assertEquals("orgId=o1&hostId=h1&view=prepared&uids=u1%2Cu2", sent.last().url.encodedQuery)
    val columns = ListColumns.columns(model.spec.blocks.first())
    val rows = ScreenValues.rows(ScreenValues.lookup("data.members.items", model.context))
    val lines = rows.map { ListColumns.line(columns, setOf("aiSiteCredits"), ScreenContext.withItem(model.context, it)) }
    assertEquals(listOf("AI credits (site, month) 1,234", "AI credits (site, month) 0", "AI credits (site, month) —"), lines)
  }

  @Test
  fun aReaderTheRouteRefusesSeesADash() = runTest {
    ScreenCatalog.add(listOf(column))
    val sent = mutableListOf<HttpRequestData>()
    val api = client(200 to """{"items":[{"uid":"u1","email":"a@x.test"}]}""", 403 to """{"error":"billing.view required"}""", sent = sent)
    val model = ScreenModel(collaborators(), Json.parseToJsonElement("""{"org":{"id":"o1"},"site":{"id":"h1"}}"""), api)
    model.load()
    val columns = ListColumns.columns(model.spec.blocks.first())
    val row = ScreenValues.rows(ScreenValues.lookup("data.members.items", model.context)).single()
    assertEquals("AI credits (site, month) —", ListColumns.line(columns, setOf("aiSiteCredits"), ScreenContext.withItem(model.context, row)))
    assertEquals(JsonObject(emptyMap()).toString(), ScreenValues.lookup("column.aiSiteCredits", model.context).toString())
  }
}
