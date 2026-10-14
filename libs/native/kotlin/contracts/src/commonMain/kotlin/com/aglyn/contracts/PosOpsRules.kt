package com.aglyn.contracts

import kotlin.math.floor

/*
 * The register's own rules (commerce-pos-ops.ts), ported once and replayed
 * against the console's answers in function-cases.generated.json.
 */

/**
 * Why a PIN cannot be used, or null when it can: 4 to 6 digits, and not one a
 * stranger tries first, every digit the same or a straight run
 * (`posPinProblem`).
 */
fun posPinProblem(pin: String?): String? {
  val value = pin.orEmpty()
  if (!Regex("^\\d{4,6}$").matches(value)) return "A PIN is 4 to 6 digits."
  if (value.all { it == value[0] }) return "Pick a PIN that is not one digit repeated."
  val digits = value.map { it - '0' }
  val step = digits[1] - digits[0]
  if ((step == 1 || step == -1) && digits.withIndex().all { (index, digit) -> index == 0 || digit - digits[index - 1] == step }) {
    return "Pick a PIN that is not a straight run like 1234."
  }
  return null
}

private fun jsRounded(value: Double): Long = if (value.isNaN()) 0L else floor(value + 0.5).toLong()

/** Counted minus expected: positive is over, negative is short (`posCashVarianceCents`). */
fun posCashVarianceCents(countedCashCents: Double, expectedCashCents: Double): Long =
  jsRounded(countedCashCents) - jsRounded(expectedCashCents)

/*
 * The customer display's own checks (commerce-pos.ts), ported once and replayed
 * against the console's answers: what a customer may type on the screen and what
 * a tip may be.
 */

private val DISPLAY_EMAIL = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")

/** An email address as the display may keep it, or "" when it is not one (`posDisplayEmail`). */
fun posDisplayEmail(value: String?): String {
  val email = (value ?: "").trim().lowercase().take(254)
  return if (DISPLAY_EMAIL.matches(email)) email else ""
}

/** A phone number as digits with an optional leading +, or "" when too short or long (`posDisplayPhone`). */
fun posDisplayPhone(value: String?): String {
  val raw = (value ?: "").trim()
  val digits = raw.filter { it in '0'..'9' }
  if (digits.length < 7 || digits.length > 15) return ""
  return (if (raw.startsWith("+")) "+" else "") + digits
}

/** Why a tip cannot be taken on a payment, or null when it can: a whole number of cents, no more than the payment (`posTipProblem`). */
fun posTipProblem(tipCents: Double, amountCents: Double): String? {
  if (!tipCents.isFinite() || tipCents != floor(tipCents) || tipCents < 0) return "Enter a tip of $0 or more."
  val amount = if (amountCents.isFinite()) maxOf(0.0, floor(amountCents + 0.5)) else 0.0
  if (tipCents > amount) return "A tip can be at most the amount being paid. Check the amount and try again."
  return null
}
