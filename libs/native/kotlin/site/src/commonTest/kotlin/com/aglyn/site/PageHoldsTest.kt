// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.site

import com.aglyn.core.ConsoleApiClient
import com.aglyn.site.pages.HeldPageTarget
import com.aglyn.site.pages.PageHold
import com.aglyn.site.pages.fetchPageHolds
import com.aglyn.site.pages.holdsForTarget
import com.aglyn.site.pages.pageHoldBannerCopy
import com.aglyn.site.pages.pageHoldChips
import com.aglyn.site.pages.pageHoldDetailsLink
import com.aglyn.site.pages.pageHoldReviewLink
import com.aglyn.ui.StatusTone
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PageHoldsTest {
  private val answer = """
    {"holds":[
      {"noticeId":"n1","kind":"page-held","status":"held","chip":{"label":"Held for review","color":"warning"},
       "label":"the \"About\" page (/about)","details":["Seen on /about."],"visitorSentence":"Visitors see the previous version.",
       "targets":[{"type":"screen","id":"about"},{"type":"layout","id":"main"}],"reference":"HS-1","occurredAtMs":1,
       "reviewable":true,"reviewRequestedAtMs":null},
      {"noticeId":"n2","kind":"page-flagged","status":"in-review","chip":{"label":"Flagged","color":"info"},
       "label":"the \"Menu\" page","details":[],"visitorSentence":"Visitors still see this page while it is reviewed.",
       "targets":[{"type":"screen","id":"menu"}],"reference":null,"occurredAtMs":2,"reviewable":false,"reviewRequestedAtMs":null},
      {"noticeId":"n3","kind":"page-held","status":"held","chip":{"label":"Held for review","color":"warning"},
       "label":"the \"About\" page","details":[],"visitorSentence":"Second.","targets":[{"type":"screen","id":"about"}],
       "reference":null,"occurredAtMs":3,"reviewable":true,"reviewRequestedAtMs":null}
    ],"orgId":"o","canRequestReview":true}
  """.trimIndent()

  @Test
  fun readsTheSitesHoldsAndPutsThemOnTheirPages() = runTest {
    val urls = mutableListOf<io.ktor.http.Url>()
    val client = ConsoleApiClient(
      origin = "https://console.test/",
      http = HttpClient(
        MockEngine { request ->
          urls += request.url
          respond(answer, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
        },
      ),
      getIdToken = { "t" },
      sleep = {},
      maxAttempts = 1,
    )
    val read = fetchPageHolds(client, "h 1")
    assertEquals("/api/hosts/page-holds", urls.single().encodedPath)
    assertEquals("h 1", urls.single().parameters["hostId"])
    assertTrue(read.canRequestReview)
    assertEquals("o", read.orgId)
    val about = holdsForTarget(read.holds, HeldPageTarget("screen", "about"))
    assertEquals(listOf("n1", "n3"), about.map { it.noticeId })
    assertEquals(listOf("Held for review"), pageHoldChips(about).map { it.chipLabel })
    assertEquals(listOf("n1"), holdsForTarget(read.holds, HeldPageTarget("layout", "main")).map { it.noticeId })
    assertEquals(StatusTone.INFO, read.holds[1].tone)
  }

  @Test
  fun bannerSaysWhatHappenedAndWhatVisitorsSee() {
    val held = PageHold(
      "n1", "page-held", "held", "Held for review", "warning", "the \"About\" page", listOf("Seen on /about."),
      "Visitors see the previous version.", listOf(HeldPageTarget("screen", "about")), "HS-1", reviewable = true,
    )
    val (title, lines) = pageHoldBannerCopy(held, HeldPageTarget("screen", "about"))
    assertEquals("The \"About\" page is held for review by our automated safety review.", title)
    assertEquals(listOf("Seen on /about.", "Visitors see the previous version.", "Reference HS-1."), lines)
    assertEquals(
      "The \"About\" page, which uses this layout, is held for review by our automated safety review.",
      pageHoldBannerCopy(held, HeldPageTarget("layout", "main")).first,
    )
    val flagged = PageHold("n2", "page-flagged", "in-review", "Flagged", "info", "the page", visitorSentence = "", targets = emptyList())
    assertTrue(pageHoldBannerCopy(flagged, HeldPageTarget("screen", "x")).first.contains("flagged by our automated"))
    val rejected = PageHold("n4", "page-held", "rejected", "Not approved", "error", "the page", visitorSentence = "", targets = emptyList(), reviewRequestedAtMs = 0)
    val copy = pageHoldBannerCopy(rejected, HeldPageTarget("screen", "x"), "UTC")
    assertEquals("The page was not approved after review, and is not being served.", copy.first)
    assertEquals("A review was requested on 1/1/1970, 12:00 AM.", copy.second.first())
    assertEquals("/acme/settings/holds", pageHoldDetailsLink("acme"))
    assertEquals("/acme/settings/holds?notice=n1", pageHoldReviewLink("acme", "n1"))
  }
}
