// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import Observation

/*
 * THE LAST RECEIPT (AGL-3609, AGL-3651, AGL-3652): the register keeps the sale
 * it finished last, shows it ("Last sale #1042"), and sends its receipt to the
 * register's cloud receipt printer again. The Kotlin app's `PosLastReceipt.kt`.
 *
 * The console's `PosLastReceipt` asks the SAME door for a cloud print:
 * `commerce/pos-payment` `receipt` with channel `print`, which prints under the
 * sale's own key (so a receipt that already printed is never printed twice).
 * The sale itself is read from the stored order, so the figures are the ones
 * the server recorded. The Apple register has no direct printer, so a register
 * with no cloud printer shows nothing to press and says so.
 */

/// The sale a register finished last, as remembered across a restart.
struct LastSale: Codable, Equatable {
  let orderID: String
  let atMs: Int64
}

/// A sale as the last-receipt row shows it.
struct LastSaleSummary: Equatable {
  let label: String
  let totalCents: Int
}

/// "#1042", or the first characters of the id for an order with no number yet.
func lastSaleLabel(number: Int?, orderID: String) -> String {
  if let number, number > 0 { return "#\(number)" }
  return "#\(orderID.prefix(8))"
}

@MainActor
@Observable
final class PosLastReceiptModel {
  private(set) var lastSale: LastSale?
  private(set) var summary: LastSaleSummary?
  /// This register has a cloud receipt printer to send to.
  private(set) var hasPrinter = false
  private(set) var busy = false
  var notice: String?
  private(set) var error: String?

  @ObservationIgnored private let reader: FirestoreReader
  @ObservationIgnored private let api: PosSaleAPI
  @ObservationIgnored private let store: RegisterStore
  @ObservationIgnored private let hostID: String
  @ObservationIgnored private var registerID: String?
  @ObservationIgnored private var orderListener: FirestoreListening?
  @ObservationIgnored private var printerListener: FirestoreListening?

  init(reader: FirestoreReader, api: PosSaleAPI, store: RegisterStore, hostID: String) {
    self.reader = reader
    self.api = api
    self.store = store
    self.hostID = hostID
  }

  /// The register in front of the cashier changed (or was first chosen): read its last sale and printer.
  func watch(registerID next: String?) {
    registerID = next
    notice = nil
    error = nil
    printerListener?.remove()
    printerListener = nil
    hasPrinter = false
    if let next {
      lastSale = store.lastSale(next, nowMs: nowMs())
      printerListener = reader.listen(
        FirestoreQuery(["hosts", hostID, "printers"], equals: [("registerId", next)], limit: 1)
      ) { [weak self] result in
        if case .success(let docs) = result { self?.hasPrinter = !docs.isEmpty }
      }
    } else {
      lastSale = nil
    }
    readSale()
  }

  /// A sale was paid and the receipt chosen: it is now the last sale.
  func remember(orderID: String) {
    guard let registerID else { return }
    let sale = LastSale(orderID: orderID, atMs: nowMs())
    store.saveLastSale(registerID, sale)
    lastSale = sale
    notice = nil
    error = nil
    readSale()
  }

  func stop() {
    orderListener?.remove()
    orderListener = nil
    printerListener?.remove()
    printerListener = nil
  }

  private func readSale() {
    orderListener?.remove()
    orderListener = nil
    summary = nil
    guard let sale = lastSale else { return }
    orderListener = reader.listenDocument(["hosts", hostID, "orders", sale.orderID]) { [weak self] result in
      guard let self, case .success(let order?) = result else { return }
      let totals = order.data["totals"] as? [String: Any]
      let total = (totals?["totalCents"] as? NSNumber)?.intValue ?? order.int("amountCents") ?? 0
      self.summary = LastSaleSummary(label: lastSaleLabel(number: order.int("number"), orderID: sale.orderID), totalCents: total)
    }
  }

  /// Sends the last sale's receipt to the register's receipt printer.
  func sendToPrinter() async {
    guard let sale = lastSale, !busy else { return }
    busy = true
    notice = nil
    error = nil
    defer { busy = false }
    do {
      _ = try await api.payment(orderID: sale.orderID, step: .receipt(channel: "print", to: nil))
      notice = "Sent to the receipt printer"
    } catch let failure as ConsoleAPIError {
      error = failure.message
    } catch {
      self.error = "Could not print"
    }
  }
}
