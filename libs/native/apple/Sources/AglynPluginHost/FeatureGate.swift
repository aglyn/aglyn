// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import SwiftUI

/// A plugin screen behind its plan feature, as the console's shell gates a plugin page (`resolveExtensionEntitlement`),
/// from the console's own resolved answer (`/api/orgs/entitlements`: the plan, its comp, purchased add-ons and per-workspace
/// overrides). While that is read, or if it cannot be, it shows the screen (a refusal is only said from a settled read);
/// once the workspace is known to lack the feature, the console's upgrade notice stands where the screen would be, with View plans (or View
/// add-ons for a feature sold only as an add-on), so the way to buy it is where people look for it (AGL-3966).
public struct AglynFeatureGate<Content: View>: View {
  let context: NativePluginContext
  let feature: String
  let title: String
  let content: Content
  @State private var carried: Bool?

  /// `title` is the console's name for the surface ("CRM", "Events"), which the sentence begins with.
  public init(context: NativePluginContext, feature: String, title: String, @ViewBuilder content: () -> Content) {
    self.context = context
    self.feature = feature
    self.title = title
    self.content = content()
  }

  public var body: some View {
    Group {
      if carried == false {
        let addOn = upgradeNoticeSellsAddOn(feature)
        AglynUpgradeNotice(upgradeNoticeMessage(title: title, feature: feature), kind: addOn ? .addOn : .plan) {
          context.navigate(addOn ? "core.billing.addons" : "core.billing.plans")
        }
        .asScreen()
        .accessibilityIdentifier("feature-gate-\(feature)")
      } else {
        content
      }
    }
    .task(id: context.orgID) {
      guard let orgID = context.orgID else { return }
      carried = await ResolvedFeatures.shared.carries(feature, orgID: orgID, api: context.api)
    }
  }
}

/// The workspace's features as the console resolves them, read once a minute at most per workspace, shared by every gate.
@MainActor
final class ResolvedFeatures {
  static let shared = ResolvedFeatures()
  private var read: [String: (at: Date, features: [String: Bool])] = [:]

  /// Whether the workspace carries the feature; nil when the console could not be asked.
  func carries(_ feature: String, orgID: String, api: ConsoleAPIClient) async -> Bool? {
    if let hit = read[orgID], Date().timeIntervalSince(hit.at) < 60 { return hit.features[feature] ?? false }
    guard let body = try? await api.request("/api/orgs/entitlements", query: [("orgId", orgID)]),
      case .object(let map)? = body["features"]
    else { return nil }
    let features = map.compactMapValues(\.boolValue)
    read[orgID] = (Date(), features)
    return features[feature] ?? false
  }
}
