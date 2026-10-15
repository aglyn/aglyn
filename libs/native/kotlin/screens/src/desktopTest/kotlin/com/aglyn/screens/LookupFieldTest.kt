package com.aglyn.screens

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.runComposeUiTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlin.test.Test
import kotlin.test.assertEquals

/** The "Populate from" field of a system email test: a button, a search dialog, a pick that comes back with its kind. */
@OptIn(ExperimentalTestApi::class)
class LookupFieldTest {
  private val field = FieldSpec.parse(
    Json.parseToJsonElement(
      """{"key":"populate","label":"Populate from","kind":"lookup","help":"Fill the variables below.",
         "groups":[
           {"id":"org","label":"Workspaces","url":"/o","items":"orgs","title":"{item.name}","subtitle":"{item.${'$'}id}"},
           {"id":"user","label":"People","url":"/u","items":"users","title":"{item.email}"}]}""",
    ),
  )!!

  @Test
  fun searchingAndPickingReportsTheRecordAndItsKind() = runComposeUiTest {
    val asked = mutableListOf<Pair<String, String>>()
    val picks = mutableListOf<Pair<String, JsonElement>>()
    val picked = mutableStateOf<String?>(null)
    setContent {
      MaterialTheme {
        LookupInput(
          field, Json.parseToJsonElement("{}"), picked.value,
          search = { group, words ->
            asked += group.id to words
            when (group.id) {
              "org" -> listOf(Json.parseToJsonElement("""{"name":"Acme Co","${'$'}id":"o1"}"""))
              else -> listOf(Json.parseToJsonElement("""{"email":"dana@example.test"}"""))
            }
          },
        ) { group, row -> picks += group.id to row; picked.value = group.heading(row, Json.parseToJsonElement("{}")) }
      }
    }
    onNodeWithText("Populate from: Choose").assertIsDisplayed()
    onNodeWithText("Fill the variables below.").assertIsDisplayed()
    onNodeWithTag("lookup-populate").performClick()
    // Opening lists the first few of every kind.
    waitUntil(timeoutMillis = 3_000) { onAllNodes(hasTestTag("lookup-org-0")).fetchSemanticsNodes().isNotEmpty() }
    assertEquals(listOf("org" to "", "user" to ""), asked.take(2))
    onNodeWithText("Acme Co").assertIsDisplayed()
    onNodeWithText("o1").assertIsDisplayed()
    onNodeWithText("dana@example.test").assertIsDisplayed()

    onNodeWithTag("lookup-search").performTextInput("dana")
    waitUntil(timeoutMillis = 3_000) { asked.any { it.second == "dana" } }
    onNodeWithTag("lookup-user-0").performClick()
    waitUntil(timeoutMillis = 3_000) { picks.isNotEmpty() }
    assertEquals(listOf("user"), picks.map { it.first })
    waitUntil(timeoutMillis = 3_000) { onAllNodes(hasTestTag("lookup-dialog")).fetchSemanticsNodes().isEmpty() }
    onNodeWithText("Populate from: dana@example.test").assertIsDisplayed()
  }
}
