// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import Observation
import SwiftUI

/// The plan card at the foot of the sidebar (AGL-3945, P10; Figma Sidebar 12:703, plan card 98:1048): shown only when one
/// of the limits where the window stands is close, from the console's own figures (the Usage page's meters: the site's
/// pages, then the workspace's sites, team seats and datasets, against `/api/orgs/entitlements`), as the console's meter
/// draws it ("Pages 84 / 100 · Upgrade", USAGE_METER_WARNING_PCT). Upgrade opens Billing.
@MainActor
@Observable
final class PlanLimits {
  struct Near: Equatable {
    /// The console meter's own label ("Pages", "Sites", "Team seats (incl. you)").
    let label: String
    let used: Int
    let limit: Int
    let plan: String
    var share: Double { Double(used) / Double(limit) }
  }

  private(set) var near: Near?
  @ObservationIgnored private var loadedFor: String?

  /// The console's meter warns from 80% (`USAGE_METER_WARNING_PCT`).
  static let warningShare = 0.8

  func load(_ model: AppModel, hostID: String?) async {
    let key = "\(model.workspace?.org?.id ?? ""):\(hostID ?? ""):\(model.workspace?.sites.count ?? 0)"
    guard let api = model.api, let reader = model.reader, let org = model.workspace?.org, loadedFor != key else { return }
    loadedFor = key
    near = nil
    guard let ent = try? await api.request("/api/orgs/entitlements", query: [("orgId", org.id)]) else { return }
    let quotas = ent["quotas"]
    let plan = ent["plan"]?.stringValue.map { OnboardingPlanIntent.planLabels[$0] ?? $0.capitalized } ?? "Free"
    var meters: [Near] = []
    // The site's own meter first, where the window stands in a site (the Usage page's "Pages").
    if let hostID, let limit = quotas?["screensPerHost"]?.numberValue,
      let usage = try? await api.request("/api/hosts/usage", query: [("hostId", hostID)]),
      let used = usage["screens"]?.numberValue
    {
      meters.append(Near(label: "Pages", used: Int(used), limit: Int(limit), plan: plan))
    }
    if let limit = quotas?["hostLimit"]?.numberValue {
      meters.append(Near(label: "Sites", used: model.workspace?.sites.count ?? 0, limit: Int(limit), plan: plan))
    }
    if let limit = quotas?["managersPerOrg"]?.numberValue,
      let seats = try? await api.request("/api/orgs/members", query: [("orgId", org.id), ("counts", "1")]),
      let used = seats["managerSeats"]?.numberValue
    {
      meters.append(Near(label: "Team seats (incl. you)", used: Int(used), limit: Int(limit), plan: plan))
    }
    if let limit = quotas?["datasetsPerOrg"]?.numberValue,
      let used = try? await reader.count(FirestoreQuery(["orgs", org.id, "datasets"]))
    {
      meters.append(Near(label: "Datasets", used: used, limit: Int(limit), plan: plan))
    }
    guard loadedFor == key else { return }
    // An unlimited quota is a very large number; a zero limit is a feature the plan does not have, not a meter.
    near = meters.filter { $0.limit > 0 && $0.limit < 100_000 && $0.share >= Self.warningShare }.max { $0.share < $1.share }
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
    let site = model.scopedSite(navigation)
    // A stack, never a bare Group: a Group with nothing in it hands its task to no view, so the limits were never read.
    VStack(spacing: 0) {
      Color.clear.frame(height: 0)
      if let near = limits.near, let orgID = model.workspace?.org?.id, !dismissed,
        !UserDefaults.standard.bool(forKey: PlanLimits.dismissKey(orgID: orgID, near: near))
      {
        let full = near.used >= near.limit
        VStack(alignment: .leading, spacing: 8) {
          Text("\(site?.name ?? model.workspace?.org?.name ?? "") · \(near.plan) plan")
            .font(.system(size: 12)).foregroundStyle(AglynColor.secondaryText).lineLimit(1)
          HStack(spacing: 8) {
            Text(near.label).font(.system(size: AglynShellMetrics.rowText, weight: .semibold))
              .foregroundStyle(AglynColor.textPrimary).lineLimit(1)
            Spacer(minLength: 0)
            HStack(spacing: 0) {
              Text("\(near.used) / \(near.limit) · ").foregroundStyle(AglynColor.secondaryText)
              Button("Upgrade") { upgrade() }
                .buttonStyle(.plain)
                .foregroundStyle(AglynColor.tint)
                .accessibilityIdentifier("plan-card-upgrade")
            }
            .font(.system(size: AglynShellMetrics.rowText))
            .monospacedDigit()
          }
          // The console's meter: amber from 80%, red at the limit.
          GeometryReader { proxy in
            ZStack(alignment: .leading) {
              Capsule().fill(AglynColor.sunken)
              Capsule().fill(full ? AglynColor.error : AglynColor.intent({ $0.warning }, \.main))
                .frame(width: proxy.size.width * min(1, near.share))
            }
          }
          .frame(height: 6)
          .accessibilityHidden(true)
        }
        .padding(10)
        .background(
          RoundedRectangle(cornerRadius: AglynShellMetrics.cardRadius, style: .continuous).fill(AglynColor.paper))
        .overlay(
          RoundedRectangle(cornerRadius: AglynShellMetrics.cardRadius, style: .continuous).strokeBorder(AglynColor.divider))
        .contextMenu {
          Button("Hide until the next limit", systemImage: "eye.slash") {
            UserDefaults.standard.set(true, forKey: PlanLimits.dismissKey(orgID: orgID, near: near))
            dismissed = true
          }
        }
        .padding(EdgeInsets(top: 0, leading: AglynShellMetrics.rowInset, bottom: 12, trailing: AglynShellMetrics.rowInset))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(near.label), \(near.used) of \(near.limit) on the \(near.plan) plan")
        .accessibilityAction(named: "Upgrade") { upgrade() }
        .accessibilityIdentifier("plan-card")
      }
    }
    .task(id: "\(model.workspace?.org?.id ?? ""):\(site?.id ?? ""):\(model.workspace?.sites.count ?? 0)") {
      dismissed = false
      await limits.load(model, hostID: site?.id)
    }
  }

  /// Billing, at the plans (the console's "Upgrade" link).
  private func upgrade() {
    navigation.enter(.workspaceSettings, first: .plugin("core.billing"))
  }
}

extension AppModel {
  /// Whether the workspace menu offers "Upgrade plan", as the console's menu does: once the plan is known, below the top
  /// plans (Agency, Enterprise), for an owner or admin who can open Billing.
  var offersUpgrade: Bool {
    guard let org = workspace?.org, let plan = workspace?.orgLogos[org.id]?.plan,
      registry.screen("core.billing") != nil
    else { return false }
    return !["agency", "enterprise"].contains(plan) && ["owner", "admin"].contains(org.role)
  }
}
