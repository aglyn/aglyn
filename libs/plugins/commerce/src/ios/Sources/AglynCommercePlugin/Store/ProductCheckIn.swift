// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation

/*
 * CHECK-IN AT THE WINDOW IN THE PRODUCT EDITOR (AGL-4063), as the console's
 * `ProductCheckInFields` (product-check-in-fields.component.tsx) has it:
 * whether each item sold is somebody to check in on the day it is for, how
 * many people one item admits, whether an online buyer picks the day, and,
 * on a product with options, each variant's own choice. Every change below
 * is the console's own: the same object written for the same press. The
 * Kotlin kit's ProductCheckIn.kt.
 */

/// The plan feature the console draws these fields behind (`useCommerceEntitlement(hostId, 'pos')`).
let productCheckInFeature = "pos"

/// The console's upsell where a plan leaves the point of sale out, in its words.
func productCheckInUpsell() -> String {
  let base = "Register quick keys, check-in at the window and selling a product in person only come with the point of sale."
  return PlanFeatureDefaults.grantedFrom[productCheckInFeature].map { "\(base) Included from \($0)." } ?? base
}

/// A variant's own check-in, as the console's per-variant select offers it.
enum VariantCheckInChoice: String, CaseIterable, Equatable {
  case product, on, off
}

/// The product's setting with one part changed, keeping the others (the console's `productOn`).
private func productOn(_ current: ProductCheckIn?, headcount: Int? = nil, askUseDate: Bool? = nil) -> ProductCheckIn {
  let asks = askUseDate ?? (current?.askUseDate == true)
  return ProductCheckIn(
    askUseDate: asks ? true : nil, enabled: true,
    headcount: Double(headcount ?? current?.headcount.map { Int($0) } ?? 1))
}

/// Whether the product needs check-in, as its switch reads it.
func productNeedsCheckIn(_ current: ProductCheckIn?) -> Bool { current?.enabled == true }

/// People per item, as the product's field shows it.
func productCheckInHeadcount(_ current: ProductCheckIn?) -> Int { current?.headcount.map { Int($0) } ?? 1 }

/// "Needs check-in" switched: on keeps the people per item and the day question; off is only `enabled: false`.
func productCheckInSwitched(_ current: ProductCheckIn?, on: Bool) -> ProductCheckIn {
  on ? productOn(current) : ProductCheckIn(enabled: false)
}

/// People per item typed: a whole number from 1 to the ceiling; blank or not a number is 1.
func productCheckInHeadcountTyped(_ current: ProductCheckIn?, _ text: String) -> ProductCheckIn {
  productOn(current, headcount: checkInHeadcount(text))
}

/// "Ask the buyer which day" switched.
func productCheckInAskUseDateSwitched(_ current: ProductCheckIn?, on: Bool) -> ProductCheckIn {
  productOn(current, askUseDate: on)
}

/// The words under People per item.
func productCheckInHeadcountHelp(_ current: ProductCheckIn?) -> String {
  let people = productCheckInHeadcount(current)
  return people > 1 ? "Buying 3 makes \(3 * people) check-ins" : "Buying 3 makes 3 check-ins"
}

/// The words under "Ask the buyer which day".
func productCheckInUseDayHelp(_ current: ProductCheckIn?) -> String {
  current?.askUseDate == true
    ? "Buyers online can pick the day they will use it, from today on. If they skip it, it is for the day they buy."
    : "It is for the day it is bought. Turn this on to sell passes ahead for a day the buyer picks."
}

/// The words under the "Needs check-in" switch.
let productCheckInHelp =
  "Each one sold, online or at the register, is somebody to check in at the window on the day it is for, "
  + "with an optional wristband number or color."

/// What a variant's select shows: the product's setting, its own on, or its own off.
func variantCheckInChoice(_ own: ProductCheckIn?) -> VariantCheckInChoice {
  guard let own else { return .product }
  return own.enabled ? .on : .off
}

/// The select's first choice, naming what the product's setting is.
func variantCheckInProductLabel(productNeedsCheckIn: Bool) -> String {
  productNeedsCheckIn ? "Same as the product (needs check-in)" : "Same as the product (no check-in)"
}

/// The words for a variant's own choice.
func variantCheckInChoiceLabel(_ choice: VariantCheckInChoice, productNeedsCheckIn: Bool) -> String {
  switch choice {
  case .product: variantCheckInProductLabel(productNeedsCheckIn: productNeedsCheckIn)
  case .on: "Needs check-in"
  case .off: "No check-in"
  }
}

/// A variant's own setting after a pick: nil follows the product; on starts from its own people per item, else the
/// product's, and asks the day when the product does.
func variantCheckInPicked(_ choice: VariantCheckInChoice, own: ProductCheckIn?, product: ProductCheckIn?) -> ProductCheckIn? {
  switch choice {
  case .product: return nil
  case .off: return ProductCheckIn(enabled: false)
  case .on:
    let people = own?.headcount.map { Int($0) } ?? productCheckInHeadcount(product)
    return ProductCheckIn(askUseDate: product?.askUseDate == true ? true : nil, enabled: true, headcount: Double(people))
  }
}

/// People per item, as a variant's own field shows it.
func variantCheckInHeadcount(_ own: ProductCheckIn?) -> Int { own?.headcount.map { Int($0) } ?? 1 }

/// A variant's people per item typed, keeping its own day question.
func variantCheckInHeadcountTyped(_ own: ProductCheckIn?, _ text: String) -> ProductCheckIn {
  ProductCheckIn(askUseDate: own?.askUseDate == true ? true : nil, enabled: true, headcount: Double(checkInHeadcount(text)))
}

/// A variant's "Ask which day" switched, keeping its own people per item.
func variantCheckInAskUseDateSwitched(_ own: ProductCheckIn?, on: Bool) -> ProductCheckIn {
  ProductCheckIn(askUseDate: on ? true : nil, enabled: true, headcount: Double(variantCheckInHeadcount(own)))
}

/// The setting as a save writes it: `{enabled: false}`, or on with its people per item and, when asked, the day.
func productCheckInJSON(_ value: ProductCheckIn) -> JSONValue {
  var fields: [String: JSONValue] = ["enabled": .bool(value.enabled)]
  if let headcount = value.headcount { fields["headcount"] = .number(headcount) }
  if value.askUseDate == true { fields["askUseDate"] = .bool(true) }
  return .object(fields)
}

/// Whether the workspace's plan carries the point of sale, as the console answers it for the site; nil when it could
/// not be asked (the fields stay hidden, as the console's do while its plan read is in flight).
func productCheckInCarried(_ api: ConsoleAPIClient, hostID: String) async -> Bool? {
  guard let body = try? await api.request("/api/orgs/entitlements", query: [("hostId", hostID)]),
    case .object(let features)? = body["features"]
  else { return nil }
  return features[productCheckInFeature]?.boolValue ?? false
}
