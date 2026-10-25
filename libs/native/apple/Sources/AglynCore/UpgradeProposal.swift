// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// The plan the platform team proposed for a workspace (`upgradeProposal` on the org document, AGL-3466), read the way
/// the console's `standingUpgradeProposal` reads it (libs/aglyn/src/lib/app-utils/upgrade-proposal.ts): only a
/// self-serve paid plan, and only while no subscription is live; its add-ons, cadence and code normalized as
/// `normalizeUpgradeProposalBundle` does, from the generated `BundleWords`. The workspace Home's card shows it to the
/// people who may buy it (AGL-4011). The Kotlin twin is `UpgradeProposal.kt`; both replay the console's answers in
/// derived-values.generated.json.
public struct UpgradeProposal: Equatable, Sendable {
  public let plan: String
  public let note: String?
  /// Each add-on kind and how many, as the plan sells them.
  public let addons: [String: Int]
  /// `month` or `year` when the proposal named a cadence.
  public let interval: String?
  public let coupon: String?
  /// The Aglyn AI tier, named with the AI add-on.
  public let aiTier: String?

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
    let parsed = parseAddons(raw["addons"])
    let addons = fit(parsed.addons, plan: plan)
    let interval = (raw["interval"] as? String).flatMap { $0 == "month" || $0 == "year" ? $0 : nil }
    let aiTier: String? =
      (addons["aiAddon"] ?? 0) > 0
      ? ((raw["aiTier"] as? String).flatMap { BundleWords.aiTierNames[$0] != nil ? $0 : nil } ?? parsed.aiTier) : nil
    return UpgradeProposal(
      plan: plan, note: note?.isEmpty == false ? String(note!.prefix(500)) : nil, addons: addons, interval: interval,
      coupon: normalizeCoupon(raw["coupon"]), aiTier: aiTier)
  }

  /// `parseBundleAddons` over a stored object: each key the parser knows, its quantity (a 0/1 kind counts once).
  static func parseAddons(_ input: Any?) -> (addons: [String: Int], aiTier: String?) {
    var addons: [String: Int] = [:]
    var tier: String?
    guard let object = input as? [String: Any] else { return ([:], nil) }
    for (name, value) in object.sorted(by: { $0.key < $1.key }) {
      if value is NSNull { continue }
      if let flag = value as? Bool, !flag { continue }
      var quantityText = ""
      if let text = value as? String {
        if text.isEmpty || text == "false" || text == "0" { continue }
        if text != "true" { quantityText = text }
      } else if let number = value as? NSNumber, !(value is Bool) {
        if number.doubleValue == 0 { continue }
        quantityText = number.stringValue
      }
      guard let kind = BundleWords.tokens[name.trimmingCharacters(in: .whitespaces).lowercased()] else { continue }
      let toggle = BundleWords.toggles.contains(kind)
      if quantityText.isEmpty {
        addons[kind] = max(addons[kind] ?? 0, 1)
      } else if quantityText.allSatisfy(\.isNumber), let count = Int(quantityText.prefix(9)) {
        let quantity = min(999, count)
        if quantity >= 1 { addons[kind] = max(addons[kind] ?? 0, toggle ? 1 : quantity) }
      } else if kind == "aiAddon", BundleWords.aiTierNames[quantityText.lowercased()] != nil {
        addons[kind] = max(addons[kind] ?? 0, 1)
        if tier == nil { tier = quantityText.lowercased() }
      }
    }
    return (addons, tier)
  }

  /// `fitBundleAddonsToPlan`: each kind the plan sells, at most what it sells.
  static func fit(_ addons: [String: Int], plan: String) -> [String: Int] {
    var fitted: [String: Int] = [:]
    for kind in BundleWords.kinds {
      let wanted = addons[kind] ?? 0
      let most = BundleWords.planMax[plan]?[kind] ?? 0
      if wanted > 0 && most > 0 { fitted[kind] = min(wanted, most) }
    }
    return fitted
  }

  /// `normalizeBundleCoupon`: a code as a link carries it, or nil.
  static func normalizeCoupon(_ raw: Any?) -> String? {
    guard let code = (raw as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !code.isEmpty, code.count <= 64,
      code.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil
    else { return nil }
    return code
  }

  /// "Starter with Site Care and Aglyn AI, billed yearly, code BOOTH25" (`describeBundle`).
  public var summary: String {
    let parts = BundleWords.kinds.compactMap { kind -> String? in
      let quantity = addons[kind] ?? 0
      guard quantity > 0 else { return nil }
      let label = kind == "aiAddon" ? aiTier.flatMap { BundleWords.aiTierNames[$0] } ?? BundleWords.labels[kind] ?? kind : BundleWords.labels[kind] ?? kind
      return quantity > 1 ? "\(quantity) × \(label)" : label
    }
    let joined =
      parts.isEmpty ? "" : parts.count == 1 ? " with \(parts[0])" : " with \(parts.dropLast().joined(separator: ", ")) and \(parts.last!)"
    let cadence = interval == "year" ? ", billed yearly" : interval == "month" ? ", billed monthly" : ""
    return "\(planLabel)\(joined)\(cadence)\(coupon.map { ", code \($0)" } ?? "")"
  }

  var planLabel: String { BundleWords.planLabels[plan] ?? plan }

  /// Billing will have chosen a whole bundle, not just the plan: the card names it.
  public var bundled: Bool { summary != planLabel }

  /// "Acme's Aglyn team proposed the Starter plan" (`upgradeProposalHeadline`).
  public func headline(orgName: String?, productName: String) -> String {
    let workspace = orgName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let team = workspace.isEmpty ? "Your \(productName) team" : "\(workspace)'s \(productName) team"
    return "\(team) proposed the \(planLabel) plan"
  }

  /// The card's sentence: Billing has the plan (or the whole bundle) chosen, and nothing changes until they buy.
  public var body: String {
    "When you are ready, start the subscription from Billing, where the \(bundled ? "whole bundle is" : "plan is") already selected. Nothing changes until you do."
  }

  /// Billing with the plan chosen (`upgradeProposalDestination`).
  public func destination(orgSlug: String) -> String {
    OnboardingPlanIntent(
      plan: plan, interval: interval ?? "month", intervalStated: interval != nil, contactSales: false,
      ai: (addons["aiAddon"] ?? 0) > 0
    ).destination(orgSlug: orgSlug)
  }
}
