package com.aglyn.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The re-acceptance banner (AGL-2316) in the console's words: thanked first when the documents moved, our gap when no record. */
class LegalReacceptanceTest {
  @Test
  fun supersededThanksWithTheDayAndNamesWhatChanged() {
    val status = LegalStatus.of(
      Json.parseToJsonElement("""{"reacceptanceRequired":true,"reacceptanceReason":"version-superseded","latestAcceptedAt":"2026-11-02T15:00:00.000Z","changedDocumentKeys":["terms","privacy"]}""").jsonObject,
    )!!
    val copy = LegalReacceptanceCopy.make(status, "Aglyn")!!
    assertEquals("Thanks for agreeing to Aglyn’s ", copy.lead)
    assertTrue(copy.tail.startsWith(" on November 2, 2026. We’ve updated them since"))
    assertEquals("What changed: the Terms of Service and the Privacy Policy. Your earlier agreement stays on record — this adds to it.", copy.caption)
  }

  @Test
  fun supersededWithoutADayStillAcknowledges() {
    val copy = LegalReacceptanceCopy.make(LegalStatus(true, "version-superseded", null, null), "Aglyn")!!
    assertEquals("You’ve already agreed to Aglyn’s ", copy.lead)
    assertEquals("Your earlier agreement stays on record — this adds to it.", copy.caption)
  }

  @Test
  fun noRecordIsOurGapAndNothingIsAskedWhenCurrent() {
    assertEquals("We don’t have a record of your acceptance of Aglyn’s ", LegalReacceptanceCopy.make(LegalStatus(true, "never-accepted", null, null), "Aglyn")?.lead)
    assertNull(LegalReacceptanceCopy.make(LegalStatus(false, "none", null, null), "Aglyn"))
    assertNull(LegalReacceptanceCopy.defaultDay("soon"))
  }
}
