package com.aglyn.hardware

/*
 * A CARD TYPED IN AT THE REGISTER.
 *
 * The console's "Type card" puts the card into Stripe's own Payment Element:
 * the number never touches the register, the server made the PaymentIntent and
 * records the payment from Stripe, never from the form's say-so. This is the
 * same split on the device. The server has already made a `card_keyed`
 * PaymentIntent (`card-keyed`); an entry's only job is to show Stripe's own
 * card form for that intent and report how it ended. The Stripe card SDK that
 * draws the form lives in the Aglyn POS Android app alone and implements
 * [KeyedCardEntry]; this kit, the commerce plugin and the Aglyn app never
 * link it, which keeps the card number out of every other part of the code and
 * out of this project's PCI scope.
 *
 * So an entry never creates, prices or captures money, and what it reports is
 * a hint the server re-reads. Every outcome is one of three: confirmed (Stripe
 * took the card; the server decides what that means), canceled (nobody was
 * charged; the amount is released) or failed (with words to read out). The
 * Apple kit's `KeyedCardEntry` is the same contract.
 */

data class KeyedCardRequest(
  val paymentIntentId: String,
  val clientSecret: String,
  /** The site's Stripe publishable key, which the register's context supplies (the console loads Stripe with the same one). */
  val publishableKey: String,
  /** What the register shows the customer, tip included. */
  val amountCents: Long,
  /** The business name the card form carries. */
  val merchantName: String,
) {
  /**
   * Null when the request is well formed. The client secret names its own
   * intent, and one for a different intent is refused, so nothing can ask to
   * take A while the register records B.
   */
  val problem: String?
    get() = when {
      !publishableKey.startsWith("pk_") -> "Card entry is not set up for this site."
      amountCents <= 0 -> "There is nothing to charge."
      else -> collectRequestProblem(paymentIntentId, clientSecret)
    }
}

sealed interface KeyedCardOutcome {
  val paymentIntentId: String

  data class Confirmed(override val paymentIntentId: String) : KeyedCardOutcome

  data class Canceled(override val paymentIntentId: String) : KeyedCardOutcome

  data class Failed(override val paymentIntentId: String, val message: String) : KeyedCardOutcome
}

/**
 * Stripe's own card form, on this device. The Aglyn POS app binds the one that
 * carries the SDK; a platform without it leaves [Peripherals.keyedCardEntry]
 * null and the register does not offer "Type card".
 */
interface KeyedCardEntry {
  /** Shows the form for one server-made intent and returns when it closes. Validates [request] first. */
  suspend fun collect(request: KeyedCardRequest): KeyedCardOutcome
}
