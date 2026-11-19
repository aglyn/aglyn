// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import Foundation
import SwiftUI

/*
 * THE MAIL, ACROSS A CAMPAIGN (the Kotlin `CampaignMailReport.kt`; the
 * console's `campaignRollup` in campaign-container.ts and the campaign page's
 * "The mail, across this campaign" figures and rates): the sum over the
 * campaign's emails, never a second set of counters. A figure no email
 * recorded is a dash, not a zero, and a rate names its denominator.
 */

/// How many of a campaign's emails its page reads and sums (`CAMPAIGN_EMAIL_CEILING`).
let campaignEmailCeiling = 50

/// One summed figure: the total over the emails that recorded it (nil when none did), how many did, out of how many.
struct CampaignAggregate: Equatable {
  let value: Double?
  let recorded: Int
  let sends: Int

  /// The line under a figure (the page's `rolled`): which part of the campaign it covers.
  var note: String {
    if value == nil { return "not recorded" }
    return recorded < sends ? "across \(recorded) of \(sends) emails" : "across \(sends) email\(sends == 1 ? "" : "s")"
  }
}

/// A rate with what it is taken over (`sendRate`).
struct CampaignRate: Equatable {
  let value: Double
  let numerator: Double
  let denominator: Double
  let denominatorLabel: String

  /// `percent` and the line beside it: "55.6%", "5 of 9 delivered".
  var percent: String { String(format: "%.1f%%", value * 100) }
  var detail: String { "\(grouped(Int(numerator))) of \(grouped(Int(denominator))) \(denominatorLabel)" }
}

/// What a campaign's emails add up to (`campaignRollup`), the figures its page draws.
struct CampaignMailRollup: Equatable {
  let sends: Int
  let scheduled: Int
  let sending: Int
  let drafts: Int
  let addressed: CampaignAggregate
  let sent: CampaignAggregate
  let delivered: CampaignAggregate
  let opens: CampaignAggregate
  let clicks: CampaignAggregate
  let unsubscribes: CampaignAggregate
  let openRate: CampaignRate?
  let clickRate: CampaignRate?
  let unsubscribeRate: CampaignRate?
}

private func progressCount(_ raw: Any?) -> Int {
  guard let number = (raw as? NSNumber)?.doubleValue, number.isFinite else { return 0 }
  return max(0, Int(number.rounded(.down)))
}

/// `campaignSendProgress(send).state`, as far as the rollup reads it: still going, or waiting for its time.
func campaignSendState(_ send: [String: Any]) -> String {
  let status = send["status"] as? String ?? "sent"
  let stats = send["stats"] as? [String: Any]
  let resume = send["resume"] as? [String: Any]
  let reached = progressCount(stats?["sent"])
  let open = status == "scheduled" || status == "sending"
  if progressCount(resume?["remaining"]) > 0 && progressCount(resume?["nextAtMs"]) > 0 && open { return "sending" }
  if open && reached == 0 { return "pending" }
  return "other"
}

private func campaignAggregate(_ sends: [[String: Any]], _ key: String) -> CampaignAggregate {
  var total = 0.0
  var recorded = 0
  for send in sends {
    // Absent is "this email never recorded it"; a recorded 0 counts as measured.
    guard let value = ((send["stats"] as? [String: Any])?[key] as? NSNumber)?.doubleValue, value.isFinite else { continue }
    total += value
    recorded += 1
  }
  return CampaignAggregate(value: recorded > 0 ? total : nil, recorded: recorded, sends: sends.count)
}

private func campaignRate(_ numerator: Double?, _ denominator: Double?, _ label: String) -> CampaignRate? {
  let top = numerator ?? 0
  let bottom = denominator ?? 0
  guard bottom > 0 else { return nil }
  return CampaignRate(value: top / bottom, numerator: top, denominator: bottom, denominatorLabel: label)
}

/// `campaignRollup`: drafts and emails waiting for their time do not count; the rates are over the emails that recorded
/// a delivered count.
func campaignMailRollup(_ sends: [[String: Any]]) -> CampaignMailRollup {
  let gone = sends.filter { ($0["status"] as? String ?? "") != "draft" && campaignSendState($0) != "pending" }
  let measurable = sends.filter { ($0["stats"] as? [String: Any])?["delivered"] != nil }
  let delivered = campaignAggregate(measurable, "delivered").value
  return CampaignMailRollup(
    sends: gone.filter { ($0["status"] as? String) != "canceled" }.count,
    scheduled: sends.filter { campaignSendState($0) == "pending" }.count,
    sending: sends.filter { campaignSendState($0) == "sending" }.count,
    drafts: sends.filter { ($0["status"] as? String) == "draft" }.count,
    addressed: campaignAggregate(gone, "recipients"), sent: campaignAggregate(gone, "sent"),
    delivered: campaignAggregate(gone, "delivered"), opens: campaignAggregate(gone, "opens"), clicks: campaignAggregate(gone, "clicks"),
    unsubscribes: campaignAggregate(gone, "unsubscribes"),
    openRate: campaignRate(campaignAggregate(measurable, "uniqueOpens").value, delivered, "delivered"),
    clickRate: campaignRate(campaignAggregate(measurable, "uniqueClicks").value, delivered, "delivered"),
    unsubscribeRate: campaignRate(campaignAggregate(measurable, "unsubscribes").value, delivered, "delivered"))
}

/// "The mail, across this campaign": six figures with what each covers, then the three rates.
struct CampaignMailSection: View {
  let rollup: CampaignMailRollup
  /// More emails than the page reads: the figures cover the first ones.
  var truncated = false

  var body: some View {
    Section {
      LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), alignment: .leading)], alignment: .leading, spacing: AglynSpace.two) {
        figure("Addressed", rollup.addressed)
        figure("Sent", rollup.sent)
        figure("Delivered", rollup.delivered)
        figure("Opens", rollup.opens)
        figure("Clicks", rollup.clicks)
        figure("Unsubscribed", rollup.unsubscribes)
      }
      .padding(.vertical, AglynSpace.one)
      rate("Open rate", rollup.openRate)
      rate("Click rate", rollup.clickRate)
      rate("Unsubscribe rate", rollup.unsubscribeRate)
    } header: {
      Text("The mail, across this campaign")
    } footer: {
      if truncated {
        Text("The figures above cover \(campaignEmailCeiling) of this campaign's emails.")
      }
    }
    .accessibilityIdentifier("campaign-mail")
  }

  private func figure(_ label: String, _ value: CampaignAggregate) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(value.value.map { grouped(Int($0)) } ?? "—").font(AglynFont.title3.weight(.semibold))
      Text(label).font(AglynFont.subheadline)
      Text(value.note).font(AglynFont.caption).foregroundStyle(.secondary)
    }
    .accessibilityElement(children: .combine)
  }

  private func rate(_ label: String, _ rate: CampaignRate?) -> some View {
    LabeledContent(label) {
      if let rate {
        HStack(alignment: .firstTextBaseline, spacing: AglynSpace.one) {
          Text(rate.percent).fontWeight(.semibold)
          Text(rate.detail).font(AglynFont.caption).foregroundStyle(.secondary)
        }
      } else {
        Text("— not enough recorded to compute").font(AglynFont.caption).foregroundStyle(.secondary)
      }
    }
  }
}
