// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

// The funnels plugin's pure rules, ported once from its model
// (funnel-definition.ts, funnel-inventory.ts, drop-off.ts, funnel-format.ts)
// and held to the console's own answers by the function cases. A native
// editor checks a funnel as the save route does, and a result reads as the
// Funnels card reads it. The route checks again; these exist so a person is
// told before the round trip. The Kotlin kit's `FunnelRules.kt` is the same.

/// Every step type a person can pick, in the console editor's order.
public let funnelStepTypes: [SiteJourneyStepType] = [.page, .form, .booking, .cart, .order, .overlay, .event, .email]

/// The keys an `email` step carries.
public let funnelEmailKeys = ["opened", "clicked"]

/// What a step type is called in the editor and the results (`FUNNEL_STEP_TYPE_LABELS`).
public func funnelStepTypeLabel(_ type: SiteJourneyStepType) -> String {
  ContractValues.shared.funnelStepTypeLabels[type.rawValue] ?? type.rawValue
}

/// A step as typed in an editor, before any check.
public struct FunnelStepInput: Equatable, Sendable {
  public var type: String?
  public var key: String?
  public var match: String?
  public var label: String?

  public init(type: String?, key: String? = nil, match: String? = nil, label: String? = nil) {
    self.type = type
    self.key = key
    self.match = match
    self.label = label
  }
}

/// A cleaned funnel, or the first reason it cannot be saved.
public struct FunnelCheck: Equatable, Sendable {
  public var funnel: FunnelDefinition?
  public var error: String?

  public init(funnel: FunnelDefinition? = nil, error: String? = nil) {
    self.funnel = funnel
    self.error = error
  }
}

private func jsTrim(_ text: String) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

/// `String.prototype.slice(0, n)`, counting characters.
private func jsPrefix(_ text: String, _ count: Int) -> String { String(text.prefix(count)) }

/// A path with no query, no fragment and no trailing slash (except `/`).
public func normalizeFunnelPath(_ raw: String) -> String {
  var path = jsTrim(raw)
  if let cut = path.firstIndex(where: { $0 == "?" || $0 == "#" }) { path = String(path[..<cut]) }
  if !path.hasPrefix("/") { path = "/" + path }
  while path.contains("//") { path = path.replacingOccurrences(of: "//", with: "/") }
  if path.count > 1 {
    while path.hasSuffix("/") { path.removeLast() }
    if path.isEmpty { path = "/" }
  }
  return jsPrefix(path, ContractValues.shared.siteJourneyKeyMax)
}

private func isEventName(_ key: String) -> Bool {
  guard key.count >= 1, key.count <= 40, let first = key.unicodeScalars.first,
    ("a"..."z").contains(first)
  else { return false }
  return key.unicodeScalars.allSatisfy { ("a"..."z").contains($0) || ("0"..."9").contains($0) || $0 == "_" }
}

private let anyAllowed: Set<SiteJourneyStepType> = [.form, .booking, .cart, .order, .overlay]

/// One step, cleaned, or the reason it cannot be a step.
public func normalizeFunnelStep(_ input: FunnelStepInput) -> (step: FunnelStep?, error: String?) {
  guard let type = funnelStepTypes.first(where: { $0.rawValue == input.type }) else {
    return (nil, "Pick what the step is.")
  }
  var key = jsPrefix(jsTrim(input.key ?? ""), ContractValues.shared.siteJourneyKeyMax)
  let rawLabel = jsPrefix(jsTrim(input.label ?? ""), ContractValues.shared.funnelLabelMax)
  let label: String? = rawLabel.isEmpty ? nil : rawLabel
  switch type {
  case .page:
    if key.isEmpty { return (nil, "A page step needs a path.") }
    key = normalizeFunnelPath(key)
    let match: FunnelPageMatch = input.match == "prefix" ? .prefix : .exact
    return (FunnelStep(key: key, label: label, match: match, type: type), nil)
  case .order:
    return (FunnelStep(key: "", label: label, type: type), nil)
  case .email:
    if !funnelEmailKeys.contains(key) { return (nil, "An email step is an email opened or a link in it clicked.") }
    return (FunnelStep(key: key, label: label, type: type), nil)
  case .event:
    if !isEventName(key) {
      return (nil, "A custom event step needs the event\u{2019}s name, as the interaction sends it.")
    }
  default:
    if key.isEmpty, !anyAllowed.contains(type) { return (nil, "Pick what the step names.") }
  }
  return (FunnelStep(key: key, label: label, type: type), nil)
}

/// A whole definition, cleaned, or the first reason it cannot be saved.
public func normalizeFunnelDefinition(name: String?, steps: [FunnelStepInput]) -> FunnelCheck {
  let clean = jsPrefix(jsTrim(name ?? ""), ContractValues.shared.funnelNameMax)
  if clean.isEmpty { return FunnelCheck(error: "Name the funnel.") }
  let low = ContractValues.shared.funnelMinSteps
  let high = ContractValues.shared.funnelMaxSteps
  if steps.count < low || steps.count > high { return FunnelCheck(error: "A funnel has \(low) to \(high) steps.") }
  var cleaned: [FunnelStep] = []
  for (index, input) in steps.enumerated() {
    let result = normalizeFunnelStep(input)
    guard let step = result.step else { return FunnelCheck(error: "Step \(index + 1): \(result.error ?? "")") }
    cleaned.append(step)
  }
  return FunnelCheck(funnel: FunnelDefinition(name: clean, steps: cleaned))
}

/// The words a result shows for a step: its label, else a description.
public func funnelStepTitle(_ step: FunnelStep) -> String {
  if let label = step.label, !label.isEmpty { return label }
  let what = funnelStepTypeLabel(step.type)
  switch step.type {
  case .page: return step.match == .prefix ? "\(what): \(step.key) and below" : "\(what): \(step.key)"
  case .order: return what
  case .email: return "\(what): \(ContractValues.shared.funnelEmailKeyLabels[step.key] ?? step.key)"
  default: return step.key.isEmpty ? "\(what) (any)" : "\(what): \(step.key)"
  }
}

/// The inventory list a step type picks from, or nil for types with none.
public func funnelInventoryList(_ inventory: FunnelInventory, _ type: SiteJourneyStepType) -> [FunnelInventoryItem]? {
  switch type {
  case .form: inventory.forms
  case .booking: inventory.services
  case .cart: inventory.products
  case .overlay: inventory.overlays
  default: nil
  }
}

/// Why a step names something the site does not have, or nil.
public func stepInventoryProblem(_ step: FunnelStep, _ inventory: FunnelInventory) -> String? {
  if step.type == .page {
    if step.match == .prefix {
      let covered = step.key == "/" || inventory.pages.contains { $0 == step.key || $0.hasPrefix(step.key + "/") }
      return covered ? nil : "No page on this site is at or under \(step.key)."
    }
    return inventory.pages.contains(step.key) ? nil : "This site has no page at \(step.key)."
  }
  guard let list = funnelInventoryList(inventory, step.type), !step.key.isEmpty else { return nil }
  if list.contains(where: { $0.id == step.key }) { return nil }
  var bare = step
  bare.label = nil
  return "\(funnelStepTitle(bare)) is not on this site."
}

/// A step's label from the inventory, when the step has none of its own.
public func labelStepFromInventory(_ step: FunnelStep, _ inventory: FunnelInventory) -> FunnelStep {
  if let label = step.label, !label.isEmpty { return step }
  guard let item = funnelInventoryList(inventory, step.type)?.first(where: { $0.id == step.key }) else { return step }
  var labelled = step
  labelled.label = item.name
  return labelled
}

/// How a wait reads: "1 hour", "3 days".
public func waitLabel(_ hours: Int) -> String {
  if hours % 24 == 0 {
    let days = hours / 24
    return days == 1 ? "1 day" : "\(days) days"
  }
  return hours == 1 ? "1 hour" : "\(hours) hours"
}

private func jsRound(_ value: Double) -> Int { Int((value + 0.5).rounded(.down)) }

/// A share (0-1) as the card reads it: `33.3%`, or a dash for none.
public func formatShare(_ value: Double?) -> String {
  guard let value else { return "\u{2014}" }
  let rounded = Double(jsRound(value * 1000)) / 10
  return rounded == rounded.rounded() ? "\(Int(rounded))%" : "\(rounded)%"
}

/// A duration as a person reads it: `45s`, `3m 05s`, `2h 10m`, `3d 4h`.
public func formatDuration(_ ms: Double?) -> String {
  guard let ms else { return "\u{2014}" }
  let seconds = jsRound(ms / 1000)
  if seconds < 60 { return "\(seconds)s" }
  let minutes = seconds / 60
  if minutes < 60 { return "\(minutes)m \(String(format: "%02d", seconds % 60))s" }
  let hours = minutes / 60
  if hours < 48 { return "\(hours)h \(minutes % 60)m" }
  return "\(hours / 24)d \(hours % 24)h"
}
