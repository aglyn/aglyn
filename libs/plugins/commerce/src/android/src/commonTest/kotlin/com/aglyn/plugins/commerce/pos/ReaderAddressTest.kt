package com.aglyn.plugins.commerce.pos

import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The store's reader address on its own, and payments setup, on the readers screen. */
class ReaderAddressTest {
  private val jsonHeaders = headersOf(HttpHeaders.ContentType, "application/json")
  private val address = ReaderAddress("100 Main St", "Austin", "TX", "78701", "us")

  /** Answers each request with the next of [answers] (status to body), recording what was sent. */
  private fun api(seen: MutableList<JsonObject>, vararg answers: Pair<HttpStatusCode, String>): ConsoleApiClient {
    var next = 0
    val engine = MockEngine { request ->
      seen += Json.parseToJsonElement(request.body.toByteArray().decodeToString()).jsonObject
      val (status, body) = answers[minOf(next++, answers.lastIndex)]
      respond(body, status, jsonHeaders)
    }
    return ConsoleApiClient("https://console.test", HttpClient(engine), { "token" }, maxAttempts = 1)
  }

  @Test
  fun aMissingAddressOffersTheFormOnlyToWhoeverMaySetUpTheStoresDevices() {
    assertTrue(offersReaderAddress(locationReady = false, maySetUpDevices = true))
    assertFalse(offersReaderAddress(locationReady = false, maySetUpDevices = false))
    assertFalse(offersReaderAddress(locationReady = true, maySetUpDevices = true))
    assertEquals("posDevices", READER_ADDRESS_PERMISSION)
  }

  @Test
  fun theAddressIsCheckedAsThePairingChecksIt() {
    assertNull(checkReaderAddress(address))
    assertEquals("Enter the street, city and postal code.", checkReaderAddress(address.copy(postalCode = " ")))
    assertEquals("Enter the two-letter country code, such as US.", checkReaderAddress(address.copy(country = "USA")))
    assertEquals(checkReaderAddress(address.copy(city = "")), checkReaderPairing("sepia-cerulean-aqua", address.copy(city = "")))
  }

  @Test
  fun savingTheAddressGivesTheStoreItsLocationAndTheRowTurnsReady() = runTest {
    val seen = mutableListOf<JsonObject>()
    val connection = CommerceTerminalConnection(
      api(
        seen,
        HttpStatusCode.OK to """{"locationId":"tml_1"}""",
        HttpStatusCode.OK to """{"available":true,"testMode":true,"merchantReady":true,"locationReady":true}""",
      ),
    )
    assertEquals("tml_1", connection.registerLocation("h1", address))
    assertTrue(connection.readiness("h1").locationReady)
    val sent = seen.first()
    assertEquals("location", sent.getValue("action").jsonPrimitive.content)
    assertEquals("h1", sent.getValue("hostId").jsonPrimitive.content)
    val body = sent.getValue("address").jsonObject
    assertEquals("100 Main St", body.getValue("line1").jsonPrimitive.content)
    assertEquals("US", body.getValue("country").jsonPrimitive.content)
  }

  @Test
  fun aRefusedSaveShowsTheServersOwnWords() = runTest {
    val connection = CommerceTerminalConnection(
      api(mutableListOf(), HttpStatusCode.BadRequest to """{"error":"Stripe could not use that address."}"""),
    )
    val refused = assertFailsWith<ConsoleApiError> { connection.registerLocation("h1", address) }
    assertEquals("Stripe could not use that address.", setupFailureMessage(refused))
    assertEquals("That did not go through. Check the connection and try again.", setupFailureMessage(ConsoleApiError("offline", 0, null)))
  }

  @Test
  fun setUpPaymentsOpensOnlyStripesSecurePage() = runTest {
    val seen = mutableListOf<JsonObject>()
    val page = PaymentsSetupApi(
      api(seen, HttpStatusCode.OK to """{"accountId":"acct_1","chargesEnabled":false,"url":"https://connect.stripe.com/setup/e/acct_1/abc"}"""),
      "h1",
    ).setupPage()
    assertEquals("https://connect.stripe.com/setup/e/acct_1/abc", page)
    assertEquals("h1", seen.single().getValue("hostId").jsonPrimitive.content)
    assertNull(PaymentsSetupApi(api(mutableListOf(), HttpStatusCode.OK to """{"chargesEnabled":true}"""), "h1").setupPage())
    assertNull(PaymentsSetupApi(api(mutableListOf(), HttpStatusCode.OK to """{"url":"http://example.test/x"}"""), "h1").setupPage())
  }

  /** This device's reader controls, recording when the store's setup is said to have changed. */
  private class RecordingControls : com.aglyn.hardware.DeviceReaderControls by com.aglyn.hardware.NoDeviceReaderControls {
    val changed = mutableListOf<String>()

    override suspend fun storeSetupChanged(hostId: String, sessions: com.aglyn.hardware.CardReaderSessionSource) {
      changed += hostId
    }
  }

  private val noSessions = com.aglyn.hardware.CardReaderSessionSource { error("no session in this test") }

  @Test
  fun aSavedAddressHasThisDevicesReaderReadTheStoreAgain() = runTest {
    val controls = RecordingControls()
    val saved = mutableListOf<ReaderAddress>()
    saveReaderAddress(address, { saved += it }, controls, "h1", noSessions)
    assertEquals(listOf(address), saved)
    assertEquals(listOf("h1"), controls.changed)
  }

  @Test
  fun anAddressThatWasNotSavedLeavesTheReaderAsItWas() = runTest {
    val controls = RecordingControls()
    assertFailsWith<ConsoleApiError> {
      saveReaderAddress(address, { throw refused("Enter the street.") }, controls, "h1", noSessions)
    }
    assertEquals(emptyList(), controls.changed)
  }
}
