// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
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
/// The longest answer a write-in can take (`MAX_WRITE_IN_LENGTH`).
let maxWriteInLength = 40
/// A write-in's length when the merchant sets none (`DEFAULT_WRITE_IN_LENGTH`).
let defaultWriteInLength = 20
/// How much of a typed answer is carried before its group checks it (`WRITE_IN_INPUT_BOUND`).
private let writeInInputBound = 200

/// A chosen modifier as a line carries it: names and price as sold.
struct LineModifier: Equatable {
  let groupID: String
  let optionID: String
  let group: String
  let name: String
  let priceCents: Int
  /// A write-in's answer as sold, such as the text to engrave.
  var text: String? = nil
  /// The group's name prints before the choice on the line ("Size: M").
  var nameOnOrder = false
}

/*
 * WRITE-INS (write-ins). A group of `kind: "text"` asks for a typed
 * answer instead of a pick: a name to print, an engraving, a cake message. It holds
 * exactly one option, which prices it and carries its helper note; the pick
 * adds the `text`, which prints on the line as "Engraving: For Sam".
 */

/// A write-in's longest answer (`writeInMaxLength`).
func writeInMaxLength(_ maxLength: Double?) -> Int {
  guard let length = maxLength, isWhole(length), length >= 1, length <= Double(maxWriteInLength) else {
    return defaultWriteInLength
  }
  return Int(length)
}

/// How long an answer reads, as the console counts it (`Array.from(text).length`: code points).
func writeInLength(_ text: String) -> Int { text.unicodeScalars.count }

/// A write-in's answer cleaned for the order (`cleanWriteIn`): control characters and runs of spaces gone, trimmed, cut
/// at the group's length. Empty when nothing is left. Without a group the answer is only bounded, so a too-long one
/// still reaches the check that names it.
func cleanWriteIn(_ raw: String?, maxLength: Double?? = nil) -> String {
  guard let raw else { return "" }
  let limit = maxLength.map { writeInMaxLength($0) } ?? writeInInputBound
  let controls = raw.unicodeScalars.map { scalar -> Character in
    let value = scalar.value
    return value <= 0x1f || (0x7f...0x9f).contains(value) || value == 0x2028 || value == 0x2029 ? " " : Character(scalar)
  }
  let flat = String(controls).replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
    .trimmingCharacters(in: .whitespacesAndNewlines)
  var cut = String.UnicodeScalarView()
  cut.append(contentsOf: flat.unicodeScalars.prefix(limit))
  return String(cut).trimmingCharacters(in: .whitespacesAndNewlines)
}

/// Why a write-in's answer cannot be sold, or nil when it can (`writeInProblem`). An empty answer is the minimum's
/// business.
func writeInProblem(_ group: ProductModifierGroup, _ raw: String?) -> String? {
  let typed = cleanWriteIn(raw)
  if typed.isEmpty { return nil }
  let limit = writeInMaxLength(group.maxLength)
  if writeInLength(typed) > limit { return "\(group.name) takes up to \(limit) characters." }
  if group.digitsOnly == true, typed.range(of: "^[0-9]+$", options: .regularExpression) == nil {
    return "\(group.name) takes numbers only."
  }
  return nil
}

/// The picks a request names, bounded, each write-in's answer cleaned (`modifierSelectionFrom`).
func modifierSelectionFrom(_ picks: [ModifierSelection]) -> [ModifierSelection] {
  picks.prefix(posMaxModifierGroups * posMaxModifierOptions).map { pick in
    let text = cleanWriteIn(pick.text)
    return ModifierSelection(groupId: pick.groupId, optionId: pick.optionId, text: text.isEmpty ? nil : text)
  }
}

private func isWhole(_ value: Double) -> Bool { value.isFinite && value == value.rounded(.down) }

private func priceIsValid(_ cents: Double) -> Bool { isWhole(cents) && cents >= 0 && cents <= Double(posMaxModifierPriceCents) }

/// A choice's price on the picked variant: its price by that variant where it has one, else its own
/// (`modifierOptionPriceCents`). A product with no options sells a `default` variant, which no price list names.
func modifierOptionPriceCents(_ option: ProductModifierOption, variantID: String?) -> Int {
  if let variantID, variantID != "default", let cents = option.priceCentsByVariant?[variantID], cents.isFinite { return Int(cents) }
  return Int(option.priceCents)
}

/// Why groups cannot be used, or nil when they are well formed (`modifierGroupsProblem`).
func modifierGroupsProblem(_ groups: [ProductModifierGroup]) -> String? {
  if groups.count > posMaxModifierGroups { return "At most \(posMaxModifierGroups) modifier groups per product" }
  var groupIDs = Set<String>()
  for group in groups {
    if group.id.isEmpty || !groupIDs.insert(group.id).inserted { return "Modifier groups need unique ids" }
    if group.name.trimmingCharacters(in: .whitespaces).isEmpty { return "Name every modifier group" }
    if let kind = group.kind, kind != "text" { return "“\(group.name)” is a list of choices or a write-in" }
    if group.kind == "text" {
      if group.options.count != 1 { return "“\(group.name)” is a write-in and holds one field" }
      if group.max != 1 || (group.min != 0 && group.min != 1) {
        return "“\(group.name)” is a write-in: required or not, one answer"
      }
      if let length = group.maxLength, !isWhole(length) || length < 1 || length > Double(maxWriteInLength) {
        return "“\(group.name)” takes 1 to \(maxWriteInLength) characters"
      }
    }
    if group.options.isEmpty { return "Add a choice to “\(group.name)”" }
    if group.options.count > posMaxModifierOptions {
      return "“\(group.name)” has more than \(posMaxModifierOptions) choices"
    }
    var optionIDs = Set<String>()
    for option in group.options {
      if option.id.isEmpty || !optionIDs.insert(option.id).inserted { return "Modifier choices need unique ids" }
      if option.name.trimmingCharacters(in: .whitespaces).isEmpty { return "Name every choice in “\(group.name)”" }
      if !priceIsValid(option.priceCents) { return "“\(option.name)” needs a price of $0 to $1,000" }
      if option.priceCentsByVariant?.values.contains(where: { !priceIsValid($0) }) == true {
        return "“\(option.name)” needs a price of $0 to $1,000 for each option it is priced by"
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
  /// A write-in the customer types (`modifierGroupIsWriteIn`).
  var isWriteIn: Bool { kind == "text" }
  /// A write-in's longest answer.
  var writeInLimit: Int { writeInMaxLength(maxLength) }
}

/// A pick as the order keeps it: a choice, or a write-in with its answer (`soldModifier`).
private func soldModifier(_ group: ProductModifierGroup, _ option: ProductModifierOption, variantID: String?, text: String?)
  -> LineModifier
{
  LineModifier(
    groupID: group.id, optionID: option.id, group: group.name, name: option.name,
    priceCents: modifierOptionPriceCents(option, variantID: variantID), text: text?.isEmpty == false ? text : nil,
    nameOnOrder: group.nameOnOrder == true)
}

enum ResolvedModifiers: Equatable {
  case ok([LineModifier], extraCents: Int)
  case refused(String)
}

/// Prices a line's chosen modifiers from the product, in group order, and
/// checks each group's minimum and maximum (`resolveLineModifiers`). A
/// write-in's answer is checked, cleaned and kept.
func resolveLineModifiers(
  _ productName: String, _ groups: [ProductModifierGroup], _ raw: [ModifierSelection], variantID: String? = nil
) -> ResolvedModifiers {
  let usable = usableModifierGroups(groups)
  let picks = modifierSelectionFrom(raw)
  var seen = Set<String>()
  for pick in picks {
    if !seen.insert("\(pick.groupId):\(pick.optionId)").inserted {
      return .refused("A choice on \(productName) was picked twice.")
    }
    guard let group = usable.first(where: { $0.id == pick.groupId }),
      group.options.contains(where: { $0.id == pick.optionId })
    else { return .refused("A choice on \(productName) is no longer offered. Remove it and add it again.") }
  }
  var modifiers: [LineModifier] = []
  for group in usable {
    if group.isWriteIn {
      let option = group.options[0]
      let pick = picks.first { $0.groupId == group.id && $0.optionId == option.id }
      if let problem = writeInProblem(group, pick?.text) { return .refused("\(problem) (\(productName))") }
      let text = cleanWriteIn(pick?.text, maxLength: group.maxLength)
      if text.isEmpty {
        if group.min > 0 { return .refused("Fill in \(group.name.lowercased()) for \(productName).") }
        continue
      }
      modifiers.append(soldModifier(group, option, variantID: variantID, text: text))
      continue
    }
    let chosen = group.options.filter { option in
      picks.contains { $0.groupId == group.id && $0.optionId == option.id }
    }
    if Double(chosen.count) < group.min { return .refused("Choose \(group.name.lowercased()) for \(productName).") }
    if Double(chosen.count) > group.max {
      return .refused("Choose at most \(Int(group.max)) for \(group.name.lowercased()) on \(productName).")
    }
    modifiers += chosen.map { soldModifier(group, $0, variantID: variantID, text: nil) }
  }
  return .ok(modifiers, extraCents: modifiers.reduce(0) { $0 + $1.priceCents })
}

/// The modifiers a PAID line names (`soldLineModifiers`): every pick the product still offers, in group order, priced
/// as it is now, with no minimum or maximum asked.
func soldLineModifiers(_ groups: [ProductModifierGroup], _ raw: [ModifierSelection], variantID: String? = nil) -> [LineModifier] {
  let picks = modifierSelectionFrom(raw)
  var modifiers: [LineModifier] = []
  for group in usableModifierGroups(groups) {
    for option in group.options {
      guard let pick = picks.first(where: { $0.groupId == group.id && $0.optionId == option.id }) else { continue }
      let text = group.isWriteIn ? cleanWriteIn(pick.text, maxLength: group.maxLength) : nil
      if group.isWriteIn && text?.isEmpty != false { continue }
      modifiers.append(soldModifier(group, option, variantID: variantID, text: text))
    }
  }
  return modifiers
}

/// How one modifier prints on a line (`modifierLineText`): its name (`Oat milk`), its group and name when the group
/// asks for it (`Size: M`), or a write-in's name and answer (`Engraving: For Sam`).
func modifierLineText(name: String, group: String?, text: String?, nameOnOrder: Bool?) -> String {
  if let text, !text.isEmpty { return "\(group?.isEmpty == false ? group! : name): \(text)" }
  if nameOnOrder == true, let group, !group.isEmpty { return "\(group): \(name)" }
  return name
}

extension LineModifier {
  /// How the modifier prints on its line (`modifierLineText`).
  var lineText: String { modifierLineText(name: name, group: group, text: text, nameOnOrder: nameOnOrder) }
  /// The pick a priced line keeps (`modifierSelectionOf`).
  var selection: ModifierSelection { ModifierSelection(groupId: groupID, optionId: optionID, text: text) }
}

extension OrderLineModifier {
  /// How the modifier prints on its line (`modifierLineText`).
  var lineText: String { modifierLineText(name: name, group: group, text: text, nameOnOrder: nameOnOrder) }
}

/// The label a line prints: the variant, then each modifier (`Large / Oat milk, Extra shot`).
func lineLabelWithModifiers(_ variantLabel: String?, _ modifierNames: [String]) -> String {
  [variantLabel?.isEmpty == false ? variantLabel : nil, modifierNames.isEmpty ? nil : modifierNames.joined(separator: ", ")]
    .compactMap { $0 }.joined(separator: " / ")
}

/// Two lines merge only when they are the same item with the same choices: two answers are two lines.
func modifierSelectionKey(_ selection: [ModifierSelection]) -> String {
  selection.map { pick in
    if let text = pick.text, !text.isEmpty { return "\(pick.groupId):\(pick.optionId)=\(text)" }
    return "\(pick.groupId):\(pick.optionId)"
  }.sorted().joined(separator: "|")
}

/// A pick as JSON for the server (`groupId`, `optionId` and a write-in's `text`).
func modifierSelectionJSON(_ pick: ModifierSelection) -> JSONValue {
  var record: [String: JSONValue] = ["groupId": .string(pick.groupId), "optionId": .string(pick.optionId)]
  if let text = pick.text, !text.isEmpty { record["text"] = .string(text) }
  return .object(record)
}

/// The picks with a write-in's answer replaced (`withWriteInAnswer`): the text as typed so far, kept while it is being
/// typed; an empty answer leaves the group unanswered. The server cleans and checks it.
func withWriteInAnswer(
  _ groups: [ProductModifierGroup], _ value: [ModifierSelection], group: ProductModifierGroup, text: String
) -> [ModifierSelection] {
  let others = value.filter { $0.groupId != group.id }
  let answer =
    group.options.first.flatMap { option in
      text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        ? nil : ModifierSelection(groupId: group.id, optionId: option.id, text: text)
    }
  let order = Dictionary(groups.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { first, _ in first })
  return (others + (answer.map { [$0] } ?? [])).enumerated()
    .sorted { (order[$0.element.groupId] ?? 0, $0.offset) < (order[$1.element.groupId] ?? 0, $1.offset) }
    .map(\.element)
}
