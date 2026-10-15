package com.aglyn.pos.card

import com.aglyn.hardware.KeyedCardOutcome
import com.stripe.android.paymentsheet.PaymentSheetResult
import org.junit.Assert.assertEquals
import org.junit.Test

/** How Stripe's sheet closing becomes the register's three words; the sheet itself is Stripe's. */
class KeyedCardOutcomeTest {
  // The SDK hides its results' constructors from Kotlin (it hands them out itself); the bytecode has plain ones.
  private val completed = PaymentSheetResult.Completed::class.java.getConstructor().newInstance()
  private val canceled = PaymentSheetResult.Canceled::class.java.getConstructor().newInstance()

  private fun failed(error: Throwable) = PaymentSheetResult.Failed::class.java.getConstructor(Throwable::class.java).newInstance(error)

  @Test
  fun aPaidSheetIsConfirmedAndTheServerStillReadsStripe() {
    assertEquals(KeyedCardOutcome.Confirmed("pi_1"), keyedCardOutcome(completed, "pi_1"))
  }

  @Test
  fun aClosedSheetIsCanceled() {
    assertEquals(KeyedCardOutcome.Canceled("pi_1"), keyedCardOutcome(canceled, "pi_1"))
  }

  @Test
  fun aFailedSheetCarriesStripesWords() {
    val outcome = keyedCardOutcome(failed(IllegalStateException("Your card was declined.")), "pi_1")
    assertEquals(KeyedCardOutcome.Failed("pi_1", "Your card was declined."), outcome)
  }

  @Test
  fun aFailureWithNoWordsGetsOurs() {
    val outcome = keyedCardOutcome(failed(RuntimeException()), "pi_1")
    assertEquals(KeyedCardOutcome.Failed("pi_1", "The card was not accepted."), outcome)
  }
}
