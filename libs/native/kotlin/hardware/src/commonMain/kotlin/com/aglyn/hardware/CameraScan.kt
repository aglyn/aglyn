package com.aglyn.hardware

/**
 * Turns a camera's stream of barcode reads into scans. A camera reads the
 * same barcode many times a second while it stays in view, so a code counts
 * once and counts again only after it has been out of view for
 * [repeatAfterMs] (the cashier scanning a second of the same item). Codes
 * outside the length a product barcode or SKU can have are noise.
 */
class CameraScanFilter(
  private val repeatAfterMs: Long = 1_500,
  private val minLength: Int = 4,
  private val maxLength: Int = 64,
) {
  private var lastCode: String? = null
  private var lastSeenMs = 0L

  /** The code to act on, or null when [raw] is noise or the same barcode still in view. */
  fun accept(raw: String?, atMs: Long): String? {
    val code = raw?.trim()?.takeIf { it.length in minLength..maxLength && it.none(Char::isISOControl) } ?: return null
    val repeat = code == lastCode && atMs - lastSeenMs < repeatAfterMs
    lastCode = code
    lastSeenMs = atMs
    return if (repeat) null else code
  }

  fun reset() {
    lastCode = null
  }
}
