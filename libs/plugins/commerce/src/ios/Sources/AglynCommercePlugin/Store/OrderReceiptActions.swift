// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynHardware
import AglynPluginHost
import AglynUI
import SwiftUI

/*
 * A REGISTER SALE'S RECEIPTS FROM THE ORDER SCREEN (the console's
 * `PosReceiptActions` in the order dialog, AGL-3609): the register's 80 mm
 * receipt and its gift receipt on this device's print sheet, laid out as the
 * register lays them out (`receiptDataFromOrder`, `layoutReceipt`), and a
 * reprint on the register's cloud receipt printer when it has one.
 */

/// The store's receipt header for a register sale printed away from the register: the site's name, currency and time
/// zone, and the register rules' address and return policy (`commerce/pos-payment`'s context).
@MainActor
func orderReceiptContext(_ context: NativePluginContext, hostID: String, registerName: String?) async -> ReceiptContext {
  final class Once {
    var listener: FirestoreListening?
    var answered = false
  }
  let once = Once()
  let host: FirestoreDocument? = await withCheckedContinuation { continuation in
    once.listener = context.firestore.listenDocument(["hosts", hostID]) { result in
      guard !once.answered else { return }
      once.answered = true
      once.listener?.remove()
      if case .success(let doc) = result { continuation.resume(returning: doc) } else { continuation.resume(returning: nil) }
    }
    if once.answered { once.listener?.remove() }
  }
  let rules = (try? await context.api.request(posPaymentRoute, query: [("hostId", hostID), ("action", "context")]))
    .map(readPosContext)?.ops
  let name = ["displayName", "name", "title"].lazy.compactMap { host?.string($0)?.trimmingCharacters(in: .whitespaces) }
    .first { !$0.isEmpty }
  return ReceiptContext(
    storeName: name ?? "Store",
    storeLines: (rules?.receiptAddress ?? "").split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }
      .filter { !$0.isEmpty },
    registerName: registerName, timeZone: host?.string("timeZone").flatMap { $0.isEmpty ? nil : $0 },
    currency: host?.string("currency").flatMap { $0.isEmpty ? nil : $0 },
    footer: rules?.returnPolicy.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty)
}

/// Print receipt, Gift receipt and, when the register has a cloud printer, Receipt printer.
struct OrderReceiptActionsSection: View {
  let context: NativePluginContext
  let orderID: String
  let raw: [String: Any]
  let number: String
  let report: (_ done: String?, _ problem: String?) -> Void
  @State private var hasPrinter = false
  @State private var busy: String?
  @State private var listener: FirestoreListening?

  private var registerID: String? { (raw["registerId"] as? String).flatMap { $0.isEmpty ? nil : $0 } }

  var body: some View {
    Section {
      Button {
        Task { await print(gift: false) }
      } label: {
        Label(busy == "receipt" ? "Printing…" : "Print receipt", systemImage: "printer")
      }
      .disabled(busy != nil)
      .accessibilityIdentifier("order-pos-receipt")
      Button {
        Task { await print(gift: true) }
      } label: {
        Label(busy == "gift" ? "Printing…" : "Gift receipt", systemImage: "gift")
      }
      .disabled(busy != nil)
      .accessibilityIdentifier("order-pos-gift-receipt")
      if hasPrinter {
        Button {
          Task { await reprint() }
        } label: {
          Label(busy == "cloud" ? "Sending…" : "Receipt printer", systemImage: "printer.dotmatrix")
        }
        .disabled(busy != nil)
        .accessibilityIdentifier("order-pos-cloud-receipt")
      }
    } header: {
      Text("Register receipt")
    } footer: {
      Text("The register's receipt for this sale. A gift receipt leaves out every price.")
    }
    .task(id: registerID) {
      listener?.remove()
      hasPrinter = false
      guard let hostID = context.hostID, let registerID else { return }
      listener = context.firestore.listen(FirestoreQuery(["hosts", hostID, "printers"], equals: [("registerId", registerID)], limit: 1)) {
        result in
        if case .success(let docs) = result { hasPrinter = !docs.isEmpty }
      }
    }
    .onDisappear { listener?.remove() }
  }

  private func print(gift: Bool) async {
    guard let hostID = context.hostID else { return }
    busy = gift ? "gift" : "receipt"
    defer { busy = nil }
    let receiptContext = await orderReceiptContext(context, hostID: hostID, registerName: raw["registerName"] as? String)
    let receipt = receiptDataFromOrder(
      orderID: orderID, order: raw, context: receiptContext, nowMs: Int64(Date().timeIntervalSince1970 * 1000))
    let text = renderText(layoutReceipt(receipt, ReceiptLayoutOptions(columns: PaperColumns.mm80, gift: gift)))
    if case .failed(let message) = await SystemPrinter.printText(text, jobName: "\(gift ? "Gift receipt" : "Receipt") \(number)") {
      report(nil, message)
    }
  }

  private func reprint() async {
    guard let hostID = context.hostID else { return }
    busy = "cloud"
    defer { busy = nil }
    do {
      _ = try await context.api.request(
        "/api/commerce/printers", method: .post,
        body: .object(["hostId": .string(hostID), "orderId": .string(orderID), "action": "reprint"]))
      report("Sent to the receipt printer", nil)
    } catch let error as ConsoleAPIError where error.status > 0 {
      report(nil, error.message.isEmpty ? "Could not print" : error.message)
    } catch {
      report(nil, "The register is offline. Check the connection and try again.")
    }
  }
}
