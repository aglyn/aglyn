// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// The console's "Last campaign" card on a site's dashboard (campaign-glance-card.component.tsx, AGL-4011): the site's
/// most recent sent campaign, its subject, and sent, opens and clicks; Campaigns opens the history. It reads the newest
/// thirty of the workspace's sends that this site sent (`orgs/{orgId}/campaigns`, `visibleTo` the site's token) and
/// draws nothing when none of them has been sent, as the console's card does. The Kotlin twin is `LastCampaignCard.kt`.
struct LastCampaignCard: View {
  let context: NativePluginContext
  @State private var sends = LiveQueryList(pageSize: 30) { $0 }

  /// How many sends the card searches for the last SENT one (`SEARCH_CEILING`).
  static let searchCeiling = 30

  /// One of the send's counters, as the console prints it (`stats.sent ?? 0`).
  private static func figure(_ stats: [String: Any]?, _ key: String) -> String { ((stats?[key] as? NSNumber)?.intValue ?? 0).formatted() }

  private var lastSent: FirestoreDocument? {
    sends.rows.filter { $0.string("status") == "sent" }
      .max { ($0.date("sentAt") ?? .distantPast) < ($1.date("sentAt") ?? .distantPast) }
  }

  var body: some View {
    Group {
      if let campaign = lastSent {
        let stats = campaign.data["stats"] as? [String: Any]
        VStack(alignment: .leading, spacing: AglynSpace.one) {
          HStack(alignment: .firstTextBaseline) {
            Text("Last campaign").font(AglynFont.headline).accessibilityAddTraits(.isHeader)
            Spacer(minLength: AglynSpace.one)
            Button("Campaigns") { context.navigate(MarketingSection.campaigns.screen) }
              .buttonStyle(.borderless).foregroundStyle(AglynColor.tint)
              .accessibilityIdentifier("last-campaign-open")
          }
          Text(campaign.string("subject") ?? "").font(AglynFont.subheadline).lineLimit(1)
          HStack(spacing: AglynSpace.three) {
            AglynStatTile(Self.figure(stats, "sent"), label: "Sent")
            AglynStatTile(Self.figure(stats, "opens"), label: "Opens")
            AglynStatTile(Self.figure(stats, "clicks"), label: "Clicks")
          }
          .fixedSize(horizontal: false, vertical: true)
        }
        .padding(AglynSpace.two)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .aglynCardSurface()
        .accessibilityIdentifier("last-campaign")
      }
    }
    .task(id: "\(context.orgID ?? ""):\(context.hostID ?? "")") {
      guard let orgID = context.orgID, let hostID = context.hostID else { return }
      sends.show(context.firestore) { _ in
        FirestoreQuery(
          ["orgs", orgID, "campaigns"],
          filters: [ListQueryConstraint(path: "visibleTo", op: .arrayContainsAny, value: [OrgAccess.hostScopeToken(hostID)])],
          limit: Self.searchCeiling)
      }
    }
    .onDisappear { sends.stop() }
  }
}
