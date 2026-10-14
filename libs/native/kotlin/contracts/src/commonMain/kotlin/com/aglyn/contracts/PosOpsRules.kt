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
