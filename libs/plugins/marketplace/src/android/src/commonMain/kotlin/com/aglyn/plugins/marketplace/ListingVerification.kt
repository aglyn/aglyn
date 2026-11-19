// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.plugins.marketplace

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.permissionRefusalText
import com.aglyn.core.ApiMethod
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.jsonBody
import com.aglyn.core.nowMillis
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.rememberMemberPermissions
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.SectionCard
import com.aglyn.ui.StatusTone
import com.aglyn.ui.formatDateTime
import com.aglyn.ui.space

/*
 * The publisher's door to the Verified badge (AGL-1217): the console's `ListingVerificationRequest`, on the listing page
 * the publisher opens from Sell. Request verification, Withdraw request, and the decline with when they may ask again.
 * Whether they may ask is `verificationRequestBlock`, ported from listing-verification.ts and replayed from the console's
 * own cases; the route decides again. The Swift plugin's ListingVerification.swift draws the same.
 */

/** Days a publisher waits after a decline before asking again (`VERIFICATION_DECLINE_COOLDOWN_DAYS`). */
internal const val VERIFICATION_DECLINE_COOLDOWN_DAYS = 30.0

/** The console route that takes the ask and its withdrawal. */
internal const val VERIFICATION_REQUEST_ROUTE = "/api/marketplace/verification-request"

/** A stored time in epoch milliseconds, as `timestampMs` reads it: a Firestore timestamp, or `{ seconds }`; else null. */
internal fun verificationTimestampMs(value: Any?): Double? = when (value) {
  is FirestoreTimestamp -> value.epochMillis.toDouble()
  is Map<*, *> -> (value["seconds"] as? Number)?.toDouble()?.times(1000)
  else -> null
}

/**
 * Why a publisher may not ask for the badge right now, null when they may (`verificationRequestBlock`): not the publishing
 * workspace, already verified, not listed yet, already waiting, or declined within the cooldown. An undated decline fails
 * closed.
 */
fun verificationRequestBlock(listing: Map<String, Any?>?, viewerOrgId: String?, nowMs: Double): String? {
  if (listing == null || viewerOrgId.isNullOrEmpty() || listing["profileId"] != viewerOrgId) return "not-publisher"
  val status = listing["reviewStatus"] as? String
  if (status == "verified") return "already-verified"
  if (status != "listed") return "not-listed"
  val request = listing["verificationRequest"] as? Map<*, *>
  val state = request?.get("state") as? String
  if (state == "pending") return "already-pending"
  if (state == "declined") {
    val decidedAt = verificationTimestampMs(request["decidedAt"]) ?: return "cooling-down"
    if ((nowMs - decidedAt) / 86_400_000 < VERIFICATION_DECLINE_COOLDOWN_DAYS) return "cooling-down"
  }
  return null
}

/** Whether the card shows: nothing for another workspace's listing or a verified one, nor one in review with nothing waiting. */
internal fun verificationCardShows(block: String?, state: String?): Boolean =
  block != "not-publisher" && block != "already-verified" && !(block == "not-listed" && state != "pending")

/** What the badge claims, said where someone asks for it. The platform's name: it names who did the verifying. */
internal val WHAT_VERIFIED_CLAIMS: String
  get() = "Verified says a human at ${Contracts.platformBrandName} confirmed who you are, " +
    "and that this listing describes what the code does. It is a claim about " +
    "you as a publisher, so it survives a version bump. It is not a security " +
    "guarantee, and it does not review the bytes of any particular release — " +
    "that is what Reviewed means, and it is earned per version."

/** The Verified publisher card, for the publisher of a plugin listing; `listing` is the listing document's fields. */
@Composable
internal fun ListingVerificationCard(context: NativePluginContext, listingId: String, listing: Map<String, Any?>) {
  val scope = rememberCoroutineScope()
  val runner = remember(listingId) { ActionRunner(scope) }
  var agreed by remember(listingId) { mutableStateOf(false) }
  // The action just taken, so the card does not sit unchanged while the listing document catches up.
  var justDid by remember(listingId) { mutableStateOf<String?>(null) }
  val canAsk = rememberMemberPermissions(context).can(PUBLISHER_PROFILE_KEY)
  val request = listing["verificationRequest"] as? Map<*, *>
  val state = justDid ?: request?.get("state") as? String
  val block = verificationRequestBlock(listing, context.orgId, nowMillis().toDouble())
  if (!verificationCardShows(block, state)) return
  val post = { action: String ->
    val consent = PublisherAgreementConsent.current
    runner.run(onDone = {
      justDid = if (action == "request") "pending" else "withdrawn"
      agreed = false
    }) {
      context.api.request(VERIFICATION_REQUEST_ROUTE, ApiMethod.POST, jsonBody("listingId" to listingId, "action" to action, "agreement" to consent.body))
    }
  }
  SectionCard("Verified publisher", modifier = Modifier.testTag("listing-verification")) {
    Column(verticalArrangement = Arrangement.spacedBy(space(1.5f)), modifier = Modifier.fillMaxWidth()) {
      Text(WHAT_VERIFIED_CLAIMS, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      when {
        state == "pending" -> {
          NoticeBanner("Your request is with the review team. Your plugin stays listed and installable while they look.", StatusTone.INFO)
          PublisherAgreementCheckbox(agreed, { agreed = it }, enabled = !runner.busy && canAsk)
          OutlinedButton(
            onClick = { post("withdraw") },
            enabled = !runner.busy && canAsk && agreed,
            modifier = Modifier.testTag("listing-verification-withdraw"),
          ) { Text(if (runner.busy) "Withdrawing…" else "Withdraw request") }
        }
        block == "cooling-down" -> {
          val reason = (request?.get("declineReason") as? String)?.let { "Declined: $it" } ?: "A previous request was declined."
          val again = verificationTimestampMs(request?.get("decidedAt"))?.let {
            "You can ask again from " + formatDateTime((it + VERIFICATION_DECLINE_COOLDOWN_DAYS * 86_400_000).toLong(), withTime = false) + "."
          } ?: "You can ask again ${VERIFICATION_DECLINE_COOLDOWN_DAYS.toInt()} days after the decision."
          NoticeBanner("$reason\n$again", StatusTone.WARNING)
        }
        else -> {
          PublisherAgreementCheckbox(agreed, { agreed = it }, enabled = !runner.busy && canAsk && block == null)
          Button(
            onClick = { post("request") },
            enabled = !runner.busy && canAsk && block == null && agreed,
            modifier = Modifier.testTag("listing-verification-request"),
          ) { Text(if (runner.busy) "Requesting…" else "Request verification") }
        }
      }
      // Why asking is off, named; not under the cooling-down notice, which has no button to explain.
      if (!canAsk && !(block == "cooling-down" && state != "pending")) {
        Text(permissionRefusalText(PUBLISHER_PROFILE_KEY), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      runner.error?.let { NoticeBanner(it, StatusTone.ERROR) }
    }
  }
}
