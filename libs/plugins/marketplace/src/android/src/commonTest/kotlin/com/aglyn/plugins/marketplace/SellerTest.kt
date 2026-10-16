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
    val client = ConsoleApiClient(
      origin = "https://console.test/",
      http = HttpClient(
        MockEngine { request ->
          val text = (request.body as? OutgoingContent.ByteArrayContent)?.bytes()?.decodeToString().orEmpty()
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

  @Test
  fun theProfileIsSavedThroughTheRouteWithTheOrganization() = runTest {
    val calls = Calls()
    SellerApi(calls.client, "o1").saveProfile(mapOf("handle" to "studio", "displayName" to "Studio", "bio" to ""))
    val (path, body) = calls.seen.single()
    assertEquals("/api/marketplace/publisher-profile", path)
    assertEquals(mapOf("orgId" to "o1", "handle" to "studio", "displayName" to "Studio", "bio" to ""), body.mapValues { it.value.jsonPrimitive.content })
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
    api.setVisibility("l1", "private")
    api.setPublished("l1", published = false)
    api.updateListing("l1", mapOf("displayName" to "Hero", "description" to "A hero", "readme" to "About it", "homepageUrl" to "https://x.test"), "Marketing")
    api.updateListing("l1", mapOf("displayName" to "Hero"), "")
    assertEquals(List(4) { "/api/marketplace/publish-plugin" }, calls.seen.map { it.first })
    assertEquals(mapOf("action" to "set-visibility", "listingId" to "l1", "visibility" to "private"), calls.seen[0].second.mapValues { it.value.jsonPrimitive.content })
    assertEquals(mapOf("action" to "set-published", "listingId" to "l1", "published" to "false"), calls.seen[1].second.mapValues { it.value.jsonPrimitive.content })
    val update = calls.seen[2].second
    assertEquals("update-listing", update["action"]?.jsonPrimitive?.content)
    assertEquals(listOf("Marketing"), update["categories"]!!.jsonArray.map { it.jsonPrimitive.content })
    // The screenshots and the preview are not sent, so they are left as they are.
    assertNull(update["screenshots"])
    assertEquals(0, calls.seen[3].second["categories"]!!.jsonArray.size)
  }
}
