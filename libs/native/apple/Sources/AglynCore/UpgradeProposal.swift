// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// The plan the platform team proposed for a workspace (`upgradeProposal` on the org document, AGL-3466), read the way
/// the console's `standingUpgradeProposal` reads it (libs/aglyn/src/lib/app-utils/upgrade-proposal.ts): only a
/// self-serve paid plan, and only while no subscription is live. The workspace Home's card shows it to the people who
/// may buy it (AGL-4011). The Kotlin twin is `UpgradeProposal.kt`.
public struct UpgradeProposal: Equatable, Sendable {
  public let plan: String
  public let note: String?
  /// `month` or `year` when the proposal named a cadence.
  public let interval: String?
  /// The proposal carries add-ons, a cadence or a coupon beside the plan: Billing will have chosen a whole bundle.
  public let bundled: Bool
  /// The AI add-on is part of it.
  public let ai: Bool

  /// The subscription statuses that mean one is live (`LIVE_SUBSCRIPTION_STATUSES`).
  static let liveStatuses: Set<String> = ["active", "trialing", "past_due"]

  /// The proposal that stands for this org document, or nil.
  public static func standing(_ org: [String: Any]?) -> UpgradeProposal? {
    guard let org else { return nil }
    if let status = org["billingStatus"] as? String, liveStatuses.contains(status) { return nil }
    guard let raw = org["upgradeProposal"] as? [String: Any], let plan = raw["plan"] as? String,
      OnboardingPlanIntent.selfServePlans.contains(plan)
    else { return nil }
    let note = (raw["note"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    let interval = (raw["interval"] as? String).flatMap { $0 == "month" || $0 == "year" ? $0 : nil }
    let addons = (raw["addons"] as? [String: Any] ?? [:]).values.contains { (($0 as? NSNumber)?.doubleValue ?? 0) > 0 }
    let coupon = (raw["coupon"] as? String).map { !$0.isEmpty } ?? false
    let ai = ((raw["addons"] as? [String: Any])?["aiAddon"] as? NSNumber)?.doubleValue ?? 0 > 0
    return UpgradeProposal(
      plan: plan, note: note?.isEmpty == false ? String(note!.prefix(500)) : nil, interval: interval,
      bundled: addons || interval != nil || coupon, ai: ai)
  }

  /// "Acme's Aglyn team proposed the Starter plan" (`upgradeProposalHeadline`).
  public func headline(orgName: String?, productName: String) -> String {
    let workspace = orgName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let team = workspace.isEmpty ? "Your \(productName) team" : "\(workspace)'s \(productName) team"
    return "\(team) proposed the \(OnboardingPlanIntent.planLabels[plan] ?? plan.capitalized) plan"
  }

  /// The card's sentence: Billing has the plan (or the whole bundle) chosen, and nothing changes until they buy.
  public var body: String {
    "When you are ready, start the subscription from Billing, where the \(bundled ? "whole bundle is" : "plan is") already selected. Nothing changes until you do."
  }

  /// Billing with the plan chosen (`upgradeProposalDestination`).
  public func destination(orgSlug: String) -> String {
    OnboardingPlanIntent(
      plan: plan, interval: interval ?? "month", intervalStated: interval != nil, contactSales: false, ai: ai
    ).destination(orgSlug: orgSlug)
  }
}
