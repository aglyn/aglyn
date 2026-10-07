// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation

/*
 * THE REGISTER'S BASKET.
 *
 * What the cashier has rung up, before it is a sale. A value type, so the
 * screens, the copy kept on the device (it survives a restart) and the
 * tests all read the same arithmetic.
 *
 * The figures are a PREVIEW. The server prices the sale when it opens
 * (`commerce/pos-order`, `payment: 'open'`): it re-reads every product,
 * prices each modifier from the product, applies the discount ceiling and
 * the store's tax, and the total it answers is the one the customer pays.
 * The basket sends only what was picked, never a price.
 */

/// The most of one line the server rings up (`pos-order` clamps to 1..99).
let posLineMaxQuantity = 99
/// The most lines one sale carries, so a stuck key cannot build a basket the route refuses.
let posCartMaxLines = 100

struct CartLine: Codable, Hashable, Identifiable {
  /// Product, variant and modifier choices: the same item with the same choices is one line.
  let key: String
  let productID: String
  /// Nil for a product's only (default) variant.
  let variantID: String?
  let name: String
  /// "Large / Oat milk, Extra shot"; nil for neither.
  let variantLabel: String?
  let modifiers: [ModifierSelection]
  /// One unit as the grid priced it, modifiers included: the preview only.
  let unitCents: Int
  var quantity: Int

  var id: String { key }
}

/// What one tap or one item sheet puts in the basket.
struct CartPick: Hashable {
  let productID: String
  let variantID: String?
  let name: String
  let variantLabel: String?
  var modifiers: [ModifierSelection] = []
  let unitCents: Int
}

func cartLineKey(_ productID: String, _ variantID: String?, _ modifiers: [ModifierSelection] = []) -> String {
  "\(productID):\(variantID ?? ""):\(modifierSelectionKey(modifiers))"
}

private func clampQuantity(_ quantity: Int) -> Int { min(max(quantity, 0), posLineMaxQuantity) }

struct Cart: Codable, Hashable {
  var lines: [CartLine] = []
  /// A whole-sale discount, in percent.
  var discountPct = 0
  /// Who the receipt goes to, when the cashier asked.
  var customerEmail = ""

  static let empty = Cart()

  var count: Int { lines.reduce(0) { $0 + $1.quantity } }
  var subtotalCents: Int { lines.reduce(0) { $0 + $1.unitCents * $1.quantity } }
  /// The discount as the server takes it off each line, summed: a preview.
  var discountCents: Int {
    discountPct <= 0
      ? 0 : lines.reduce(0) { $0 + jsRound(Double($1.unitCents * $1.quantity * discountPct) / 100) }
  }
  var isEmpty: Bool { lines.isEmpty }

  /// Adds `quantity` of a pick: the same item with the same choices grows its line.
  func adding(_ pick: CartPick, quantity: Int = 1) -> Cart {
    let key = cartLineKey(pick.productID, pick.variantID, pick.modifiers)
    if let line = lines.first(where: { $0.key == key }) { return settingQuantity(key, line.quantity + quantity) }
    guard lines.count < posCartMaxLines else { return self }
    let added = clampQuantity(quantity)
    guard added > 0 else { return self }
    var next = self
    next.lines.append(
      CartLine(
        key: key, productID: pick.productID, variantID: pick.variantID, name: pick.name,
        variantLabel: pick.variantLabel, modifiers: pick.modifiers, unitCents: max(0, pick.unitCents),
        quantity: added))
    return next
  }

  /// Sets a line's quantity; zero removes it.
  func settingQuantity(_ key: String, _ quantity: Int) -> Cart {
    let next = clampQuantity(quantity)
    var cart = self
    if next > 0 {
      cart.lines = lines.map { line in
        var line = line
        if line.key == key { line.quantity = next }
        return line
      }
    } else {
      cart.lines = lines.filter { $0.key != key }
    }
    return cart
  }

  func removing(_ key: String) -> Cart { settingQuantity(key, 0) }

  func withDiscount(_ pct: Double) -> Cart {
    var cart = self
    cart.discountPct = pct.isFinite ? min(max(jsRound(pct), 0), 100) : 0
    return cart
  }

  func withCustomerEmail(_ email: String) -> Cart {
    var cart = self
    cart.customerEmail = String(email.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
    return cart
  }

  /// What `commerce/pos-order` takes for `lines`: picks and counts, never prices.
  var saleLines: JSONValue {
    .array(
      lines.map { line in
        var record: [String: JSONValue] = ["productId": .string(line.productID), "quantity": .number(Double(line.quantity))]
        if let variant = line.variantID { record["variantId"] = .string(variant) }
        if !line.modifiers.isEmpty {
          record["modifiers"] = .array(
            line.modifiers.map { .object(["groupId": .string($0.groupId), "optionId": .string($0.optionId)]) })
        }
        return .object(record)
      })
  }

  /// A kept basket read back defensively: every line goes through `adding`
  /// again, so an older or hand-edited copy can never hold a line the till
  /// could not have built. Anything unreadable is an empty basket.
  static func read(_ data: Data?) -> Cart {
    guard let data, case .object(let record)? = JSONValue.decode(data) else { return .empty }
    var cart = Cart.empty
    if case .array(let lines)? = record["lines"] {
      for entry in lines.prefix(posCartMaxLines) {
        guard case .object(let line) = entry, case .string(let product)? = line["productId"], !product.isEmpty else {
          continue
        }
        var modifiers: [ModifierSelection] = []
        if case .array(let raw)? = line["modifiers"] {
          for item in raw {
            if case .object(let modifier) = item, case .string(let group)? = modifier["groupId"],
              case .string(let option)? = modifier["optionId"]
            {
              modifiers.append(ModifierSelection(groupId: group, optionId: option))
            }
          }
        }
        func string(_ key: String) -> String? {
          if case .string(let value)? = line[key], !value.isEmpty { return value }
          return nil
        }
        func amount(_ key: String) -> Double? {
          if case .number(let value)? = line[key] { return value }
          return nil
        }
        cart = cart.adding(
          CartPick(
            productID: product, variantID: string("variantID") ?? string("variantId"), name: string("name") ?? "Item",
            variantLabel: string("variantLabel"), modifiers: modifiers,
            unitCents: amount("unitCents").map(jsRound) ?? 0),
          quantity: amount("quantity").map { clampQuantity(jsRound($0)) } ?? 0)
      }
    }
    if case .number(let pct)? = record["discountPct"] { cart = cart.withDiscount(pct) }
    if case .string(let email)? = record["customerEmail"] { cart = cart.withCustomerEmail(email) }
    return cart
  }

  func encoded() -> Data? {
    // The same keys the reader takes, so a kept basket round-trips.
    let value = JSONValue.object([
      "lines": .array(
        lines.map { line in
          var record: [String: JSONValue] = [
            "productId": .string(line.productID), "name": .string(line.name),
            "unitCents": .number(Double(line.unitCents)), "quantity": .number(Double(line.quantity)),
          ]
          if let variant = line.variantID { record["variantId"] = .string(variant) }
          if let label = line.variantLabel { record["variantLabel"] = .string(label) }
          record["modifiers"] = .array(
            line.modifiers.map { .object(["groupId": .string($0.groupId), "optionId": .string($0.optionId)]) })
          return .object(record)
        }),
      "discountPct": .number(Double(discountPct)),
      "customerEmail": .string(customerEmail),
    ])
    return try? value.encoded()
  }
}
