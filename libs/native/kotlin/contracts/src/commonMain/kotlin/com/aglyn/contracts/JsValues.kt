package com.aglyn.contracts

import kotlin.math.abs
import kotlin.math.floor

/*
 * JavaScript's value conversions, as the console's pure modules lean on them:
 * `Number(value)`, `String(value)` and a number's own `toString()`. A port of
 * a TypeScript rule that converts a value has to convert it the same way, or
 * `"41" + 1` and `round(1.005, 2)` answer differently on the phone than in the
 * browser. Values are plain Kotlin: Double (every number), String, Boolean,
 * null; a Long or an Int reads as the Double it holds.
 */

private val JS_DECIMAL = Regex("^[+-]?(?:[0-9]+\\.?[0-9]*|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?$")
private val JS_HEX = Regex("^0[xX][0-9a-fA-F]+$")
private val JS_OCTAL = Regex("^0[oO][0-7]+$")
private val JS_BINARY = Regex("^0[bB][01]+$")

/** JavaScript's white space and line terminators, which `Number("…")` trims. */
private fun isJsSpace(c: Char): Boolean =
  c.isWhitespace() || c == '﻿' || c == ' ' || c == ' ' || c == ' '

/** `Number(text)`: JavaScript's StringToNumber. */
fun jsStringToNumber(text: String): Double {
  val trimmed = text.trim(::isJsSpace)
  if (trimmed.isEmpty()) return 0.0
  return when {
    trimmed == "Infinity" || trimmed == "+Infinity" -> Double.POSITIVE_INFINITY
    trimmed == "-Infinity" -> Double.NEGATIVE_INFINITY
    JS_DECIMAL.matches(trimmed) -> trimmed.toDouble()
    JS_HEX.matches(trimmed) -> radix(trimmed.substring(2), 16)
    JS_OCTAL.matches(trimmed) -> radix(trimmed.substring(2), 8)
    JS_BINARY.matches(trimmed) -> radix(trimmed.substring(2), 2)
    else -> Double.NaN
  }
}

private fun radix(digits: String, base: Int): Double =
  digits.fold(0.0) { total, c -> total * base + c.digitToInt(base) }

/**
 * `Number(value)`. A null reads as JavaScript's `null` (0); a value that is
 * not a number, a text or a true/false is NaN.
 */
fun jsNumber(value: Any?): Double = when (value) {
  null -> 0.0
  is Double -> value
  is Number -> value.toDouble()
  is Boolean -> if (value) 1.0 else 0.0
  is String -> jsStringToNumber(value)
  else -> Double.NaN
}

/** `String(value)`. */
fun jsString(value: Any?): String = when (value) {
  null -> "null"
  is String -> value
  is Boolean -> value.toString()
  is Double -> jsNumberString(value)
  is Number -> jsNumberString(value.toDouble())
  else -> value.toString()
}

/** The decimal digits of [value] (no zeros at either end) and where the point sits: value = 0.d1d2… × 10^point. */
internal fun decimalDigits(value: Double): Pair<String, Int> {
  val text = abs(value).toString()
  val (mantissa, exponent) = text.uppercase().split('E').let { it[0] to (it.getOrNull(1)?.toInt() ?: 0) }
  val dot = mantissa.indexOf('.')
  val whole = if (dot < 0) mantissa else mantissa.substring(0, dot)
  val fraction = if (dot < 0) "" else mantissa.substring(dot + 1)
  var digits = whole + fraction
  var point = whole.length + exponent
  val leading = digits.indexOfFirst { it != '0' }
  if (leading < 0) return "0" to 1
  digits = digits.substring(leading)
  point -= leading
  digits = digits.trimEnd('0')
  return digits to point
}

/** A number's own `toString()`, as JavaScript writes it. */
fun jsNumberString(value: Double): String {
  if (value.isNaN()) return "NaN"
  if (value.isInfinite()) return if (value > 0) "Infinity" else "-Infinity"
  if (value == 0.0) return "0"
  val sign = if (value < 0) "-" else ""
  val (digits, n) = decimalDigits(value)
  val k = digits.length
  val body = when {
    n in k..21 -> digits + "0".repeat(n - k)
    n in 1..21 -> digits.substring(0, n) + "." + digits.substring(n)
    n in -5..0 -> "0." + "0".repeat(-n) + digits
    else -> {
      val exponent = n - 1
      val mantissa = if (k == 1) digits else digits[0] + "." + digits.substring(1)
      mantissa + "e" + (if (exponent >= 0) "+" else "-") + abs(exponent)
    }
  }
  return sign + body
}

/** `Math.round`: half toward +∞. */
fun jsMathRound(value: Double): Double {
  if (value.isNaN() || value.isInfinite()) return value
  val down = floor(value)
  return if (value - down >= 0.5) down + 1 else down
}

/** `===` between two plain values. */
fun jsStrictEquals(left: Any?, right: Any?): Boolean = when {
  left is Number && right is Number -> left.toDouble() == right.toDouble()
  left is String && right is String -> left == right
  left is Boolean && right is Boolean -> left == right
  else -> left == null && right == null
}

/**
 * A JavaScript object's key order: integer-like keys first, ascending, then
 * the rest in the order they were first set. What `Object.values` and
 * `Object.entries` walk.
 */
fun <V> jsObjectOrder(map: Map<String, V>): List<Pair<String, V>> {
  val index = Regex("^(0|[1-9][0-9]*)$")
  val (numeric, named) = map.entries.partition { (key, _) ->
    index.matches(key) && (key.toLongOrNull()?.let { it < 4_294_967_295L } == true)
  }
  return numeric.sortedBy { it.key.toLong() }.map { it.key to it.value } + named.map { it.key to it.value }
}

/**
 * `value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })`:
 * comma thousands, a dot, exactly [digits] decimals, rounded half away from zero.
 */
fun formatEnUs(value: Double, digits: Int): String {
  if (value.isNaN()) return "NaN"
  if (value.isInfinite()) return if (value > 0) "∞" else "-∞"
  val negative = value < 0 || (value == 0.0 && 1.0 / value < 0)
  val (raw, point) = if (value == 0.0) "0" to 1 else decimalDigits(value)
  // Digits as integer part and fraction, padded so the point sits inside them.
  val padded = if (point <= 0) "0".repeat(1 - point) + raw else raw
  val pointAt = if (point <= 0) 1 else point
  val full = if (padded.length < pointAt) padded + "0".repeat(pointAt - padded.length) else padded
  var integer = full.substring(0, pointAt)
  var fraction = full.substring(pointAt)
  if (fraction.length > digits) {
    val roundUp = fraction[digits] >= '5'
    fraction = fraction.substring(0, digits)
    if (roundUp) {
      val joined = (integer + fraction).toCharArray()
      var i = joined.size - 1
      var carry = true
      while (carry && i >= 0) {
        if (joined[i] == '9') { joined[i] = '0'; i-- } else { joined[i] = joined[i] + 1; carry = false }
      }
      val text = (if (carry) "1" else "") + joined.concatToString()
      integer = text.substring(0, text.length - digits)
      fraction = text.substring(text.length - digits)
    }
  } else {
    fraction += "0".repeat(digits - fraction.length)
  }
  integer = integer.trimStart('0').ifEmpty { "0" }
  val grouped = integer.reversed().chunked(3).joinToString(",").reversed()
  return (if (negative) "-" else "") + grouped + (if (digits > 0) ".$fraction" else "")
}
