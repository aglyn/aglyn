package com.aglyn.hardware

/**
 * Tells a keyboard-wedge barcode scanner from a person typing. A HID scanner
 * "types" the whole code in a burst, a few milliseconds a key, and ends it
 * with Enter (or Tab); a person types far slower. Keys that arrive within
 * [maxGapMs] of each other build a burst; a slower key starts over, so typing
 * into the search field never reads as a scan.
 *
 * Feed it every printable key and every terminator with the time it arrived.
 * [onTerminator] answers the scanned code when the burst qualifies, and the
 * register then looks the code up instead of searching. Scanners set to send
 * no terminator are caught by [flush] once the burst goes quiet.
 */
class HidBurstDetector(
  private val maxGapMs: Long = 50,
  private val minLength: Int = 4,
  private val maxLength: Int = 64,
) {
  private val buffer = StringBuilder()
  private var lastAtMs = 0L

  /** The characters of the burst in progress, which the screen keeps out of a text field. */
  val pending: String get() = buffer.toString()

  /** A printable key. True while it belongs to a burst that could be a scan. */
  fun onCharacter(char: Char, atMs: Long): Boolean {
    if (buffer.isNotEmpty() && atMs - lastAtMs > maxGapMs) buffer.clear()
    if (buffer.length >= maxLength) buffer.clear()
    buffer.append(char)
    lastAtMs = atMs
    return buffer.length > 1
  }

  /** Enter or Tab: the scanned code, or null when what came before was typed. */
  fun onTerminator(atMs: Long): String? {
    val code = buffer.toString()
    val fast = code.isNotEmpty() && atMs - lastAtMs <= maxGapMs
    buffer.clear()
    return if (fast && code.length >= minLength) code else null
  }

  /** A burst that went quiet with no terminator: the code, once, or null. */
  fun flush(atMs: Long): String? {
    if (buffer.isEmpty() || atMs - lastAtMs <= maxGapMs) return null
    val code = buffer.toString()
    buffer.clear()
    return if (code.length >= minLength) code else null
  }

  fun reset() {
    buffer.clear()
  }
}
