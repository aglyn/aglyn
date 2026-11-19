package com.aglyn.plugins.crm

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.formatLocalDay
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/*
 * WHAT IS KNOWN ABOUT A RECORD'S ADDRESS (the Apple `CrmEmailCheck.swift`; the console's `email-state.ts`,
 * `crm-email-state-chip.tsx`, `crm-email-check.tsx` and `crm-send-email-button.tsx`): the record's own email state as a
 * chip, the mail gateway in front of the address and what it did with this site's mail (`crm/email-check`), and the
 * composer's warning before a one-to-one send. A state that forbids email switches Send email off, with the reason.
 */

/** The record's email state (`EmailState`), as `readEmailState` holds it to its shape. */
data class CrmEmailState(val status: String, val atMs: Long, val source: String, val detail: String?, val enrollmentId: String? = null)

private val crmEmailStateSources = setOf("sequence", "campaign", "member", "check")

/** `readEmailState`: the state a record holds, or null when it holds none (most records). */
fun crmReadEmailState(record: Map<String, Any?>?): CrmEmailState? {
  val raw = record?.get("emailState") as? Map<*, *> ?: return null
  val status = raw["status"] as? String ?: return null
  if (status !in Contracts.emailStateLabels) return null
  val at = (raw["atMs"] as? Number)?.toDouble() ?: 0.0
  val source = raw["source"] as? String
  return CrmEmailState(
    status = status,
    atMs = if (at.isFinite() && at > 0) at.toLong() else 0L,
    source = source?.takeIf { it in crmEmailStateSources } ?: "campaign",
    detail = (raw["detail"] as? String)?.takeIf { it.isNotEmpty() },
    enrollmentId = (raw["enrollmentId"] as? String)?.takeIf { it.isNotEmpty() },
  )
}

/** `emailStateForbidsEmail`: every verdict but "Email OK" means the address must not be emailed by hand. */
fun crmEmailStateForbidsEmail(state: CrmEmailState?): Boolean = state != null && state.status != "ok"

/** `emailStateWhen`: the day the verdict was given ("Nov 14, 2023"), or "" when it is not known. */
fun crmEmailStateWhen(atMs: Long, timeZone: String? = null): String = if (atMs <= 0) "" else formatLocalDay(atMs, "MMM d, yyyy", timeZone)

/** `emailStateRefusal`: why the record must not be emailed, in the sentence Send email's reason shows, or null. */
fun crmEmailStateRefusal(state: CrmEmailState?, timeZone: String? = null): String? {
  if (state == null || !crmEmailStateForbidsEmail(state)) return null
  val whenText = crmEmailStateWhen(state.atMs, timeZone)
  val since = if (whenText.isEmpty()) "" else " on $whenText"
  val said = state.detail?.let { " $it" }.orEmpty()
  return when (state.status) {
    "undeliverable" -> "Email to this address would bounce: its domain has no mail server${if (since.isEmpty()) "" else " (checked$since)"}.$said"
    "bounced" -> "Email to this address bounced$since: the mailbox does not exist.$said"
    "blocked" -> "Their mail gateway blocked email to this address$since.$said"
    "unsubscribed" -> "They unsubscribed$since.$said"
    "complained" -> "They marked an email as spam$since.$said"
    "do_not_contact" -> "On the do-not-contact list$since.$said"
    else -> null
  }
}

/**
 * The chip's tone per state (`crm-email-state-chip.tsx`): the address failing reads as an error, a person's own act as
 * neutral, a complaint and a "Would bounce" prediction as a warning.
 */
fun crmEmailStateTone(status: String): StatusTone = when (status) {
  "ok" -> StatusTone.SUCCESS
  "undeliverable", "complained" -> StatusTone.WARNING
  "bounced", "blocked" -> StatusTone.ERROR
  else -> StatusTone.NEUTRAL
}

/** What `crm/email-check` answers about one address, sent from one site. */
data class CrmEmailCheck(
  val checked: Boolean = false,
  /** `no_mx`, `null_mx` or `gateway_held`; null when nothing is wrong. */
  val code: String? = null,
  val message: String? = null,
  val gateway: String? = null,
  /** The gateway chip's label and the server's tone (`refused`, `delivered`, `neutral`, `blocked`). */
  val chipLabel: String? = null,
  val chipTone: String? = null,
  /** `banned` or `locked` on the house workspace's sites; null everywhere else. */
  val accountLock: String? = null,
)

private fun JsonElement?.text(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

/** `readAnswer`: the route's answer held to its shape. */
fun crmEmailCheck(payload: JsonElement?): CrmEmailCheck {
  val answer = payload as? JsonObject ?: return CrmEmailCheck()
  val chip = answer["chip"] as? JsonObject
  val label = chip?.get("label").text()
  val tone = chip?.get("tone").text()
  return CrmEmailCheck(
    checked = (answer["checked"] as? JsonPrimitive)?.booleanOrNull == true,
    code = answer["code"].text()?.takeIf { it in setOf("no_mx", "null_mx", "gateway_held") },
    message = answer["message"].text(),
    gateway = answer["gateway"].text(),
    chipLabel = if (label != null && tone != null) label else null,
    chipTone = if (label != null && tone != null) tone else null,
    accountLock = answer["accountLock"].text()?.takeIf { it == "banned" || it == "locked" },
  )
}

/** `crmEmailCheckWarning`: the composer's warning before a one-to-one send, or null. */
fun crmEmailCheckWarning(check: CrmEmailCheck?): String? {
  val message = check?.message ?: return null
  if (check.code == null) return null
  return if (check.code == "gateway_held") "$message A one-to-one email still goes, but it is likely to be refused too." else "$message Sending will not reach them."
}

/** The gateway chip's tone (`TONE_COLOR`). */
fun crmGatewayTone(tone: String): StatusTone = when (tone) {
  "refused", "blocked" -> StatusTone.ERROR
  "delivered" -> StatusTone.SUCCESS
  else -> StatusTone.NEUTRAL
}

/**
 * The gateway chip, or null: none without a verdict, and none for a "blocked" domain when the record already says
 * "Would bounce" (the chip would say the same).
 */
fun crmGatewayChip(check: CrmEmailCheck?, state: CrmEmailState?): Pair<String, StatusTone>? {
  val label = check?.chipLabel ?: return null
  val tone = check.chipTone ?: return null
  if (tone == "blocked" && state?.status == "undeliverable") return null
  return label to crmGatewayTone(tone)
}

/** The account-lock chip (`CrmAccountLockChip`): why a record whose consent reads as given is skipped by every send. */
data class CrmAccountLock(val label: String, val tone: StatusTone, val reason: String)

fun crmAccountLockChip(check: CrmEmailCheck?): CrmAccountLock? {
  val brand = Contracts.platformBrandName
  return when (check?.accountLock) {
    "banned" -> CrmAccountLock(
      "Account banned", StatusTone.ERROR,
      "This address belongs to a $brand account banned for abuse. Nothing is sent to it — no campaign, sequence or one-to-one email — whatever its consent says. Lifting the ban restores it.",
    )
    "locked" -> CrmAccountLock(
      "Account locked", StatusTone.WARNING,
      "This address belongs to a locked $brand account. Our campaigns and sequences skip it until the lock is lifted; its consent is unchanged.",
    )
    else -> null
  }
}

/**
 * The record's address chips (`contact-detail-page.tsx`, `lead-properties-card.tsx`): its email state first, then the
 * mail gateway, then an account lock; with the reason Send email is off under them, as the console's tooltip.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun CrmEmailChips(state: CrmEmailState?, check: CrmEmailCheck?) {
  val gateway = crmGatewayChip(check, state)
  val lock = crmAccountLockChip(check)
  if (state == null && gateway == null && lock == null) return
  Column(verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(space(0.5f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
      state?.let { StatusChip(Contracts.emailStateLabels[it.status] ?: it.status, crmEmailStateTone(it.status), Modifier.testTag("crm-email-state")) }
      gateway?.let { StatusChip(it.first, it.second, Modifier.testTag("crm-email-gateway")) }
      lock?.let { StatusChip(it.label, it.tone, Modifier.testTag("crm-account-lock")) }
    }
    val reason = crmEmailStateRefusal(state) ?: lock?.reason ?: check?.message?.takeIf { gateway != null }
    reason?.let {
      Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.testTag("crm-email-state-reason"))
    }
  }
}
