// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.site.pages

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import com.aglyn.contracts.formatLocalDay
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

// A site's held and flagged pages (the console's `PageHoldChips` and `PageHoldBanner`, AGL-3374): what the automated
// safety review holds, flags or did not approve, from `GET /api/hosts/page-holds`. A chip per status on the page's row,
// and on the page itself a banner per hold saying what happened, what visitors see meanwhile, and the three things the
// owner can do: View details (the notice on Holds & reviews), Request a review (there too), Contact support. There is no
// release: that is staff's decision, and nothing here can make it. The Apple kit's PageHolds.swift.

/** What a hold is shown on: the page, or a layout or component a held page renders. */
data class HeldPageTarget(val type: String, val id: String)

/** One open page hold, as the route hands it over (`PageHoldView`). */
data class PageHold(
  val noticeId: String,
  /** `page-held` or `page-flagged`. */
  val kind: String,
  /** `held`, `in-review`, `rejected`…; null when the notice has no review row. */
  val status: String?,
  val chipLabel: String,
  /** `warning`, `error` or `info`. */
  val chipColor: String,
  val label: String,
  val details: List<String> = emptyList(),
  val visitorSentence: String,
  val targets: List<HeldPageTarget>,
  val reference: String? = null,
  val reviewable: Boolean = false,
  val reviewRequestedAtMs: Long? = null,
) {
  val tone: StatusTone
    get() = when (chipColor) {
      "error" -> StatusTone.ERROR
      "info" -> StatusTone.INFO
      else -> StatusTone.WARNING
    }

  companion object {
    fun from(json: JsonElement): PageHold? {
      val obj = json as? JsonObject ?: return null
      val id = obj.str("noticeId")?.takeIf { it.isNotEmpty() } ?: return null
      val chip = obj["chip"] as? JsonObject
      return PageHold(
        noticeId = id,
        kind = obj.str("kind") ?: "page-held",
        status = obj.str("status"),
        chipLabel = chip?.str("label") ?: "Held",
        chipColor = chip?.str("color") ?: "warning",
        label = obj.str("label") ?: "a page on your site",
        details = (obj["details"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }.orEmpty(),
        visitorSentence = obj.str("visitorSentence").orEmpty(),
        targets = (obj["targets"] as? JsonArray)?.mapNotNull { target ->
          val t = target as? JsonObject ?: return@mapNotNull null
          HeldPageTarget(t.str("type") ?: return@mapNotNull null, t.str("id") ?: return@mapNotNull null)
        }.orEmpty(),
        reference = obj.str("reference"),
        reviewable = (obj["reviewable"] as? JsonPrimitive)?.booleanOrNull == true,
        reviewRequestedAtMs = (obj["reviewRequestedAtMs"] as? JsonPrimitive)?.doubleOrNull?.toLong(),
      )
    }
  }
}

private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

/** `holdsForTarget`: the holds shown on one document. */
fun holdsForTarget(holds: List<PageHold>, target: HeldPageTarget): List<PageHold> = holds.filter { target in it.targets }

/** One chip per status, however many holds share it, in the order first seen (`PageHoldChips`). */
fun pageHoldChips(holds: List<PageHold>): List<PageHold> = holds.distinctBy { it.chipLabel }

/**
 * What the banner says (`pageHoldBannerCopy`): what happened to which page, the facts beside it, and what visitors get
 * meanwhile. On a layout or component the hold is on a PAGE that renders it, so the page is named first.
 */
fun pageHoldBannerCopy(hold: PageHold, target: HeldPageTarget, timeZone: String? = null): Pair<String, List<String>> {
  val what = when {
    hold.status == "rejected" -> "was not approved after review, and is not being served"
    hold.kind == "page-flagged" -> "was flagged by our automated safety review and is being looked at by a person"
    else -> "is held for review by our automated safety review"
  }
  val name = hold.label.replaceFirstChar { it.uppercaseChar() }
  val title = if (target.type == "screen") "$name $what." else "$name, which uses this ${target.type}, $what."
  val lines = buildList {
    addAll(hold.details)
    add(hold.visitorSentence)
    hold.reviewRequestedAtMs?.let { add("A review was requested on ${formatLocalDay(it, "M/d/yyyy, h:mm a", timeZone)}.") }
    hold.reference?.let { add("Reference $it.") }
  }.filter { it.isNotEmpty() }
  return title to lines
}

/** The route's answer. */
data class PageHoldsAnswer(
  val holds: List<PageHold>,
  val orgId: String?,
  /** Whether THIS reader may ask for a review ("Holds and reviews" over the whole workspace). */
  val canRequestReview: Boolean,
)

suspend fun fetchPageHolds(api: ConsoleApiClient, hostId: String): PageHoldsAnswer {
  val answer = api.request("/api/hosts/page-holds", ApiMethod.GET, query = mapOf("hostId" to hostId)) as? JsonObject
  return PageHoldsAnswer(
    holds = (answer?.get("holds") as? JsonArray)?.mapNotNull(PageHold::from).orEmpty(),
    orgId = answer?.str("orgId"),
    canRequestReview = (answer?.get("canRequestReview") as? JsonPrimitive)?.booleanOrNull == true,
  )
}

/**
 * The console links a banner's buttons follow: Holds & reviews for View details, the notice there with its review request
 * open for Request a review (`?notice=`, which the native Holds screen opens as the request), and the support tickets.
 */
fun pageHoldDetailsLink(orgSlug: String): String = "/$orgSlug/settings/holds"
fun pageHoldReviewLink(orgSlug: String, noticeId: String): String = "/$orgSlug/settings/holds?notice=$noticeId"
fun pageHoldSupportLink(orgSlug: String): String = "/$orgSlug/support/tickets"

/** The chips on a page's row. */
@Composable
fun PageHoldChips(holds: List<PageHold>) {
  for (hold in pageHoldChips(holds)) StatusChip(hold.chipLabel, hold.tone, Modifier.testTag("page-hold-chip"))
}

/** The banner on a page: one notice per hold on it. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PageHoldBanner(context: NativePluginContext, answer: PageHoldsAnswer?, target: HeldPageTarget) {
  answer ?: return
  for (hold in holdsForTarget(answer.holds, target)) {
    val (title, lines) = pageHoldBannerCopy(hold, target)
    // The tone's own tint, as a notice draws it (the console's Alert severity).
    val palette = com.aglyn.ui.LocalAglynPalette.current
    val container = when (hold.tone) {
      StatusTone.ERROR -> palette.error.main.copy(alpha = 0.14f)
      StatusTone.INFO -> palette.primary.main.copy(alpha = 0.14f)
      else -> palette.warning.main.copy(alpha = 0.18f)
    }
    Column(
      Modifier.fillMaxWidth().background(container, RoundedCornerShape(10)).padding(space(2f)).testTag("page-hold-banner"),
      verticalArrangement = Arrangement.spacedBy(space(1f)),
    ) {
      FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
        StatusChip(hold.chipLabel, hold.tone)
        Text(title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
      }
      for (line in lines) Text(line, style = MaterialTheme.typography.bodyMedium)
      if (hold.reviewable && !answer.canRequestReview) {
        Text(
          "Requesting a review takes the \"Holds and reviews\" permission, which owners and admins hold by default.",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
      val orgSlug = context.orgSlug
      if (orgSlug != null) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
          OutlinedButton(onClick = { context.openLink(pageHoldDetailsLink(orgSlug)) }, modifier = Modifier.testTag("page-hold-details")) {
            Text("View details")
          }
          if (hold.reviewable && answer.canRequestReview && answer.orgId != null) {
            // The request itself is made on the notice, where its note is written (Holds & reviews).
            OutlinedButton(onClick = { context.openLink(pageHoldReviewLink(orgSlug, hold.noticeId)) }, modifier = Modifier.testTag("page-hold-request-review")) {
              Text("Request a review")
            }
          }
          TextButton(onClick = { context.openLink(pageHoldSupportLink(orgSlug)) }, modifier = Modifier.testTag("page-hold-support")) {
            Text("Contact support")
          }
        }
      }
    }
  }
}
