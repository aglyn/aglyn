// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import Observation
import SwiftUI

/// The plan card at the foot of the sidebar (AGL-3945, Phase 4; Figma Sidebar 12:703): shown only when one of the
/// workspace's limits is close, from the console's own figures (the Usage page's meters: sites, team seats, datasets
/// against `/api/orgs/entitlements`), with View plans. Dismissed, it stays away until the next limit.
@MainActor
@Observable
final class PlanLimits {
  struct Near: Equatable {
    let label: String
    let used: Int
    let limit: Int
    let plan: String
  }

  private(set) var near: Near?
  @ObservationIgnored private var loadedFor: String?

  /// The console's meter warns from 80% (`USAGE_METER_WARNING_PCT`).
  static let warningShare = 0.8

  func load(_ model: AppModel) async {
    let key = "\(model.workspace?.org?.id ?? ""):\(model.workspace?.sites.count ?? 0)"
    guard let api = model.api, let reader = model.reader, let org = model.workspace?.org, loadedFor != key else { return }
    loadedFor = key
    near = nil
    guard let ent = try? await api.request("/api/orgs/entitlements", query: [("orgId", org.id)]) else { return }
    let quotas = ent["quotas"]
    let plan = ent["plan"]?.stringValue.map { OnboardingPlanIntent.planLabels[$0] ?? $0.capitalized } ?? "your plan"
    var meters: [Near] = []
    if let limit = quotas?["hostLimit"]?.numberValue {
      meters.append(Near(label: "sites", used: model.workspace?.sites.count ?? 0, limit: Int(limit), plan: plan))
    }
    if let limit = quotas?["managersPerOrg"]?.numberValue,
      let seats = try? await api.request("/api/orgs/members", query: [("orgId", org.id), ("counts", "1")]),
      let used = seats["managerSeats"]?.numberValue
    {
      meters.append(Near(label: "team seats", used: Int(used), limit: Int(limit), plan: plan))
    }
    if let limit = quotas?["datasetsPerOrg"]?.numberValue,
      let used = try? await reader.count(FirestoreQuery(["orgs", org.id, "datasets"]))
    {
      meters.append(Near(label: "datasets", used: used, limit: Int(limit), plan: plan))
    }
    // An unlimited quota is a very large number; a zero limit is a feature the plan does not have, not a meter.
    near = meters.filter { $0.limit > 0 && $0.limit < 100_000 && Double($0.used) >= Double($0.limit) * Self.warningShare }
      .max { Double($0.used) / Double($0.limit) < Double($1.used) / Double($1.limit) }
  }

  /// The dismissal's key: this workspace, this meter, at this limit.
  static func dismissKey(orgID: String, near: Near) -> String { "aglyn.planCard.\(orgID).\(near.label).\(near.limit)" }
}

struct PlanCard: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  @State private var limits = PlanLimits()
  @State private var dismissed = false

  var body: some View {
    Group {
      if let near = limits.near, let orgID = model.workspace?.org?.id, !dismissed,
        !UserDefaults.standard.bool(forKey: PlanLimits.dismissKey(orgID: orgID, near: near))
      {
        VStack(alignment: .leading, spacing: 8) {
          HStack(alignment: .top) {
            Text("\(near.used) of \(near.limit) \(near.label) on \(near.plan)").font(AglynFont.strongSubheadline)
            Spacer()
            Button {
              UserDefaults.standard.set(true, forKey: PlanLimits.dismissKey(orgID: orgID, near: near))
              dismissed = true
            } label: {
              Image(systemName: "xmark").font(.caption)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss")
          }
          ProgressView(value: min(1, Double(near.used) / Double(near.limit)))
            .tint(near.used >= near.limit ? AglynColor.error : AglynColor.primary)
          Text("Upgrade for more \(near.label), sites and AI credits.").font(AglynFont.caption).foregroundStyle(.secondary)
          Button("View plans") {
            navigation.mode = .main
            navigation.push(.screen("core.billing.plans", [:]))
          }
          .buttonStyle(.bordered)
          .controlSize(.small)
          .accessibilityIdentifier("plan-card-view-plans")
        }
        .padding(12)
        .aglynCardSurface()
        .padding(10)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("plan-card")
      }
    }
    .task(id: "\(model.workspace?.org?.id ?? ""):\(model.workspace?.sites.count ?? 0)") {
      dismissed = false
      await limits.load(model)
    }
  }
}
