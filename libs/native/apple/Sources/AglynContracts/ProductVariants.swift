// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * A product's option axes and the variant matrix they generate, ported once
 * from libs/plugins/commerce/src/lib/model/commerce.ts (`expandVariantMatrix`,
 * `renameProductOptions`). The cases in function-cases.generated.json are the
 * TypeScript's own answers and the tests replay every one. The caps are the
 * console's COMMERCE_MAX_VARIANTS, COMMERCE_MAX_OPTIONS and
 * COMMERCE_MAX_OPTION_VALUES; the save route validates them again.
 */

public let commerceMaxVariants = 100
public let commerceMaxOptions = 3
public let commerceMaxOptionValues = 25

/// The Cartesian product of the options' values: one selection per variant,
/// the first option varying slowest. No usable option (a name and at least one
/// value) is the single default selection, `[:]`. Capped at `commerceMaxVariants`.
public func expandVariantMatrix(_ options: [ProductOption]?) -> [[String: String]] {
  let usable = (options ?? []).filter { !$0.name.isEmpty && !$0.values.isEmpty }
  if usable.isEmpty { return [[:]] }
  var combos: [[String: String]] = [[:]]
  for option in usable {
    var next: [[String: String]] = []
    for combo in combos {
      for value in option.values {
        var made = combo
        made[option.name] = value
        next.append(made)
      }
    }
    combos = next
    if combos.count > commerceMaxVariants { return Array(combos.prefix(commerceMaxVariants)) }
  }
  return combos
}

/// The option axes renamed, with every variant's selection carried to the new
/// name in place, so a variant keeps its id, price, codes and stock (AGL-3066).
/// `names` has one entry per option, in order; nil keeps that option's name.
/// While the new names are not all different nothing is moved.
public func renameProductOptions(
  options: [ProductOption], variants: [ProductVariant], names: [String?]
) -> (options: [ProductOption], variants: [ProductVariant]) {
  var renamed = options
  for index in options.indices where index < names.count {
    if let name = names[index] { renamed[index].name = name }
  }
  let next = renamed.map(\.name)
  if Set(next).count != next.count { return (renamed, variants) }
  let moved = variants.map { variant -> ProductVariant in
    guard let selections = variant.options else { return variant }
    let axisOf = optionAxes(options, selections)
    var carried: [String: String] = [:]
    var changed = false
    for (key, value) in selections {
      let name = axisOf[key].map { next[$0] } ?? key
      if name != key { changed = true }
      carried[name] = value
    }
    guard changed else { return variant }
    var copy = variant
    copy.options = carried
    return copy
  }
  return (renamed, moved)
}

/// Which option each selection belongs to: the same name first, then, for a
/// name no option has, the one untaken option whose values hold it.
private func optionAxes(_ options: [ProductOption], _ selections: [String: String]) -> [String: Int] {
  var axisOf: [String: Int] = [:]
  var taken = Set<Int>()
  for (index, option) in options.enumerated() where selections[option.name] != nil && axisOf[option.name] == nil {
    axisOf[option.name] = index
    taken.insert(index)
  }
  for key in selections.keys.sorted() where axisOf[key] == nil {
    let value = selections[key]!
    guard let axis = options.indices.first(where: { !taken.contains($0) && options[$0].values.contains(value) }) else { continue }
    axisOf[key] = axis
    taken.insert(axis)
  }
  return axisOf
}
