package com.aglyn.plugins.ai

import com.aglyn.core.ConsoleApiError
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlin.coroutines.Continuation
import kotlin.coroutines.EmptyCoroutineContext
import kotlin.coroutines.startCoroutine
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Rating an Assist answer: the console's `assist-panel.component.tsx` (`sendFeedback`, the thumbs) and `/api/assist/feedback`. */
class AssistAnswerRatingTest {
  /** Runs a suspend block that never suspends (the posts below answer at once). */
  private fun <T> runNow(block: suspend () -> T): T {
    var out: Result<T>? = null
    block.startCoroutine(Continuation(EmptyCoroutineContext) { out = it })
    return out!!.getOrThrow()
  }

  private fun event(json: String): JsonObject = Json.parseToJsonElement(json).jsonObject

  @Test
  fun theAnswerKeepsTheExchangeItWasRecordedUnder() {
    val done = AssistTurn("assistant", "Open Settings.").done(
      event("""{"type":"done","exchangeId":"ex-1","docs":[{"title":"Invite your team","url":"https://docs.example/team"}],"proposal":{"label":"Open Team","href":"/acme/team"}}"""),
    )
    assertEquals("ex-1", done.exchangeId)
    assertEquals(listOf("Invite your team" to "https://docs.example/team"), done.docs)
    assertEquals("Open Team" to "/acme/team", done.proposal)
    assertNull(done.feedback)
    // No exchange (a route that recorded nothing), or an empty one: no thumbs, as on the console.
    assertNull(AssistTurn("assistant", "").done(event("""{"type":"done","exchangeId":null}""")).exchangeId)
    assertNull(AssistTurn("assistant", "").done(event("""{"type":"done","exchangeId":""}""")).exchangeId)
  }

  @Test
  fun aTapPostsTheConsolesBody() {
    var sent: JsonObject? = null
    val said = runNow { sendAssistFeedback(AssistFeedback.DOWN, "ex-1", "org-1") { sent = it } }
    assertEquals(event("""{"orgId":"org-1","exchangeId":"ex-1","feedback":"down"}"""), sent)
    assertNull(said)
    assertEquals("up", assistFeedbackBody("org-1", "ex-1", AssistFeedback.UP)["feedback"]?.let { (it as kotlinx.serialization.json.JsonPrimitive).content })
    assertEquals("Helpful answer", AssistFeedback.UP.label)
    assertEquals("Unhelpful answer", AssistFeedback.DOWN.label)
  }

  @Test
  fun aRatedAnswerSaysSo() {
    val rated = AssistTurn("assistant", "Open Settings.", exchangeId = "ex-1").copy(feedback = AssistFeedback.UP)
    assertEquals(AssistFeedback.UP, rated.feedback)
    assertEquals("Thanks — you already rated this answer", ASSIST_ALREADY_RATED)
  }

  @Test
  fun aRefusedPostSaysNothingAndAnUnsentOneSaysItCouldNotBeRecorded() {
    // The route answered (an unknown exchange, a locked workspace): the console reads no reply, and the rating stands.
    assertNull(runNow { sendAssistFeedback(AssistFeedback.UP, "ex-1", "org-1") { throw ConsoleApiError("Unknown exchange", 404, null) } })
    assertNull(runNow { sendAssistFeedback(AssistFeedback.UP, "ex-1", "org-1") { throw ConsoleApiError("Not a member", 403, null) } })
    // It never reached the route: the console's "Feedback could not be recorded".
    assertEquals("Feedback could not be recorded", runNow { sendAssistFeedback(AssistFeedback.UP, "ex-1", "org-1") { throw ConsoleApiError("Unreachable", 0, null) } })
    assertEquals(ASSIST_FEEDBACK_FAILED, runNow { sendAssistFeedback(AssistFeedback.UP, "ex-1", "org-1") { throw IllegalStateException("offline") } })
  }

  @Test
  fun theDebugSettledAnswerIsOnlyThereWhenTheAppWasLaunchedOnOne() {
    assertTrue(assistDebugSettledTurns(null).isEmpty())
    assertTrue(assistDebugSettledTurns("").isEmpty())
    val turns = assistDebugSettledTurns("ex-9")
    assertEquals(listOf("user", "assistant"), turns.map { it.role })
    assertEquals("ex-9", turns.last().exchangeId)
  }
}
