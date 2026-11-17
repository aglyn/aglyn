package com.aglyn.core

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * The platform lockdown's notice (`/api/lockdown-status`, the console's `PlatformLockdownGate`): what a signed-in person
 * who is not staff sees in place of the app while the platform is locked. An answer that is not `locked`, or no answer at
 * all, is open: the server gates decide.
 */
data class PlatformLockdownNotice(
  val title: String,
  val message: String,
  /** "Expected back by …" on this device's clock, when the lock has an end. */
  val until: String?,
  /** The address questions go to, when the lock names one. */
  val contact: String?,
) {
  companion object {
    fun from(answer: JsonElement?, brand: String, clock: (Long) -> Pair<String, String> = ::localDayAndTime): PlatformLockdownNotice? {
      val record = answer as? JsonObject ?: return null
      if ((record["locked"] as? JsonPrimitive)?.booleanOrNull != true) return null
      fun text(key: String) = (record[key] as? JsonPrimitive)?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() }
      val until = (record["untilMs"] as? JsonPrimitive)?.doubleOrNull?.takeIf { it.isFinite() && it > 0 }?.let { ms ->
        val (day, time) = clock(ms.toLong())
        "Expected back by ${readableDay(day)}, $time."
      }
      return PlatformLockdownNotice(
        title = text("title") ?: "Temporarily unavailable",
        message = text("message") ?: "$brand is temporarily unavailable. Please check back shortly.",
        until = until,
        contact = text("contact"),
      )
    }

    /** Reads the lock; a failed read is open, as the console's gate fails open. */
    suspend fun read(api: ConsoleApiClient, brand: String): PlatformLockdownNotice? =
      from(runCatching { api.request("/api/lockdown-status", anonymous = true) }.getOrNull(), brand)

    private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

    private fun readableDay(day: String): String {
      val parts = day.split("-").mapNotNull { it.toIntOrNull() }
      if (parts.size != 3) return day
      return "${MONTHS.getOrElse(parts[1] - 1) { "" }} ${parts[2]}, ${parts[0]}"
    }
  }
}
