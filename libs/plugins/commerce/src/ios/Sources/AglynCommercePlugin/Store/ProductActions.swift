// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/*
 * THE PRODUCTS LIST'S ROW ACTIONS (AGL-3841): Duplicate, Archive or Activate,
 * Delete and a digital product's license Keys, and the plan's product count
 * under the list, as the console's products card has them. Duplicate and
 * Delete go through the commerce routes that run the console's own copy and
 * soft delete; Archive and Activate save the stored product with its status
 * changed through the product save route; keys are written to the store's
 * `licenseKeys` as the console's dialog writes them.
 */

/// A product's status changed, saved as the whole stored product (the save route keeps what the app does not show).
func productStatusSaveJSON(_ stored: [String: Any], status: String) -> JSONValue {
  var product = storedProductJSON(stored)
  product["status"] = .string(status)
  return .object(product)
}

/// Duplicates a product as a draft; the answer is the copy's id. The id is minted here so a retry finds the same copy.
func duplicateProduct(api: ConsoleAPIClient, hostID: String, productID: String, newProductID: String) async throws -> String {
  let answer = try await api.request(
    "/api/commerce/products/duplicate", method: .post,
    body: .object(["hostId": .string(hostID), "productId": .string(productID), "newProductId": .string(newProductID)]))
  return answer?["id"]?.stringValue ?? newProductID
}

/// Deletes a product: it stops being purchasable, and blocks pointing at it show a checkout error until repointed.
func deleteProduct(api: ConsoleAPIClient, hostID: String, productID: String) async throws {
  _ = try await api.request(
    "/api/commerce/products/delete", method: .post, body: .object(["hostId": .string(hostID), "productId": .string(productID)]))
}

/// Whether any variant still needs its price (`productPriceMissing`): a price is a number at or above zero.
func productPriceMissing(_ data: [String: Any]) -> Bool {
  ((data["variants"] as? [Any]) ?? []).contains { variant in
    guard let price = (variant as? [String: Any])?["priceUsd"] as? NSNumber, CFGetTypeID(price) != CFBooleanGetTypeID() else { return true }
    return !(price.doubleValue.isFinite && price.doubleValue >= 0)
  }
}

/// The notice over the list for products listed before they have a price (AGL-3676), in the console's words.
func comingSoonNotice(_ names: [String]) -> String? {
  guard let first = names.first else { return nil }
  let one = names.count == 1
  return "Set prices to start selling: \(one ? "\(first) shows" : "\(names.count) products show") “Price coming soon” on your store until you set \(one ? "its price" : "their prices"). Open each one and give every variant a price."
}

/// What activating an unpriced product tells the owner (AGL-3676): it goes live, and says "Price coming soon".
func activatingUnpricedNotice(_ name: String) -> String {
  "\(name) has no price yet: visitors will see “Price coming soon” and can’t buy it."
}

/// The site's product count against the plan's `productsPerHost`, for the readout under the list.
@MainActor
@Observable
final class ProductQuotaModel {
  private(set) var used = 0
  private(set) var limit: Double?
  private(set) var ready = false
  @ObservationIgnored private var key: String?

  func load(_ context: NativePluginContext) async {
    guard let hostID = context.hostID, key != hostID else { return }
    key = hostID
    ready = false
    // The same count the create door counts (every product document of the site), asked beside the plan, not
    // before it.
    async let counted = try? await context.firestore.count(FirestoreQuery(productsPath(hostID)))
    async let plan = context.api.request("/api/orgs/entitlements", query: [("hostId", hostID)])
    used = (await counted ?? nil) ?? used
    do {
      let answer = try await plan
      if case .object(let quotas)? = answer?["quotas"] {
        switch quotas["productsPerHost"] {
        case .number(let cap)?: limit = cap
        default: limit = nil
        }
      }
      ready = true
    } catch {
      key = nil
    }
  }

  /// Whether one more product fits (unknown counts as room; the route checks again).
  var hasRoom: Bool { !ready || limit.map { Double(used) < $0 } ?? true }
}

// MARK: - License keys

/// One stored license key.
struct LicenseKeyRow: Identifiable, Equatable {
  let id: String
  let key: String
  let assigned: Bool
  let revoked: Bool
}

/// How many of one product's keys the screen reads (`KEY_POOL_CEILING`).
let licenseKeyPoolCeiling = 500

/// The pool's line: available, assigned and retired keys (AGL-2454), in the console's words.
func licenseKeyCounts(_ keys: [LicenseKeyRow], truncated: Bool) -> String {
  let available = keys.filter { !$0.assigned && !$0.revoked }.count
  let retired = keys.filter(\.revoked).count
  let assigned = keys.count - available - retired
  return "\(available) available · \(assigned) assigned"
    + (retired > 0 ? " · \(retired) retired (refunded or revoked — not reissued)" : "")
    + (truncated ? ", of the \(licenseKeyPoolCeiling) keys read" : "")
    + ". Keys deliver automatically on purchase (receipt + account)."
}

/// The keys typed one per line, trimmed, at most 200 at a time.
func licenseKeysFromText(_ text: String) -> [String] {
  Array(text.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.prefix(200))
}

/// A digital product's license keys: what is left in the pool, revoke an unsold key, add keys one per line.
struct ProductKeysSheet: View {
  let context: NativePluginContext
  let productID: String
  let productName: String
  @State private var keys: [LicenseKeyRow] = []
  @State private var truncated = false
  @State private var text = ""
  @State private var problem: String?
  @State private var done: String?
  @State private var busy = false
  @State private var listener: FirestoreListening?
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      Form {
        if let problem { AglynNotice(problem, tone: .error) { self.problem = nil } }
        if let done { AglynNotice(done, tone: .success) { self.done = nil } }
        Section {
          Text(licenseKeyCounts(keys, truncated: truncated)).font(AglynFont.subheadline).foregroundStyle(.secondary)
          ForEach(keys.filter { !$0.assigned && !$0.revoked }.prefix(8)) { key in
            HStack {
              Text(key.key).font(.system(.caption, design: .monospaced)).lineLimit(1)
              Spacer()
              Button("Revoke", role: .destructive) { Task { await revoke(key) } }.disabled(busy)
            }
          }
        }
        Section {
          TextEditor(text: $text)
            .frame(minHeight: 90)
            .font(.system(.body, design: .monospaced))
            .accessibilityIdentifier("product-keys-add")
        } header: {
          Text("Add keys (one per line)")
        }
      }
      .formStyle(.grouped)
      .navigationTitle("License keys — \(productName)")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Add keys") { Task { await add() } }
            .disabled(busy || licenseKeysFromText(text).isEmpty)
            .accessibilityIdentifier("product-keys-save")
        }
      }
    }
    .aglynSheetMinimumSize(width: 420, height: 420)
    .task(id: productID) {
      listener?.remove()
      guard let hostID = context.hostID else { return }
      listener = context.firestore.listen(
        FirestoreQuery(["hosts", hostID, "licenseKeys"], equals: [("productId", productID)], limit: licenseKeyPoolCeiling + 1)
      ) { result in
        guard case .success(let docs) = result else { return }
        truncated = docs.count > licenseKeyPoolCeiling
        keys = docs.prefix(licenseKeyPoolCeiling).map { doc in
          LicenseKeyRow(
            id: doc.id, key: doc.string("key") ?? "", assigned: (doc.data["assignedAtMs"] as? NSNumber) != nil,
            revoked: (doc.data["revokedAtMs"] as? NSNumber) != nil)
        }
      }
    }
    .onDisappear { listener?.remove() }
  }

  private func now() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

  private func add() async {
    guard let hostID = context.hostID else { return }
    let lines = licenseKeysFromText(text)
    busy = true
    problem = nil
    defer { busy = false }
    var added = 0
    do {
      for key in lines {
        try await context.writer.merge(
          ["hosts", hostID, "licenseKeys", newDocumentID()],
          ["productId": productID, "key": key, "assignedAtMs": NSNull(), "createdAtMs": now()])
        added += 1
      }
      text = ""
      done = "Added \(added) keys"
    } catch {
      problem = "\(added) of \(lines.count) keys were added before the rest could not be: \(error.localizedDescription)"
    }
  }

  private func revoke(_ key: LicenseKeyRow) async {
    guard let hostID = context.hostID else { return }
    busy = true
    defer { busy = false }
    do {
      try await context.writer.update(["hosts", hostID, "licenseKeys", key.id], ["revokedAtMs": now(), "assignedAtMs": now()])
    } catch {
      problem = error.localizedDescription
    }
  }
}
