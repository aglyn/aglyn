package com.aglyn.plugins.marketing

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.aglyn.ui.SectionCard
import com.aglyn.ui.space

/*
 * THE MAIL, ACROSS A CAMPAIGN (the Apple `CampaignMailReport.swift`; the console's `campaignRollup` in
 * campaign-container.ts and the campaign page's "The mail, across this campaign" figures and rates): the sum over the
 * campaign's emails, never a second set of counters. A figure no email recorded is a dash, not a zero, and a rate names its
 * denominator.
 */

/** How many of a campaign's emails its page reads and sums (`CAMPAIGN_EMAIL_CEILING`). */
const val CAMPAIGN_EMAIL_CEILING = 50

/** One summed figure: the total over the emails that recorded it (null when none did), how many did, out of how many. */
data class CampaignAggregate(val value: Double?, val recorded: Int, val sends: Int) {
  /** The line under a figure (the page's `rolled`): which part of the campaign it covers. */
  val note: String
    get() = when {
      value == null -> "not recorded"
      recorded < sends -> "across $recorded of $sends emails"
      else -> "across $sends email${if (sends == 1) "" else "s"}"
    }
}

/** A rate with what it is taken over (`sendRate`). */
data class CampaignRate(val value: Double, val numerator: Double, val denominator: Double, val denominatorLabel: String) {
  /** `percent`: one decimal place. */
  val percent: String get() = "${kotlin.math.round(value * 1000) / 10.0}%"
  val detail: String get() = "${grouped(numerator.toLong())} of ${grouped(denominator.toLong())} $denominatorLabel"
}

/** What a campaign's emails add up to (`campaignRollup`), the figures its page draws. */
data class CampaignMailRollup(
  val sends: Int,
  val scheduled: Int,
  val sending: Int,
  val drafts: Int,
  val addressed: CampaignAggregate,
  val sent: CampaignAggregate,
  val delivered: CampaignAggregate,
  val opens: CampaignAggregate,
  val clicks: CampaignAggregate,
  val unsubscribes: CampaignAggregate,
  val openRate: CampaignRate?,
  val clickRate: CampaignRate?,
  val unsubscribeRate: CampaignRate?,
)

private fun progressCount(raw: Any?): Long {
  val number = (raw as? Number)?.toDouble() ?: return 0
  return if (number.isFinite() && number > 0) kotlin.math.floor(number).toLong() else 0
}

/** `campaignSendProgress(send).state`, as far as the rollup reads it: still going, or waiting for its time. */
fun campaignSendState(send: Map<String, Any?>): String {
  val status = send["status"] as? String ?: "sent"
  val stats = send["stats"] as? Map<*, *>
  val resume = send["resume"] as? Map<*, *>
  val open = status == "scheduled" || status == "sending"
  if (progressCount(resume?.get("remaining")) > 0 && progressCount(resume?.get("nextAtMs")) > 0 && open) return "sending"
  if (open && progressCount(stats?.get("sent")) == 0L) return "pending"
  return "other"
}

private fun aggregate(sends: List<Map<String, Any?>>, key: String): CampaignAggregate {
  var total = 0.0
  var recorded = 0
  for (send in sends) {
    // Absent is "this email never recorded it"; a recorded 0 counts as measured.
    val value = ((send["stats"] as? Map<*, *>)?.get(key) as? Number)?.toDouble() ?: continue
    if (!value.isFinite()) continue
    total += value
    recorded += 1
  }
  return CampaignAggregate(if (recorded > 0) total else null, recorded, sends.size)
}

private fun rate(numerator: Double?, denominator: Double?, label: String): CampaignRate? {
  val bottom = denominator ?: 0.0
  if (bottom <= 0) return null
  val top = numerator ?: 0.0
  return CampaignRate(top / bottom, top, bottom, label)
}

/** `campaignRollup`: drafts and emails waiting for their time do not count; the rates are over the emails that recorded a delivered count. */
fun campaignMailRollup(sends: List<Map<String, Any?>>): CampaignMailRollup {
  val gone = sends.filter { it["status"] != "draft" && campaignSendState(it) != "pending" }
  val measurable = sends.filter { (it["stats"] as? Map<*, *>)?.containsKey("delivered") == true }
  val delivered = aggregate(measurable, "delivered").value
  return CampaignMailRollup(
    sends = gone.count { it["status"] != "canceled" },
    scheduled = sends.count { campaignSendState(it) == "pending" },
    sending = sends.count { campaignSendState(it) == "sending" },
    drafts = sends.count { it["status"] == "draft" },
    addressed = aggregate(gone, "recipients"),
    sent = aggregate(gone, "sent"),
    delivered = aggregate(gone, "delivered"),
    opens = aggregate(gone, "opens"),
    clicks = aggregate(gone, "clicks"),
    unsubscribes = aggregate(gone, "unsubscribes"),
    openRate = rate(aggregate(measurable, "uniqueOpens").value, delivered, "delivered"),
    clickRate = rate(aggregate(measurable, "uniqueClicks").value, delivered, "delivered"),
    unsubscribeRate = rate(aggregate(measurable, "unsubscribes").value, delivered, "delivered"),
  )
}

/** "The mail, across this campaign": six figures with what each covers, then the three rates. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun CampaignMailCard(rollup: CampaignMailRollup, truncated: Boolean) {
  SectionCard("The mail, across this campaign", Modifier.fillMaxWidth().testTag("campaign-mail")) {
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(space(3f)), verticalArrangement = Arrangement.spacedBy(space(2f))) {
      listOf(
        "Addressed" to rollup.addressed, "Sent" to rollup.sent, "Delivered" to rollup.delivered,
        "Opens" to rollup.opens, "Clicks" to rollup.clicks, "Unsubscribed" to rollup.unsubscribes,
      ).forEach { (label, figure) ->
        Column(Modifier.widthIn(min = 120.dp)) {
          Text(figure.value?.let { grouped(it.toLong()) } ?: "—", style = MaterialTheme.typography.titleLarge)
          Text(label, style = MaterialTheme.typography.bodyMedium)
          Text(figure.note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
    }
    listOf("Open rate" to rollup.openRate, "Click rate" to rollup.clickRate, "Unsubscribe rate" to rollup.unsubscribeRate).forEach { (label, rate) ->
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        if (rate != null) {
          Text(rate.percent, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
          Text("  ${rate.detail}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
          Text("— not enough recorded to compute", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
    }
    if (truncated) Text("The figures above cover $CAMPAIGN_EMAIL_CEILING of this campaign's emails.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}
