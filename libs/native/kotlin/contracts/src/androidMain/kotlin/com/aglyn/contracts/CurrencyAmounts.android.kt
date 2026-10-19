package com.aglyn.contracts

import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

actual fun formatCurrencyFieldValue(minor: Double, code: String): String {
  val digits = currencyFractionDigits(code)
  val major = currencyMinorToMajor(minor, code)
  return runCatching {
    NumberFormat.getCurrencyInstance(Locale.getDefault()).apply {
      currency = Currency.getInstance(code.uppercase())
      minimumFractionDigits = digits
      maximumFractionDigits = digits
    }.format(major)
  }.getOrElse { "${currencyInputText(minor, code)} ${code.uppercase()}" }
}
