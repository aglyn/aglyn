package com.aglyn.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/** Where the account stands with the published Terms and Privacy Policy (`GET /api/auth/legal-acceptance`, AGL-2316). */
data class LegalStatus(
  val reacceptanceRequired: Boolean,
  /** `none`, `never-accepted` or `version-superseded`. */
  val reason: String,
  /** When they last agreed, as the route's ISO; null when unknown or never. */
  val latestAcceptedAt: String?,
  /** Which documents moved (`terms`, `privacy`); null is UNKNOWN, and then nothing is claimed. */
  val changedDocumentKeys: List<String>?,
) {
  companion object {
    fun of(body: JsonObject?): LegalStatus? {
      val required = (body?.get("reacceptanceRequired") as? JsonPrimitive)?.booleanOrNull ?: return null
      return LegalStatus(
        required,
        (body["reacceptanceReason"] as? JsonPrimitive)?.contentOrNull ?: "none",
        (body["latestAcceptedAt"] as? JsonPrimitive)?.contentOrNull?.ifBlank { null },
        (body["changedDocumentKeys"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull },
      )
    }
  }
}

/**
 * The re-acceptance banner's words (the console's `LegalReacceptanceBanner`): the sentence around the Terms of Service and
 * Privacy Policy links, and the line under it. Someone who agreed and whose documents moved is thanked first and never told
 * they have not agreed; an account with no record is told it is OUR gap.
 */
data class LegalReacceptanceCopy(val lead: String, val tail: String, val caption: String) {
  companion object {
    private val MONTHS = listOf("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")

    /** The banner's words, or null when nothing is asked. [day] formats the day they agreed (`formatAcceptedOn`). */
    fun make(status: LegalStatus, brand: String, day: (String) -> String? = ::defaultDay): LegalReacceptanceCopy? {
      if (!status.reacceptanceRequired) return null
      if (status.reason == "version-superseded") {
        val on = status.latestAcceptedAt?.let(day)
        val then = ". We’ve updated them since, so please take another look and confirm you’re happy to continue."
        val changed = status.changedDocumentKeys?.takeIf { it.isNotEmpty() }?.let(::joined)
        return LegalReacceptanceCopy(
          lead = if (on != null) "Thanks for agreeing to $brand’s " else "You’ve already agreed to $brand’s ",
          tail = if (on != null) " on $on$then" else then,
          caption = changed?.let { "What changed: the $it. Your earlier agreement stays on record — this adds to it." }
            ?: "Your earlier agreement stays on record — this adds to it.",
        )
      }
      return LegalReacceptanceCopy(
        lead = "We don’t have a record of your acceptance of $brand’s ",
        tail = " on this account. Please take a look and confirm to continue.",
        caption = "This is usually because the account was created before we started keeping these records, or through single sign-on or an invite that never showed one.",
      )
    }

    /** `2026-11-02T…` as "November 2, 2026"; null for anything unparseable, so no "Invalid Date" reaches the screen. */
    fun defaultDay(iso: String): String? {
      val parts = Regex("^(\\d{4})-(\\d{2})-(\\d{2})").find(iso)?.groupValues ?: return null
      val month = MONTHS.getOrNull(parts[2].toInt() - 1) ?: return null
      return "$month ${parts[3].toInt()}, ${parts[1]}"
    }

    /** "the Terms of Service", "the Terms of Service and the Privacy Policy" (`joinDocumentLabels`). */
    fun joined(keys: List<String>): String {
      val labels = keys.map { mapOf("terms" to "Terms of Service", "privacy" to "Privacy Policy")[it] ?: it }
      return if (labels.size <= 1) labels.firstOrNull().orEmpty() else "${labels.dropLast(1).joinToString(", ")} and the ${labels.last()}"
    }
  }
}

/**
 * The context the app's re-acceptance is recorded under: its own door, as the console's is `reaccept-console` and the apps'
 * Apple sign-up is `signup-apple`. The server stamps the version it publishes and its own clock.
 */
const val LEGAL_REACCEPTANCE_CONTEXT = "reaccept-app"
