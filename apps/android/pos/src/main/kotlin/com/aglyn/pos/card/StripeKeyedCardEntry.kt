package com.aglyn.pos.card

import android.content.Context
import androidx.activity.ComponentActivity
import com.aglyn.hardware.KeyedCardEntry
import com.aglyn.hardware.KeyedCardOutcome
import com.aglyn.hardware.KeyedCardRequest
import com.stripe.android.PaymentConfiguration
import com.stripe.android.paymentsheet.PaymentSheet
import com.stripe.android.paymentsheet.PaymentSheetResult
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/*
 * STRIPE'S CARD FORM, ON THIS DEVICE.
 *
 * A card typed in at the register goes into Stripe's own PaymentSheet: the
 * number is entered in Stripe's fields and goes to Stripe, never through
 * code of ours, which keeps this app's PCI scope where it was. The server
 * has already made the PaymentIntent (`card-keyed`) and records the payment
 * from its own read of Stripe, so what this reports is only how the sheet
 * closed. Aglyn POS alone carries this SDK; the shared register sees only
 * [KeyedCardEntry].
 *
 * The sheet registers for its activity result, which Android allows only
 * before the activity starts, so the activity builds it in `onCreate`
 * ([attach]) and lets go of it in `onDestroy` ([detach]).
 */
internal class StripeKeyedCardEntry(private val context: Context) : KeyedCardEntry {
  @Volatile private var sheet: PaymentSheet? = null
  @Volatile private var pending: CompletableDeferred<PaymentSheetResult>? = null

  fun attach(activity: ComponentActivity) {
    sheet = PaymentSheet.Builder { result -> pending?.complete(result) }.build(activity)
  }

  fun detach() {
    sheet = null
    pending?.cancel()
    pending = null
  }

  override suspend fun collect(request: KeyedCardRequest): KeyedCardOutcome {
    request.problem?.let { return KeyedCardOutcome.Failed(request.paymentIntentId, it) }
    val shown = sheet ?: return KeyedCardOutcome.Failed(request.paymentIntentId, NOT_READY)
    val done = CompletableDeferred<PaymentSheetResult>()
    pending?.cancel()
    pending = done
    withContext(Dispatchers.Main) {
      PaymentConfiguration.init(context, request.publishableKey)
      shown.presentWithPaymentIntent(
        request.clientSecret,
        // A card typed in for one sale: no Link account, no saved cards (no `customer`), no Google Pay (no `googlePay`).
        PaymentSheet.Configuration.Builder(request.merchantName)
          .allowsDelayedPaymentMethods(false)
          .link(PaymentSheet.LinkConfiguration(PaymentSheet.LinkConfiguration.Display.Never))
          .build(),
      )
    }
    val result = try {
      done.await()
    } finally {
      if (pending === done) pending = null
    }
    return keyedCardOutcome(result, request.paymentIntentId)
  }

  companion object {
    const val NOT_READY = "The card form is not ready. Close this payment and try again."
  }
}

/** How the sheet closed, in the register's three words. */
internal fun keyedCardOutcome(result: PaymentSheetResult, paymentIntentId: String): KeyedCardOutcome = when (result) {
  is PaymentSheetResult.Completed -> KeyedCardOutcome.Confirmed(paymentIntentId)
  is PaymentSheetResult.Canceled -> KeyedCardOutcome.Canceled(paymentIntentId)
  is PaymentSheetResult.Failed -> KeyedCardOutcome.Failed(paymentIntentId, result.error.message?.takeIf { it.isNotBlank() } ?: "The card was not accepted.")
}
