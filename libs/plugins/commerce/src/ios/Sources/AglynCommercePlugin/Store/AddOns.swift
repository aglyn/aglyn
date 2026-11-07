// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation

/*
 * A product's add-ons (AGL-4100), as the console's editor makes them
 * (product-add-ons-fields.component.tsx) and the Kotlin kit's AddOns.kt:
 * groups of choices that are added to the item and need no stock of their
 * own, each free or adding to the price, and costing more on a larger size
 * where the product has sizes. A group is offered at the register always, and
 * on the product's page on the website when "Show on the website" is on, which
 * a new group starts with.
 *
 * A draft keeps prices as typed. On save each group and choice is written over
 * its stored record, so what the apps do not edit (a choice's picture, its
 * note, what a combo includes) is kept as it was.
 */

/// One choice as the editor holds it: its prices in dollars as typed, the per-variant ones by variant id.
struct AddOnChoiceDraft: Identifiable, Equatable {
  var id: String
  var name = ""
  var price = ""
  var byVariant: [String: String] = [:]
  /// Its picture card (AGL-4205): a picture from the media library, a short note, and what a combo includes, one per
  /// line as typed.
  var imageUrl = ""
  var note = ""
  var includes = ""

  /// The choice with its price on one variant set, or cleared to the choice's own price when left empty.
  func withVariantPrice(_ variantID: String, _ text: String) -> AddOnChoiceDraft {
    var copy = self
    if text.trimmingCharacters(in: .whitespaces).isEmpty { copy.byVariant.removeValue(forKey: variantID) } else {
      copy.byVariant[variantID] = text
    }
    return copy
  }
}

/// A choice's note, at most this long (the console's `PRODUCT_CHOICE_NOTE_MAX`).
let productChoiceNoteMax = 160
/// What a combo includes: at most this many items (`PRODUCT_COMBO_MAX_ITEMS`), each at most this long
/// (`PRODUCT_COMBO_ITEM_MAX`).
let productComboMaxItems = 12
let productComboItemMax = 80

/// What a combo includes as stored, as the console's `withChoiceCard` reads the typed lines: trimmed, cut, blanks
/// dropped, at most 12.
func comboItems(_ text: String) -> [String] {
  Array(
    text.components(separatedBy: "\n").map { String($0.trimmingCharacters(in: .whitespaces).prefix(productComboItemMax)) }
      .filter { !$0.isEmpty }.prefix(productComboMaxItems))
}

/// One group as the editor holds it. `online` absent reads as register only, as the console reads it.
struct AddOnGroupDraft: Identifiable, Equatable {
  var id: String
  var name = ""
  var min = 0
  var max = 1
  var online: Bool?
  var choices: [AddOnChoiceDraft] = []

  var required: Bool { min > 0 }

  func withChoiceAdded(mintID: (String) -> String = newAddOnID) -> AddOnGroupDraft {
    guard choices.count < posMaxModifierOptions else { return self }
    var copy = self
    copy.choices.append(AddOnChoiceDraft(id: mintID("o")))
    return copy
  }

  /// The group without choice `index`; "at most" never asks for more choices than are left.
  func withChoiceRemoved(_ index: Int) -> AddOnGroupDraft {
    var copy = self
    copy.choices.remove(at: index)
    copy.max = Swift.max(1, Swift.min(max, copy.choices.count))
    copy.min = Swift.min(min, copy.choices.count)
    return copy
  }
}

func newAddOnID(_ prefix: String) -> String {
  prefix + String(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(8))
}

/// A new group, as the console makes one: optional, pick one, shown on the website, with one empty choice.
func newAddOnGroup(mintID: (String) -> String = newAddOnID) -> AddOnGroupDraft {
  let id = mintID("g")
  return AddOnGroupDraft(id: id, online: true, choices: [AddOnChoiceDraft(id: mintID("o"))])
}

/// "Price by size" where the product varies by one option, else "Price by variant", as the console says it.
func priceByLabel(_ options: [OptionDraft]) -> String {
  let named = options.filter { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty }
  return named.count == 1 ? "Price by \(named[0].name.trimmingCharacters(in: .whitespaces).lowercased())" : "Price by variant"
}

private func dollarsText(_ cents: Any?) -> String {
  guard let number = cents as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue > 0 else { return "" }
  return amountText(Int(number.doubleValue.rounded()))
}

/// The add-ons a stored product has, as drafts.
func addOnDrafts(_ data: [String: Any]) -> [AddOnGroupDraft] {
  (data["modifierGroups"] as? [Any] ?? []).compactMap { entry in
    guard let group = entry as? [String: Any], let id = group["id"] as? String else { return nil }
    return AddOnGroupDraft(
      id: id, name: group["name"] as? String ?? "", min: (group["min"] as? NSNumber)?.intValue ?? 0,
      max: (group["max"] as? NSNumber)?.intValue ?? 1, online: group["online"] as? Bool,
      choices: (group["options"] as? [Any] ?? []).compactMap { raw in
        guard let option = raw as? [String: Any], let choiceID = option["id"] as? String else { return nil }
        let byVariant = (option["priceCentsByVariant"] as? [String: Any] ?? [:]).mapValues { value in
          let text = dollarsText(value)
          return text.isEmpty ? "0.00" : text
        }
        return AddOnChoiceDraft(
          id: choiceID, name: option["name"] as? String ?? "", price: dollarsText(option["priceCents"]), byVariant: byVariant,
          imageUrl: option["imageUrl"] as? String ?? "", note: option["note"] as? String ?? "",
          includes: (option["includes"] as? [Any] ?? []).compactMap { $0 as? String }.joined(separator: "\n"))
      })
  }
}

/// Cents from a typed price: empty is free; anything else must be a number of dollars.
private func addOnCents(_ text: String) -> Double? {
  text.trimmingCharacters(in: .whitespaces).isEmpty ? 0 : centsFromText(text).map(Double.init)
}

/// The groups as the contract holds them; a price that is not a number reads as -1, which the check refuses.
func addOnGroups(_ drafts: [AddOnGroupDraft]) -> [ProductModifierGroup] {
  drafts.map { group in
    ProductModifierGroup(
      id: group.id, max: Double(group.max), min: Double(group.min), name: group.name, online: group.online,
      options: group.choices.map { choice in
        let byVariant = choice.byVariant.filter { !$0.value.trimmingCharacters(in: .whitespaces).isEmpty }
          .mapValues { addOnCents($0) ?? -1 }
        return ProductModifierOption(
          id: choice.id, name: choice.name, priceCents: addOnCents(choice.price) ?? -1,
          priceCentsByVariant: byVariant.isEmpty ? nil : byVariant)
      })
  }
}

/// Why the add-ons cannot be saved, in the console's words, or nil.
func checkAddOns(_ drafts: [AddOnGroupDraft]) -> String? { drafts.isEmpty ? nil : modifierGroupsProblem(addOnGroups(drafts)) }

/// The `modifierGroups` a save sends: each group and choice over its stored record, so fields the apps do not edit
/// are kept.
func addOnsJSON(_ drafts: [AddOnGroupDraft], stored: JSONValue?) -> JSONValue {
  var storedGroups: [[String: JSONValue]] = []
  if case .array(let list)? = stored {
    storedGroups = list.compactMap { if case .object(let record) = $0 { record } else { nil } }
  }
  return .array(
    addOnGroups(drafts).map { group in
      var fields = storedGroups.first { $0["id"]?.stringValue == group.id } ?? [:]
      var storedOptions: [[String: JSONValue]] = []
      if case .array(let list)? = fields["options"] {
        storedOptions = list.compactMap { if case .object(let record) = $0 { record } else { nil } }
      }
      fields["id"] = .string(group.id)
      fields["name"] = .string(group.name.trimmingCharacters(in: .whitespacesAndNewlines))
      fields["min"] = .number(Double(group.min))
      fields["max"] = .number(Double(group.max))
      if let online = group.online { fields["online"] = .bool(online) }
      fields["options"] = .array(
        group.options.map { option in
          var choice = storedOptions.first { $0["id"]?.stringValue == option.id } ?? [:]
          choice["id"] = .string(option.id)
          choice["name"] = .string(option.name.trimmingCharacters(in: .whitespacesAndNewlines))
          choice["priceCents"] = .number(option.priceCents)
          // `JSONValue` takes `nil` as `.null`, so an empty list is removed, never assigned nil.
          if let byVariant = option.priceCentsByVariant, !byVariant.isEmpty {
            choice["priceCentsByVariant"] = .object(byVariant.mapValues { .number($0) })
          } else {
            choice.removeValue(forKey: "priceCentsByVariant")
          }
          // The picture card, as the console's `withChoiceCard` writes it: each kept only when it says something.
          if let card = drafts.first(where: { $0.id == group.id })?.choices.first(where: { $0.id == option.id }) {
            let url = card.imageUrl.trimmingCharacters(in: .whitespacesAndNewlines)
            if url.isEmpty { choice.removeValue(forKey: "imageUrl") } else { choice["imageUrl"] = .string(url) }
            let note = String(card.note.trimmingCharacters(in: .whitespacesAndNewlines).prefix(productChoiceNoteMax))
            if note.isEmpty { choice.removeValue(forKey: "note") } else { choice["note"] = .string(note) }
            let items = comboItems(card.includes)
            if items.isEmpty { choice.removeValue(forKey: "includes") } else { choice["includes"] = .array(items.map { .string($0) }) }
          }
          return .object(choice)
        })
      return .object(fields)
    })
}

/// More combinations than a product holds (AGL-4100), in the console's words: the count, and the way out, since the
/// values typed are kept, not dropped.
func variantMatrixProblem(_ options: [OptionDraft]) -> String? {
  let count = variantCountOf(options)
  guard count > commerceMaxVariants else { return nil }
  let shown = count.formatted(.number.locale(Locale(identifier: "en_US")))
  return "These options make \(shown) combinations, and a product holds at most \(commerceMaxVariants). Remove some "
    + "values, or move choices that don’t need their own stock (walls, printing, extras) to Add-ons, priced by option "
    + "where they cost more on a larger size."
}
