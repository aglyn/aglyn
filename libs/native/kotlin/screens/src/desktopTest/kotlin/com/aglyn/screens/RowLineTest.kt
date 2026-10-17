package com.aglyn.screens

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** A list row's line made of parts leaves out a part that holds nothing, so it never ends on a dangling `set by `. */
class RowLineTest {
  private val line = Json.parseToJsonElement("""["{item.reason}", {"text": "set by {item.actorUid}", "when": "item.actorUid"}]""")

  @Test
  fun aRowLineLeavesOutThePartsThatHoldNothing() {
    assertEquals("Abuse · set by u1", rowLine(line, Json.parseToJsonElement("""{"item":{"reason":"Abuse","actorUid":"u1"}}""")))
    assertEquals("Abuse", rowLine(line, Json.parseToJsonElement("""{"item":{"reason":"Abuse"}}""")))
    assertNull(rowLine(line, Json.parseToJsonElement("""{"item":{}}""")))
    assertEquals("Plain", rowLine(Json.parseToJsonElement("\"{item.reason}\""), Json.parseToJsonElement("""{"item":{"reason":"Plain"}}""")))
  }
}
