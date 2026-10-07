package com.aglyn.pos.terminal

import com.aglyn.hardware.TerminalError
import com.aglyn.hardware.TerminalIntent
import com.aglyn.hardware.TerminalPaymentPort
import com.aglyn.hardware.TerminalResult
import com.stripe.stripeterminal.Terminal
import com.stripe.stripeterminal.external.callable.Cancelable
import com.stripe.stripeterminal.external.callable.PaymentIntentCallback
import com.stripe.stripeterminal.external.models.CollectPaymentIntentConfiguration
import com.stripe.stripeterminal.external.models.CustomerCancellation
import com.stripe.stripeterminal.external.models.PaymentIntent
import com.stripe.stripeterminal.external.models.TerminalException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * The shared collect sequence's three calls on the Stripe Terminal SDK. The
 * SDK hands back its own PaymentIntent object, which the next call needs, so
 * the port keeps the last one it saw; the sequence only ever names its id.
 */
internal class SdkPaymentPort(
  private val terminal: Terminal,
  /** The in-flight collect or confirm, so the register's Cancel can stop it. */
  private val onCancelable: (Cancelable?) -> Unit,
) : TerminalPaymentPort {
  private var intent: PaymentIntent? = null

  override suspend fun retrieve(clientSecret: String): TerminalResult = call { callback ->
    terminal.retrievePaymentIntent(clientSecret, callback)
    null
  }

  override suspend fun collect(intentId: String, skipTipping: Boolean): TerminalResult {
    val current = intent?.takeIf { it.id == intentId } ?: return missing(intentId)
    val config = CollectPaymentIntentConfiguration.Builder()
      .skipTipping(skipTipping)
      .setCustomerCancellation(CustomerCancellation.ENABLE_IF_AVAILABLE)
      .build()
    return call { callback -> terminal.collectPaymentMethod(current, callback, config) }
  }

  override suspend fun confirm(intentId: String): TerminalResult {
    val current = intent?.takeIf { it.id == intentId } ?: return missing(intentId)
    return call { callback -> terminal.confirmPaymentIntent(current, callback) }
  }

  private suspend fun call(start: (PaymentIntentCallback) -> Cancelable?): TerminalResult = try {
    suspendCancellableCoroutine { done ->
      val cancelable = start(object : PaymentIntentCallback {
        override fun onSuccess(paymentIntent: PaymentIntent) {
          intent = paymentIntent
          if (done.isActive) done.resume(TerminalResult.Ok(paymentIntent.asTerminalIntent()))
        }

        override fun onFailure(e: TerminalException) {
          e.paymentIntent?.let { intent = it }
          if (done.isActive) done.resume(TerminalResult.Error(e.asTerminalError()))
        }
      })
      onCancelable(cancelable)
    }
  } finally {
    onCancelable(null)
  }

  private fun missing(id: String) = TerminalResult.Error(TerminalError("UNEXPECTED_SDK_ERROR", "The payment $id was not loaded on the reader."))
}

internal fun PaymentIntent.asTerminalIntent() = TerminalIntent(
  id = id.orEmpty(),
  status = status?.name?.lowercase().orEmpty(),
  amountCents = amount,
  tipCents = amountDetails?.tip?.amount ?: amountTip ?: 0,
)

internal fun TerminalException.asTerminalError() = TerminalError(
  code = errorCode.name,
  message = errorMessage,
  declineCode = apiError?.declineCode,
  apiMessage = apiError?.message,
  intent = paymentIntent?.asTerminalIntent(),
)
