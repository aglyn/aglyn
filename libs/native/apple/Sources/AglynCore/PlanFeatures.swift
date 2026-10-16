// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

private let deadSubscriptionStatuses: Set<String> = ["canceled", "unpaid", "incomplete", "incomplete_expired"]

/// The plan a workspace's entitlements resolve from, as the console's `resolveEffectivePlan`: a comp
/// when no subscription is live, else the stored plan, which a dead subscription takes back to free.
public func effectivePlan(_ org: [String: Any]?) -> String {
  let mirrored = org?["billingStatus"] as? String
  let status = (mirrored?.isEmpty == false ? mirrored : nil) ?? ((org?["subscription"] as? [String: Any])?["status"] as? String)
  let live = status.map { !$0.isEmpty && !deadSubscriptionStatuses.contains($0) } ?? false
  if !live, let comp = ((org?["entitlements"] as? [String: Any])?["planComp"] as? [String: Any])?["plan"] as? String,
    comp != "free", PlanFeatureDefaults.byPlan[comp] != nil
  {
    return comp
  }
  guard let plan = org?["plan"] as? String, PlanFeatureDefaults.byPlan[plan] != nil else { return "free" }
  if plan != "free", let status, deadSubscriptionStatuses.contains(status) { return "free" }
  return plan
}

/// Whether the workspace carries a plan feature, as the console's `checkEntitlement` answers for the
/// features native screens gate on: a per-org override first, else the effective plan's default.
public func planFeatureCarried(_ org: [String: Any]?, _ feature: String) -> Bool {
  if let override = ((org?["entitlements"] as? [String: Any])?["features"] as? [String: Any])?[feature] as? Bool { return override }
  return PlanFeatureDefaults.byPlan[effectivePlan(org)]?[feature] ?? false
}

/// The marketplace's take rate on a workspace's sales, as the console's `resolveMarketplaceFeePct` answers it: a per-org
/// override when it is a number, else the effective plan's rate; a rate that is not a usable percentage is priced at the
/// Free plan's (the conservative direction). A comp lifts caps, never a price.
public func marketplaceFeePct(_ org: [String: Any]?) -> Double {
  func usable(_ value: Double?) -> Double? { value.flatMap { $0.isFinite && $0 >= 0 && $0 <= 100 ? $0 : nil } }
  let override = (org?["entitlements"] as? [String: Any])?["marketplaceFeePct"]
  // A JSON `true` bridges to NSNumber too; only a real number is an override, as the console's `typeof` reads it.
  let number = (override as? NSNumber).flatMap { CFGetTypeID($0) == CFBooleanGetTypeID() ? nil : $0.doubleValue }
  let rate = number != nil ? usable(number) : usable(MarketplaceFeeDefaults.byPlan[effectivePlan(org)])
  return rate ?? MarketplaceFeeDefaults.byPlan["free"] ?? 30
}
