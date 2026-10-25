package com.aglyn.pos.terminal

import com.aglyn.hardware.OfflineCardForward
import com.aglyn.hardware.OfflineCardRequest
import com.aglyn.hardware.OfflineTerminalIntent
import com.aglyn.hardware.OfflineTerminalPort
import com.aglyn.hardware.OfflineTerminalResult
import com.aglyn.hardware.TerminalError
import com.aglyn.hardware.offlineCardRequiresOnline
import com.aglyn.hardware.offlineForwardStatus
import com.stripe.stripeterminal.Terminal
import com.stripe.stripeterminal.external.callable.Cancelable
import com.stripe.stripeterminal.external.callable.PaymentIntentCallback
import com.stripe.stripeterminal.external.models.CaptureMethod
import com.stripe.stripeterminal.external.models.CollectPaymentIntentConfiguration
import com.stripe.stripeterminal.external.models.CreateConfiguration
import com.stripe.stripeterminal.external.models.OfflineBehavior
import com.stripe.stripeterminal.external.models.PaymentIntent
import com.stripe.stripeterminal.external.models.PaymentIntentParameters
import com.stripe.stripeterminal.external.models.TerminalException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * The offline card sequence's three calls on the Stripe Terminal SDK
 * (AGL-4039). The app creates the intent itself: a destination charge with
 * manual capture and no application fee, named by the sale's key in its
 * metadata. Offline, the SDK stores it on the device and forwards it later.
 */
internal class SdkOfflinePort(
  private val terminal: Terminal,
  /** The in-flight collect or confirm, so the register's Cancel can stop it. */
  private val onCancelable: (Cancelable?) -> Unit,
) : OfflineTerminalPort {
  private var intent: PaymentIntent? = null

  override suspend fun create(request: OfflineCardRequest): OfflineTerminalResult {
    val params = PaymentIntentParameters.Builder()
      .setAmount(request.amountCents)
      .setCurrency(request.currency)
      .setCaptureMethod(CaptureMethod.Manual)
      .setTransferDataDestination(request.destination)
      .setMetadata(request.metadata)
      .build()
    // The store's limits once more at the SDK: above them the card must be taken online.
    val held = terminal.offlineStatus.sdk.offlinePaymentAmountsByCurrency[request.currency] ?: 0L
    val behavior = if (offlineCardRequiresOnline(request, held)) OfflineBehavior.REQUIRE_ONLINE else OfflineBehavior.PREFER_ONLINE
    return call { callback ->
      terminal.createPaymentIntent(params, callback, CreateConfiguration(behavior))
      null
    }
  }

  override suspend fun collect(saleKey: String): OfflineTerminalResult {
    val current = intent ?: return missing()
    val config = CollectPaymentIntentConfiguration.Builder().skipTipping(true).build()
    return call { callback -> terminal.collectPaymentMethod(current, callback, config) }
  }

  override suspend fun confirm(saleKey: String): OfflineTerminalResult {
    val current = intent ?: return missing()
    return call { callback -> terminal.confirmPaymentIntent(current, callback) }
  }

  private suspend fun call(start: (PaymentIntentCallback) -> Cancelable?): OfflineTerminalResult = try {
    suspendCancellableCoroutine { done ->
      val cancelable = start(object : PaymentIntentCallback {
        override fun onSuccess(paymentIntent: PaymentIntent) {
          intent = paymentIntent
          if (done.isActive) done.resume(OfflineTerminalResult.Ok(paymentIntent.asOfflineIntent()))
        }

        override fun onFailure(e: TerminalException) {
          e.paymentIntent?.let { intent = it }
          if (done.isActive) done.resume(OfflineTerminalResult.Error(e.asTerminalError()))
        }
      })
      onCancelable(cancelable)
    }
  } finally {
    onCancelable(null)
  }

  private fun missing() = OfflineTerminalResult.Error(TerminalError("UNEXPECTED_SDK_ERROR", "The card payment was not started on the reader."))
}

internal fun PaymentIntent.asOfflineIntent(): OfflineTerminalIntent {
  val present = paymentMethod?.cardPresentDetails
  val stored = offlineDetails?.cardPresentDetails
  return OfflineTerminalIntent(
    id = id,
    status = status?.name?.lowercase().orEmpty(),
    amountCents = amount,
    storedOffline = offlineDetails?.requiresUpload == true,
    saleKey = metadata?.get("saleKey"),
    brand = present?.brand ?: stored?.brand,
    last4 = present?.last4 ?: stored?.last4,
  )
}

/** What the SDK's forward of a stored card became, for the register's ledger; null when it names no sale. */
internal fun PaymentIntent.asOfflineForward(error: TerminalException?): OfflineCardForward? {
  val saleKey = metadata?.get("saleKey")?.takeIf { it.isNotEmpty() } ?: return null
  val shown = asOfflineIntent()
  val status = if (error == null) shown.status else "requires_payment_method"
  return OfflineCardForward(
    saleKey = saleKey,
    paymentIntentId = id,
    status = offlineForwardStatus(id, if (id == null) null else status),
    message = error?.let { it.apiError?.message ?: it.errorMessage },
    brand = shown.brand,
    last4 = shown.last4,
  )
}
