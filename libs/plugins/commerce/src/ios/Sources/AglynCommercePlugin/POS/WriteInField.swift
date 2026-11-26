// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynUI
import SwiftUI

/// What a write-in says under its field (`ProductWriteInField`'s hint): required or not, the merchant's note, what a
/// filled answer adds, and how many characters are left; or what is wrong with what was typed.
func writeInHint(_ group: ProductModifierGroup, text: String, variantID: String?, money: (Int) -> String) -> String {
  if let problem = writeInProblem(group, text) { return problem }
  let option = group.options.first
  let cents = option.map { modifierOptionPriceCents($0, variantID: variantID) } ?? 0
  let note = option?.note?.trimmingCharacters(in: .whitespacesAndNewlines)
  return [
    group.isRequired ? "Required" : "Optional", note?.isEmpty == false ? note : nil, cents > 0 ? "Adds \(money(cents))" : nil,
    "\(writeInLength(text))/\(group.writeInLimit)",
  ]
  .compactMap { $0 }.joined(separator: " · ")
}

/// A typed answer held to the group's longest, as the console's field holds it (`maxLength`).
func writeInTyped(_ group: ProductModifierGroup, _ typed: String) -> String {
  guard writeInLength(typed) > group.writeInLimit else { return typed }
  var cut = String.UnicodeScalarView()
  cut.append(contentsOf: typed.unicodeScalars.prefix(group.writeInLimit))
  return String(cut)
}

/// One write-in at the register or the kiosk (the gear set builder): a text field named after the group, the number
/// pad for numbers only, with its note, what a filled answer adds and a count of characters under it.
struct WriteInFieldSection: View {
  let group: ProductModifierGroup
  let variantID: String?
  let text: String
  let money: (Int) -> String
  let onChange: (String) -> Void

  var body: some View {
    let problem = writeInProblem(group, text)
    Section {
      TextField(group.name, text: Binding(get: { text }, set: { onChange(writeInTyped(group, $0)) }))
        .autocorrectionDisabled()
        #if os(iOS)
          .keyboardType(group.digitsOnly == true ? .numberPad : .default)
        #endif
        .accessibilityLabel(group.name)
        .accessibilityIdentifier("write-in-\(group.id)")
    } header: {
      Text(group.name)
    } footer: {
      Text(writeInHint(group, text: text, variantID: variantID, money: money))
        .foregroundStyle(problem == nil ? AnyShapeStyle(.secondary) : AnyShapeStyle(AglynColor.error))
        .monospacedDigit()
    }
  }
}
