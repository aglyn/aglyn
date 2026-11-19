package com.aglyn.plugins.ai

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The AI summary on a CRM record (AGL-2917): the console's `ai-crm.ts` and `ai-crm-record-card.component.tsx`. */
class AiCrmRecordTest {
  @Test
  fun anAnswerReadsAsTheConsoleReadsIt() {
    val proposal = AiCrmRecordProposal.from(
      Json.parseToJsonElement(
        """{"kind":"record","record":{"kind":"contact","id":"c-1"},"summary":"Dana asked for a quote.","standing":"Warm","asOf":"2026-11-16",
          "nextStep":{"title":"Send the quote","kind":"email","priority":"high","dueInDays":2,"reason":"She asked."},
          "stage":{"stageId":"s-2","stageName":"Proposal","reason":"A quote is out."}}""",
      ),
    )
    assertEquals("Dana asked for a quote.", proposal?.summary)
    assertEquals("Send the quote (Email, high priority, due in 2 days)", proposal?.nextStep?.let(::aiCrmNextStepLine))
    assertEquals("s-2", proposal?.stageId)
    assertNull(AiCrmRecordProposal.from(Json.parseToJsonElement("""{"kind":"email","record":{"kind":"contact","id":"c"},"subject":"s","body":"b"}""")))
    assertNull(AiCrmRecordProposal.from(Json.parseToJsonElement("""{"kind":"record","record":{"kind":"ticket","id":"c"},"summary":"s"}""")))
  }

  @Test
  fun dueWords() {
    assertEquals("due today", aiCrmDueWords(0))
    assertEquals("due tomorrow", aiCrmDueWords(1))
    assertEquals("due in 5 days", aiCrmDueWords(5))
    assertEquals("To-do", aiCrmTaskKindWords("todo"))
  }

  @Test
  fun aJobAnswersOnlyItsOwnRecord() {
    val job = Json.parseToJsonElement("""{"kind":"crm","outputs":[{"resource":"crm","proposal":{"kind":"record","record":{"kind":"deal","id":"d-1"}}}]}""")
    assertTrue(aiCrmJobAnswersRecord(job, "deal", "d-1"))
    assertFalse(aiCrmJobAnswersRecord(job, "deal", "d-2"))
    assertFalse(aiCrmJobAnswersRecord(job, "contact", "d-1"))
    assertFalse(aiCrmJobAnswersRecord(Json.parseToJsonElement("""{"kind":"seo"}"""), "deal", "d-1"))
  }
}
