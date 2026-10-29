package com.aglyn.plugins.marketplace

import com.aglyn.contracts.PayoutReadiness
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class SellerTest {
  private class Calls(answer: String = "{}", status: HttpStatusCode = HttpStatusCode.OK) {
    val seen = mutableListOf<Pair<String, JsonObject>>()
    val methods = mutableListOf<String>()
    val client = ConsoleApiClient(
      origin = "https://console.test/",
      http = HttpClient(
        MockEngine { request ->
          val text = (request.body as? OutgoingContent.ByteArrayContent)?.bytes()?.decodeToString().orEmpty()
          methods += request.method.value
          seen += request.url.encodedPath to (if (text.isEmpty()) JsonObject(emptyMap()) else Json.parseToJsonElement(text).jsonObject)
          respond(answer, status, headersOf(HttpHeaders.ContentType, "application/json"))
        },
      ),
      getIdToken = { "t" },
      sleep = {},
      maxAttempts = 1,
    )
  }

  @Test
  fun theSellerReadsItsListingsAndSalesByTheOrganization() {
    assertEquals(listOf(FirestoreFilter("profileId", FilterOp.EQ, "o1")), sellerListingsQuery("o1").filters)
    assertEquals("marketplaceListings", sellerListingsQuery("o1").collectionPath)
    assertEquals(listOf(FirestoreFilter("sellerOrgId", FilterOp.EQ, "o1")), sellerSalesQuery("o1").filters)
    assertEquals("marketplacePurchases", sellerSalesQuery("o1").collectionPath)
    assertEquals("publisherProfiles/o1", publisherProfilePath("o1"))
  }

  @Test
  fun aListingRowSaysWhatTheConsoleSays() {
    val paid = SellerListing.from(
      FirestoreDoc("l1", "marketplaceListings/l1", mapOf("displayName" to "Hero", "latestVersion" to "3", "priceUsd" to 5L, "previewImageUrl" to "https://x/y.png", "visibility" to "private", "type" to "plugin", "categories" to listOf("Marketing"))),
    )
    assertEquals("v3 · \$5 · has preview", paid.subtitle)
    assertEquals(true, paid.isPrivate)
    assertEquals(true, paid.isPlugin)
    assertEquals("Marketing", paid.category)
    val free = SellerListing.from(FirestoreDoc("l2", "p", mapOf("displayName" to "Footer", "latestVersion" to 2L, "deletedAt" to 1L, "category" to "Docs")))
    assertEquals("v2 · free · unpublished", free.subtitle)
    assertEquals(false, free.isPlugin)
    assertEquals("component", free.artifactType)
    assertEquals("Docs", free.category)
  }

  @Test
  fun moneyIsWrittenInDollarsAndCents() {
    assertEquals("\$12.34", dollars(1234.0))
    assertEquals("\$0.05", dollars(5.0))
    assertEquals("\$0.00", dollars(0.0))
    assertEquals("-\$1.50", dollars(-150.0))
    assertEquals("\$0.00", dollars(Double.NaN))
    assertEquals("\$88.25", dollars(8825.0))
  }

  @Test
  fun thePayoutsCardSaysWhereTheArrangementStands() {
    assertEquals("Set up payouts", payoutsButton(PayoutReadiness.DISCONNECTED))
    assertEquals("Payouts enabled — recheck status", payoutsButton(PayoutReadiness.READY))
    assertEquals("Finish payout setup in Stripe", payoutsButton(PayoutReadiness.BLOCKED))
    assertEquals("Reconnect Stripe to verify", payoutsButton(PayoutReadiness.UNVERIFIED))
    assertEquals("Recheck payout status", payoutsButton(PayoutReadiness.UNKNOWN))
    assertEquals(true, payoutsSentence(PayoutReadiness.READY).startsWith("Payouts are enabled"))
    assertEquals(true, payoutsSentence(PayoutReadiness.UNKNOWN).contains("recheck to confirm"))
    assertEquals(true, payoutsSentence(PayoutReadiness.DISCONNECTED).startsWith("Connect a Stripe account"))
  }

  /** The publisher agreement a save agrees to (AGL-4105), as each seller save sends it. */
  private val agreed = PublisherAgreementConsent("2026-08-24.1")

  private fun assertAgreed(body: Map<String, kotlinx.serialization.json.JsonElement>) {
    val agreement = body["agreement"]!!.jsonObject
    assertEquals("2026-08-24.1", agreement["version"]?.jsonPrimitive?.content)
    assertEquals("true", agreement["accepted"]?.jsonPrimitive?.content)
  }

  @Test
  fun theProfileIsSavedThroughTheRouteWithTheOrganization() = runTest {
    val calls = Calls()
    SellerApi(calls.client, "o1").saveProfile(mapOf("handle" to "studio", "displayName" to "Studio", "bio" to ""), agreed)
    val (path, body) = calls.seen.single()
    assertEquals("/api/marketplace/publisher-profile", path)
    assertEquals(mapOf("orgId" to "o1", "handle" to "studio", "displayName" to "Studio", "bio" to ""), body.filterKeys { it != "agreement" }.mapValues { it.value.jsonPrimitive.content })
    assertAgreed(body)
  }

  @Test
  fun payoutsStartThroughConnectAndADeploymentWithoutItAnswers501() = runTest {
    val calls = Calls("""{"chargesEnabled":true,"payoutsEnabled":false,"url":"https://stripe.test/onboard","dashboardUrl":null}""")
    val answer = SellerApi(calls.client, "o1").connect()!!
    assertEquals("/api/marketplace/connect", calls.seen.single().first)
    assertEquals("o1", calls.seen.single().second["orgId"]?.jsonPrimitive?.content)
    assertEquals(true, answer.chargesEnabled)
    assertEquals(false, answer.payoutsEnabled)
    assertEquals("https://stripe.test/onboard", answer.url)
    assertNull(answer.dashboardUrl)
    val refused = Calls("""{"error":"not configured"}""", HttpStatusCode.NotImplemented)
    assertEquals(501, assertFailsWith<ConsoleApiError> { SellerApi(refused.client, "o1").connect() }.status)
  }

  @Test
  fun aListingIsChangedThroughThePublishRouteOneActionAtATime() = runTest {
    val calls = Calls()
    val api = SellerApi(calls.client, "o1")
    api.setVisibility("l1", "private", agreed)
    api.setPublished("l1", published = false, agreement = agreed)
    api.updateListing("l1", mapOf("displayName" to "Hero", "description" to "A hero", "readme" to "About it", "homepageUrl" to "https://x.test"), "Marketing", listOf("/api/media/cdn/org:o1/a", "/api/media/cdn/org:o1/b"), agreed)
    api.updateListing("l1", mapOf("displayName" to "Hero"), "", emptyList(), agreed)
    assertEquals(List(4) { "/api/marketplace/publish-plugin" }, calls.seen.map { it.first })
    assertEquals(mapOf("action" to "set-visibility", "listingId" to "l1", "visibility" to "private"), calls.seen[0].second.filterKeys { it != "agreement" }.mapValues { it.value.jsonPrimitive.content })
    assertEquals(mapOf("action" to "set-published", "listingId" to "l1", "published" to "false"), calls.seen[1].second.filterKeys { it != "agreement" }.mapValues { it.value.jsonPrimitive.content })
    val update = calls.seen[2].second
    assertEquals("update-listing", update["action"]?.jsonPrimitive?.content)
    assertEquals(listOf("Marketing"), update["categories"]!!.jsonArray.map { it.jsonPrimitive.content })
    // The gallery is sent whole, in order, as the console's editor sends it; the preview is not a content field.
    assertEquals(listOf("/api/media/cdn/org:o1/a", "/api/media/cdn/org:o1/b"), update["screenshots"]!!.jsonArray.map { it.jsonPrimitive.content })
    assertNull(update["previewImageUrl"])
    assertEquals(0, calls.seen[3].second["categories"]!!.jsonArray.size)
    assertEquals(0, calls.seen[3].second["screenshots"]!!.jsonArray.size)
    // Each one agrees to the publisher agreement on its own (AGL-4105).
    calls.seen.forEach { assertAgreed(it.second) }
  }

  @Test
  fun thePreviewImageIsSetAndRemovedThroughItsOwnRoute() = runTest {
    val calls = Calls()
    val api = SellerApi(calls.client, "o1")
    api.setPreviewImage("l1", "/api/media/cdn/org:o1/m1", agreed)
    api.setPreviewImage("l1", "", agreed)
    assertEquals(List(2) { "/api/marketplace/preview-image" }, calls.seen.map { it.first })
    assertEquals(listOf("POST", "DELETE"), calls.methods)
    assertEquals(mapOf("listingId" to "l1", "url" to "/api/media/cdn/org:o1/m1"), calls.seen[0].second.filterKeys { it != "agreement" }.mapValues { it.value.jsonPrimitive.content })
    assertEquals(mapOf("listingId" to "l1"), calls.seen[1].second.filterKeys { it != "agreement" }.mapValues { it.value.jsonPrimitive.content })
    calls.seen.forEach { assertAgreed(it.second) }
  }

  @Test
  fun theGalleryHoldsSixDistinctScreenshotsAndAListingReadsItsOwn() {
    var gallery = emptyList<String>()
    repeat(8) { gallery = addingScreenshot("/s/$it", gallery) }
    assertEquals((0 until 6).map { "/s/$it" }, gallery)
    assertEquals(listOf("/s/1"), addingScreenshot("/s/1", listOf("/s/1")))
    val listing = SellerListing.from(FirestoreDoc("l1", "marketplaceListings/l1", mapOf("displayName" to "Hero", "screenshots" to listOf("/a", "/b", 3))))
    assertEquals(listOf("/a", "/b"), listing.screenshots)
  }

  @Test
  fun aListingOrSomeoneElsesReviewIsReportedThroughTheReportRoute() = runTest {
    val calls = Calls()
    val api = MarketplaceApi(calls.client)
    api.report("l1", "  Spam  ")
    api.report("l1", "Abusive", reviewUid = "u2")
    assertEquals(List(2) { "/api/marketplace/report" }, calls.seen.map { it.first })
    assertEquals(mapOf("listingId" to "l1", "reason" to "Spam"), calls.seen[0].second.mapValues { it.value.jsonPrimitive.content })
    assertEquals(mapOf("listingId" to "l1", "reason" to "Abusive", "reviewUid" to "u2"), calls.seen[1].second.mapValues { it.value.jsonPrimitive.content })
    assertEquals(1000, MAX_REPORT_REASON_LENGTH)
  }
}
