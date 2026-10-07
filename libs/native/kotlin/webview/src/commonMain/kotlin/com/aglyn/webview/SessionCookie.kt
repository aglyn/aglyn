package com.aglyn.webview

/** A cookie the session route set, as a web view's cookie store takes it. */
data class SessionCookie(
  val name: String,
  val value: String,
  /** The host the cookie belongs to: its `Domain` attribute, else the console's own host. */
  val domain: String,
  val path: String,
  val httpOnly: Boolean,
  val secure: Boolean,
  /** `None`, `Lax` or `Strict`; null when the header names none. */
  val sameSite: String?,
  /** Seconds since the epoch; null for a session cookie. */
  val expiresEpochSeconds: Double?,
)

/**
 * One `Set-Cookie` header from `/api/auth/session`, for a web view whose
 * cookie store takes fields rather than a header (WebView2). Max-Age wins
 * over Expires, as browsers apply them. Null for a header with no name.
 */
fun parseSetCookie(header: String, originHost: String, nowEpochSeconds: Double): SessionCookie? {
  val parts = header.split(';').map { it.trim() }
  val pair = parts.firstOrNull()?.takeIf { '=' in it } ?: return null
  val name = pair.substringBefore('=').trim().ifEmpty { return null }
  val value = pair.substringAfter('=').trim().removeSurrounding("\"")
  var domain = originHost
  var path = "/"
  var httpOnly = false
  var secure = false
  var sameSite: String? = null
  var maxAge: Double? = null
  var expires: Double? = null
  for (attribute in parts.drop(1)) {
    val key = attribute.substringBefore('=').trim().lowercase()
    val raw = if ('=' in attribute) attribute.substringAfter('=').trim() else ""
    when (key) {
      "domain" -> raw.removePrefix(".").ifEmpty { null }?.let { domain = it.lowercase() }
      "path" -> raw.ifEmpty { null }?.let { path = it }
      "httponly" -> httpOnly = true
      "secure" -> secure = true
      "samesite" -> sameSite = when (raw.lowercase()) { "none" -> "None"; "lax" -> "Lax"; "strict" -> "Strict"; else -> null }
      "max-age" -> maxAge = raw.toLongOrNull()?.let { nowEpochSeconds + it }
      "expires" -> expires = parseHttpDate(raw)
    }
  }
  return SessionCookie(name, value, domain, path, httpOnly, secure, sameSite, maxAge ?: expires)
}

private val MONTHS = listOf("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")

/** An IMF-fixdate (`Wed, 21 Oct 2026 07:28:00 GMT`) as epoch seconds, or null. */
internal fun parseHttpDate(text: String): Double? {
  val match = Regex("""^\w{3},\s*(\d{1,2})[ -](\w{3})[ -](\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s*GMT$""", RegexOption.IGNORE_CASE)
    .matchEntire(text.trim()) ?: return null
  val (day, monthName, year, hour, minute, second) = match.destructured
  val month = MONTHS.indexOf(monthName.lowercase()).takeIf { it >= 0 } ?: return null
  return (daysFromCivil(year.toLong(), month + 1L, day.toLong()) * 86_400 + hour.toLong() * 3_600 + minute.toLong() * 60 + second.toLong()).toDouble()
}

/** Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's algorithm). */
private fun daysFromCivil(year: Long, month: Long, day: Long): Long {
  val y = if (month <= 2) year - 1 else year
  val era = (if (y >= 0) y else y - 399) / 400
  val yoe = y - era * 400
  val doy = (153 * (if (month > 2) month - 3 else month + 9) + 2) / 5 + day - 1
  val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
  return era * 146_097 + doe - 719_468
}
