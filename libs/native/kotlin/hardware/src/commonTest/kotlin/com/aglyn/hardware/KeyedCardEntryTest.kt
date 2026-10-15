package com.aglyn.hardware

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class KeyedCardEntryTest {
  private val intent = "pi_3Q1x2yZabcDEFghi"

  private fun request(
    id: String = intent,
    secret: String = "${intent}_secret_AbCdEfGh12345678",
    key: String = "pk_test_51Habc",
    cents: Long = 1_250,
  ) = KeyedCardRequest(id, secret, key, cents, "Aglyn POS")

  @Test
  fun aWellFormedRequestHasNoProblem() {
    assertNull(request().problem)
  }

  @Test
  fun aSecretThatNamesAnotherIntentIsRefused() {
    assertNotNull(request(secret = "pi_3Q9other0000000_secret_AbCdEfGh12345678").problem)
  }

  @Test
  fun aMissingOrMalformedIntentIsRefused() {
    assertNotNull(request(id = "").problem)
    assertNotNull(request(id = "cs_123").problem)
  }

  @Test
  fun aKeyThatIsNotAPublishableKeyIsRefused() {
    assertEquals("Card entry is not set up for this site.", request(key = "").problem)
    assertEquals("Card entry is not set up for this site.", request(key = "sk_live_123").problem)
  }

  @Test
  fun nothingToChargeIsRefused() {
    assertEquals("There is nothing to charge.", request(cents = 0).problem)
  }

  @Test
  fun aRegisterHasNoCardFormUntilTheAppBindsOne() {
    assertNull(NoPeripherals.keyedCardEntry)
    val entry = object : KeyedCardEntry {
      override suspend fun collect(request: KeyedCardRequest): KeyedCardOutcome = KeyedCardOutcome.Canceled(request.paymentIntentId)
    }
    assertEquals(entry, StaticPeripherals(keyedCardEntry = entry).keyedCardEntry)
  }

  @Test
  fun anOutcomeNamesItsIntent() {
    assertEquals(intent, KeyedCardOutcome.Confirmed(intent).paymentIntentId)
    assertEquals(intent, KeyedCardOutcome.Canceled(intent).paymentIntentId)
    assertEquals(intent, KeyedCardOutcome.Failed(intent, "No").paymentIntentId)
  }
}
