// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation

/*
 * WHICH REGISTER THIS DEVICE IS, AND WHAT IT HOLDS.
 *
 * A sale runs through a named register: the plan's register seats are
 * counted by them and the takings attributed to one. The device remembers
 * its register per store, as the console register defaults to the first; a
 * register that pins a stock location sells from it.
 *
 * Kept on the device, per store and register, so a restart loses nothing:
 * the basket being rung up, and the sale in progress (an app closed between
 * "Charge" and the receipt opens back on that sale rather than leaving a
 * pending order behind).
 */

struct PosRegister: Hashable, Identifiable {
  let id: String
  let name: String
  let locationID: String?
}

/// The console register's own window (`pos-page`: registers, limit 25).
let posRegisterWindow = 25

func posRegister(_ doc: FirestoreDocument) -> PosRegister {
  let name = (doc.string("name") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  let location = doc.string("locationId") ?? ""
  return PosRegister(id: doc.id, name: name.isEmpty ? "Register" : name, locationID: location.isEmpty ? nil : location)
}

func sortRegisters(_ registers: [PosRegister]) -> [PosRegister] {
  registers.sorted { ($0.name.lowercased(), $0.id) < ($1.name.lowercased(), $1.id) }
}

func registersQuery(_ hostID: String) -> FirestoreQuery {
  FirestoreQuery(["hosts", hostID, "registers"], limit: posRegisterWindow)
}

/// The sale this register has open, as remembered across a restart.
struct PendingSale: Codable, Equatable {
  let orderID: String
  let totalCents: Int
  let openedAtMs: Int64
}

/// A pending sale older than a day is the console's to clean up, not the till's to resume.
let pendingSaleMaxAgeMs: Int64 = 24 * 60 * 60 * 1000

/// A register's device state, under the plugin's own keys.
struct RegisterStore {
  let defaults: UserDefaults
  let hostID: String

  private var registerKey: String { "commerce.pos.register.\(hostID)" }
  private func cartKey(_ register: String) -> String { "commerce.pos.cart.\(hostID).\(register)" }
  private func saleKey(_ register: String) -> String { "commerce.pos.sale.\(hostID).\(register)" }

  var registerID: String? {
    get { defaults.string(forKey: registerKey) }
    nonmutating set { defaults.set(newValue, forKey: registerKey) }
  }

  func cart(_ register: String) -> Cart { Cart.read(defaults.data(forKey: cartKey(register))) }

  func saveCart(_ register: String, _ cart: Cart) {
    if cart.isEmpty && cart.discountPct == 0 && cart.customerEmail.isEmpty {
      defaults.removeObject(forKey: cartKey(register))
    } else {
      defaults.set(cart.encoded(), forKey: cartKey(register))
    }
  }

  func pendingSale(_ register: String, nowMs: Int64) -> PendingSale? {
    guard let data = defaults.data(forKey: saleKey(register)),
      let sale = try? JSONDecoder().decode(PendingSale.self, from: data), !sale.orderID.isEmpty,
      (0...pendingSaleMaxAgeMs).contains(nowMs - sale.openedAtMs)
    else { return nil }
    return sale
  }

  func savePendingSale(_ register: String, _ sale: PendingSale?) {
    if let sale, let data = try? JSONEncoder().encode(sale) {
      defaults.set(data, forKey: saleKey(register))
    } else {
      defaults.removeObject(forKey: saleKey(register))
    }
  }
}
