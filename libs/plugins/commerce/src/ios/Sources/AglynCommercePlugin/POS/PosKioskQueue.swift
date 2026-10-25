// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import Foundation
import Observation
import SwiftUI

/*
 * "PAY AT COUNTER" ORDERS FROM THE KIOSKS (AGL-3623, AGL-3651, AGL-3652), on the
 * register. The Kotlin app's `PosKioskQueue.kt`. Each is an open sale a kiosk
 * already priced; Take payment loads it into the register's checkout, where the
 * cashier takes payment exactly as on a sale they rang themselves. Oldest first,
 * as a counter serves them, and nothing is drawn when the queue is empty.
 *
 * The register calls the SAME staff actions the console register calls
 * (`queue`, `take`), as the signed-in member.
 */

/// How often the register looks for orders a kiosk sent to the counter.
let posKioskQueuePoll: Duration = .seconds(10)

struct PosKioskQueueEntry: Equatable, Identifiable {
  let orderID: String
  let number: Int
  let queuedAtMs: Double
  let totalCents: Int
  let itemCount: Int
  var id: String { orderID }
}

/// A queued order, as the register loads it into checkout.
struct PosKioskTaken: Equatable {
  let sale: PosSale
  let number: Int
}

protocol PosKioskQueueAPI: Sendable {
  func queue(registerID: String) async throws -> (entries: [PosKioskQueueEntry], currency: String?)
  func take(registerID: String, orderID: String) async throws -> PosKioskTaken
}

struct ConsolePosKioskQueueAPI: PosKioskQueueAPI {
  let api: ConsoleAPIClient
  let hostID: String

  func queue(registerID: String) async throws -> (entries: [PosKioskQueueEntry], currency: String?) {
    let answer = try await api.request(
      posKioskRoute, query: [("action", "queue"), ("hostId", hostID), ("registerId", registerID)])
    let entries = (answer?["entries"]?.arrayValue ?? []).compactMap { entry -> PosKioskQueueEntry? in
      guard let id = entry["orderId"]?.stringValue else { return nil }
      return PosKioskQueueEntry(
        orderID: id, number: entry["number"]?.cents ?? 0, queuedAtMs: entry["queuedAtMs"]?.numberValue ?? 0,
        totalCents: entry["totalCents"]?.cents ?? 0, itemCount: entry["itemCount"]?.cents ?? 0)
    }
    return (entries, answer?["currency"]?.stringValue)
  }

  func take(registerID: String, orderID: String) async throws -> PosKioskTaken {
    let answer = try await api.request(
      posKioskRoute, method: .post,
      body: .object([
        "action": "take", "hostId": .string(hostID), "registerId": .string(registerID), "orderId": .string(orderID),
      ]))
    guard let sale = answer?["sale"] else { throw ConsoleAPIError(status: 502, message: "That order could not be opened") }
    return PosKioskTaken(sale: readPaymentAnswer(.object(["sale": sale])).sale, number: answer?["number"]?.cents ?? 0)
  }
}

struct OfflinePosKioskQueue: PosKioskQueueAPI {
  private func unreachable() -> ConsoleAPIError {
    ConsoleAPIError(status: 0, message: "The register is offline. Check the connection and try again.")
  }
  func queue(registerID: String) async throws -> (entries: [PosKioskQueueEntry], currency: String?) { throw unreachable() }
  func take(registerID: String, orderID: String) async throws -> PosKioskTaken { throw unreachable() }
}

@MainActor
@Observable
final class PosKioskQueueModel {
  private(set) var entries: [PosKioskQueueEntry] = []
  private(set) var taking: String?

  @ObservationIgnored private let api: PosKioskQueueAPI
  @ObservationIgnored private let registerID: () -> String?

  init(api: PosKioskQueueAPI, registerID: @escaping () -> String?) {
    self.api = api
    self.registerID = registerID
  }

  /// A missed poll is retried on the next tick; the queue keeps what it showed.
  func load() async {
    guard let register = registerID() else {
      entries = []
      return
    }
    if let answer = try? await api.queue(registerID: register) { entries = answer.entries }
  }

  /// Opens a queued order for payment; nil (with the reason) when it cannot be.
  func take(_ entry: PosKioskQueueEntry) async -> Result<PosKioskTaken, ConsoleAPIError> {
    guard let register = registerID(), taking == nil else { return .failure(ConsoleAPIError(status: 409, message: "Wait a moment.")) }
    taking = entry.orderID
    defer { taking = nil }
    do {
      return .success(try await api.take(registerID: register, orderID: entry.orderID))
    } catch {
      await load()
      return .failure(error as? ConsoleAPIError ?? ConsoleAPIError(status: 0, message: "That order could not be opened"))
    }
  }
}

/// "Kiosk orders: sent to the counter to pay". Nothing when the queue is empty.
struct KioskQueueCard: View {
  let model: RegisterModel

  var body: some View {
    let queue = model.kioskQueue
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      if !queue.entries.isEmpty {
        AglynSectionHeader("Kiosk orders") { Text("Sent to the counter to pay").foregroundStyle(.secondary) }
        ForEach(queue.entries) { entry in
          HStack {
            VStack(alignment: .leading, spacing: 2) {
              Text("#\(entry.number)").font(AglynFont.headline)
              Text(
                "\(entry.itemCount) \(entry.itemCount == 1 ? "item" : "items") · \(model.money(entry.totalCents)) · \(Date(timeIntervalSince1970: entry.queuedAtMs / 1000).formatted(date: .omitted, time: .shortened))"
              )
              .font(AglynFont.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button("Take payment") { Task { await model.takeKioskOrder(entry) } }
              .buttonStyle(.aglynProminent)
              .disabled(model.checkout != nil || queue.taking != nil)
              .accessibilityIdentifier("kiosk-take-\(entry.number)")
          }
        }
      }
    }
    .padding(.horizontal, AglynSpace.two)
    .padding(.vertical, queue.entries.isEmpty ? 0 : AglynSpace.one)
    // A sale closing on the register is the moment a queued one may have gone; the poll also runs on a steady beat.
    .task(id: model.register?.id) {
      while !Task.isCancelled {
        await queue.load()
        try? await Task.sleep(for: posKioskQueuePoll)
      }
    }
    .task(id: model.checkout == nil) { await queue.load() }
  }
}
