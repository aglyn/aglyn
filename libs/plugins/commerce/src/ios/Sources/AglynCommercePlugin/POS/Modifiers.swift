// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import Foundation

/*
 * Register modifiers (`product-modifiers.ts`): choices added to an item as it
 * is rung up ("Oat milk", "Extra shot +$1.00") that are not stocked variants.
 * The register sends only the chosen option ids; the SERVER prices them from
 * the product, so the figures here are a preview checked by the same rules.
 */

let posMaxModifierGroups = 10
let posMaxModifierOptions = 20
let posMaxModifierPriceCents = 100_000

/// A chosen modifier as a line carries it: names and price as sold.
struct LineModifier: Equatable {
  let groupID: String
  let optionID: String
  let group: String
  let name: String
  let priceCents: Int
}

private func isWhole(_ value: Double) -> Bool { value.isFinite && value == value.rounded(.down) }

/// Why groups cannot be used, or nil when they are well formed (`modifierGroupsProblem`).
func modifierGroupsProblem(_ groups: [ProductModifierGroup]) -> String? {
  if groups.count > posMaxModifierGroups { return "At most \(posMaxModifierGroups) modifier groups per product" }
  var groupIDs = Set<String>()
  for group in groups {
    if group.id.isEmpty || !groupIDs.insert(group.id).inserted { return "Modifier groups need unique ids" }
    if group.name.trimmingCharacters(in: .whitespaces).isEmpty { return "Name every modifier group" }
    if group.options.isEmpty { return "Add a choice to “\(group.name)”" }
    if group.options.count > posMaxModifierOptions {
      return "“\(group.name)” has more than \(posMaxModifierOptions) choices"
    }
    var optionIDs = Set<String>()
    for option in group.options {
      if option.id.isEmpty || !optionIDs.insert(option.id).inserted { return "Modifier choices need unique ids" }
      if option.name.trimmingCharacters(in: .whitespaces).isEmpty { return "Name every choice in “\(group.name)”" }
      if !isWhole(option.priceCents) || option.priceCents < 0 || option.priceCents > Double(posMaxModifierPriceCents) {
        return "“\(option.name)” needs a price of $0 to $1,000"
      }
    }
    if !isWhole(group.min) || group.min < 0 { return "“\(group.name)” needs a minimum of 0 or more" }
    if !isWhole(group.max) || group.max < 1 || group.max > Double(group.options.count) {
      return "“\(group.name)” allows 1 to \(group.options.count) choices"
    }
    if group.min > group.max { return "“\(group.name)” requires more choices than it allows" }
  }
  return nil
}

/// The product's groups, or none when they are malformed.
func usableModifierGroups(_ groups: [ProductModifierGroup]) -> [ProductModifierGroup] {
  modifierGroupsProblem(groups) == nil ? groups : []
}

extension ProductModifierGroup {
  var isRequired: Bool { min > 0 }
  /// Pick one (radio) rather than pick several (checkboxes).
  var isSingle: Bool { Int(max) == 1 }
}

enum ResolvedModifiers: Equatable {
  case ok([LineModifier], extraCents: Int)
  case refused(String)
}

/// Prices a line's chosen modifiers from the product, in group order, and
/// checks each group's minimum and maximum (`resolveLineModifiers`).
func resolveLineModifiers(
  _ productName: String, _ groups: [ProductModifierGroup], _ picks: [ModifierSelection]
) -> ResolvedModifiers {
  let usable = usableModifierGroups(groups)
  var seen = Set<String>()
  for pick in picks.prefix(posMaxModifierGroups * posMaxModifierOptions) {
    if !seen.insert("\(pick.groupId):\(pick.optionId)").inserted {
      return .refused("A choice on \(productName) was picked twice.")
    }
    guard let group = usable.first(where: { $0.id == pick.groupId }),
      group.options.contains(where: { $0.id == pick.optionId })
    else { return .refused("A choice on \(productName) is no longer offered. Remove it and add it again.") }
  }
  var modifiers: [LineModifier] = []
  for group in usable {
    let chosen = group.options.filter { option in
      picks.contains { $0.groupId == group.id && $0.optionId == option.id }
    }
    if Double(chosen.count) < group.min { return .refused("Choose \(group.name.lowercased()) for \(productName).") }
    if Double(chosen.count) > group.max {
      return .refused("Choose at most \(Int(group.max)) for \(group.name.lowercased()) on \(productName).")
    }
    modifiers += chosen.map {
      LineModifier(groupID: group.id, optionID: $0.id, group: group.name, name: $0.name, priceCents: Int($0.priceCents))
    }
  }
  return .ok(modifiers, extraCents: modifiers.reduce(0) { $0 + $1.priceCents })
}

/// The label a line prints: the variant, then each modifier (`Large / Oat milk, Extra shot`).
func lineLabelWithModifiers(_ variantLabel: String?, _ modifierNames: [String]) -> String {
  [variantLabel?.isEmpty == false ? variantLabel : nil, modifierNames.isEmpty ? nil : modifierNames.joined(separator: ", ")]
    .compactMap { $0 }.joined(separator: " / ")
}

/// Two lines merge only when they are the same item with the same choices.
func modifierSelectionKey(_ selection: [ModifierSelection]) -> String {
  selection.map { "\($0.groupId):\($0.optionId)" }.sorted().joined(separator: "|")
}
