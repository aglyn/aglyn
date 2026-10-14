// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import Foundation

/*
 * The product editor's options and variant matrix (AGL-3652), as the
 * console's product editor does them (product-editor-dialog.component.tsx),
 * and the Kotlin kit's VariantMatrix.kt: a product has up to three options,
 * each a name and its values; the variants are the Cartesian product of the
 * values; a change of values rebuilds the matrix and carries every variant's
 * price, codes and stock over by its selections, while a rename moves the
 * selections in place (AGL-3066) so no variant is replaced. A variant new to
 * the matrix starts from the first variant's price and stock, as the
 * console's does. The matrix itself (`expandVariantMatrix`,
 * `renameProductOptions`) is the contracts port the console's own cases
 * replay.
 */

/// One option as typed: its name and its values as a comma-separated line, kept as typed.
struct OptionDraft: Identifiable, Equatable {
  var id = UUID()
  var name = ""
  var valuesText = ""

  /// The values: split at commas and line breaks, trimmed, blanks and repeats dropped.
  var values: [String] { parseOptionValues(valuesText) }

  var option: ProductOption { ProductOption(name: name.trimmingCharacters(in: .whitespacesAndNewlines), values: values) }
}

func parseOptionValues(_ text: String) -> [String] {
  var seen = Set<String>()
  return text.split(whereSeparator: { $0 == "," || $0 == "\n" })
    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
    .filter { !$0.isEmpty && seen.insert($0).inserted }
}

/// Stable key for matching variants across matrix rebuilds (the console's `comboKey`).
func comboKey(_ selections: [String: String]) -> String {
  selections.sorted { $0.key < $1.key }.map { "\($0.key):\($0.value)" }.joined(separator: "|")
}

/// "Small / Red": the selections in the options' own order, or "Default".
func comboLabel(_ options: [OptionDraft], _ selections: [String: String]) -> String {
  let ordered = options.compactMap { selections[$0.option.name] }
  let rest = selections.filter { pick in !options.contains { $0.option.name == pick.key } }.sorted { $0.key < $1.key }.map(\.value)
  let label = (ordered + rest).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.joined(separator: " / ")
  return label.isEmpty ? "Default" : label
}

func newVariantID() -> String {
  "v" + String(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(10))
}

/// The variants for the options as they now are, keeping each one whose selections still exist.
func rebuildVariants(
  _ options: [OptionDraft], previous: [VariantDraft], mintID: () -> String = newVariantID
) -> [VariantDraft] {
  var kept: [String: VariantDraft] = [:]
  for variant in previous where kept[comboKey(variant.selections)] == nil { kept[comboKey(variant.selections)] = variant }
  let fallback = previous.first
  return expandVariantMatrix(options.map(\.option)).map { combo in
    kept[comboKey(combo)]
      ?? VariantDraft(
        id: mintID(), label: comboLabel(options, combo), price: fallback?.price ?? "", stock: fallback?.stock ?? "",
        selections: combo, fresh: true)
  }
}

extension ProductDraft {
  /// The draft with option `index`'s values changed: the matrix is rebuilt.
  func withOptionValues(_ index: Int, _ text: String, mintID: () -> String = newVariantID) -> ProductDraft {
    var next = options
    next[index].valuesText = text
    var copy = self
    copy.options = next
    copy.variants = rebuildVariants(next, previous: variants, mintID: mintID)
    return copy
  }

  /// The draft with option `index` renamed. Every variant's selection moves to the new name in place; an option
  /// that had no name yet joins the matrix now.
  func withOptionName(_ index: Int, _ name: String, mintID: () -> String = newVariantID) -> ProductDraft {
    let current = options[index]
    var next = options
    next[index].name = name
    var copy = self
    copy.options = next
    if current.name.trimmingCharacters(in: .whitespaces).isEmpty, !current.values.isEmpty {
      copy.variants = rebuildVariants(next, previous: variants, mintID: mintID)
      return copy
    }
    let (renamed, moved) = renameProductOptions(
      options: options.map(\.option),
      variants: variants.map { ProductVariant(id: $0.id, options: $0.selections) },
      names: options.indices.map { $0 == index ? name : nil })
    // Nothing moves while two options share a name; the draft still shows what was typed.
    let distinct = Set(renamed.map(\.name)).count == renamed.count
    copy.variants = zip(variants, moved).map { variant, change in
      var made = variant
      if distinct { made.selections = change.options ?? [:] }
      return made
    }
    return copy
  }

  func withOptionAdded() -> ProductDraft {
    guard options.count < commerceMaxOptions else { return self }
    var copy = self
    copy.options.append(OptionDraft())
    return copy
  }

  func withOptionRemoved(_ index: Int, mintID: () -> String = newVariantID) -> ProductDraft {
    var next = options
    next.remove(at: index)
    var copy = self
    copy.options = next
    copy.variants = rebuildVariants(next, previous: variants, mintID: mintID)
    return copy
  }
}

/// How many variants the options make, uncapped.
func variantCountOf(_ options: [OptionDraft]) -> Int {
  let usable = options.filter { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty && !$0.values.isEmpty }
  return usable.reduce(1) { count, option in min(Int.max / 2, count * option.values.count) }
}

/// Why the options cannot be stored (the console's `validateProduct`), or nil.
func checkOptions(_ options: [OptionDraft]) -> String? {
  if options.count > commerceMaxOptions { return "At most \(commerceMaxOptions) options per product" }
  for option in options {
    let name = option.name.trimmingCharacters(in: .whitespacesAndNewlines)
    if name.isEmpty { return "Option names are required" }
    if option.values.isEmpty { return "Option \"\(name)\" needs at least one value" }
    if option.values.count > commerceMaxOptionValues { return "Option \"\(name)\" has too many values" }
  }
  if Set(options.map { $0.name.trimmingCharacters(in: .whitespacesAndNewlines) }).count != options.count {
    return "Each option needs its own name"
  }
  if variantCountOf(options) > commerceMaxVariants { return "At most \(commerceMaxVariants) variants per product" }
  return nil
}
