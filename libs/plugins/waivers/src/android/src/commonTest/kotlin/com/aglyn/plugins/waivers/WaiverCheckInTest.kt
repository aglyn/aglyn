package com.aglyn.plugins.waivers

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class WaiverCheckInTest {
  @Test
  fun aSignedWaiverInFullNeedsNothing() {
    val look = WaiverStatusLook.of(WaiverStatusAnswer(true, "Waiver signed", matched = true))
    assertTrue(look.signedInFull)
    assertFalse(look.needed)
    assertFalse(look.notMatched)
  }

  @Test
  fun signedForSomeRidersStillNeedsTheRest() {
    val look = WaiverStatusLook.of(WaiverStatusAnswer(true, "Signed for 2 of 3 riders"))
    assertFalse(look.signedInFull)
    assertTrue(look.needed)
  }

  @Test
  fun notMatchedOffersFindByName() {
    val look = WaiverStatusLook.of(WaiverStatusAnswer(false, "Waiver not matched — check by name", matched = false, searchName = "Lena Fischer"))
    assertTrue(look.notMatched)
    assertTrue(look.needed)
  }

  @Test
  fun noAnswerReadsNotOnFile() = assertEquals("Waiver not on file", WaiverStatusLook.of(null).label)

  @Test
  fun theAnswerDecodes() {
    val json = Json.parseToJsonElement("""{"signed":true,"label":"Waiver signed","coveredNames":["Ana"],"matched":true}""")
    assertEquals(WaiverStatusAnswer(true, "Waiver signed", matched = true), WaiverStatusAnswer.from(json))
  }

  @Test
  fun theQuerySendsTheContactAndOnlyMoreThanOnePerson() {
    assertEquals(
      mapOf("hostId" to "h1", "dayKey" to "2026-11-07", "email" to "a@b.co", "contactId" to "c1"),
      waiverStatusQuery("h1", "2026-11-07", "a@b.co", "c1", " ", 1),
    )
    assertEquals("3", waiverStatusQuery("h1", "2026-11-07", null, null, "Ana", 3)["people"])
  }
}
