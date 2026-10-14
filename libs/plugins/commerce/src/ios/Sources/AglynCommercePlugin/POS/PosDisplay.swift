// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import Observation

/*
 * THE CUSTOMER DISPLAY, from the register (AGL-3608, AGL-3651, AGL-3652): pair a
 * display or a self-service kiosk, mirror the basket onto it, ask the customer
 * for a tip and a receipt choice, and show the thank-you. The Kotlin app's
 * `PosDisplay.kt`, line for line.
 *
 * The register calls the SAME staff half of `commerce/pos-display` the console
 * register calls (`pairing-code`, `push`, `state`, `displays`, `revoke`), as the
 * signed-in member, so every gate holds on the device unchanged. The display
 * state lives server-side only (it can hold a customer's typed address), so the
 * register reads the customer's answer back by polling the route, never from
 * Firestore.
 */

let posDisplayRoute = "/api/commerce/pos-display"

/// How long the register waits for the customer to answer a prompt.
let posDisplayAnswerTimeout: Duration = .seconds(3 * 60)

/// How often the register looks for the customer's answer.
let posDisplayAnswerPoll: Duration = .seconds(1)

/// One paired screen of a register: a customer display or a self-service kiosk.
struct PosPairedDevice: Equatable, Identifiable {
  /// The first 16 characters of the token's hash, which is all the staff API names a device by.
  let id: String
  let label: String
  let mode: PosDeviceMode
  let createdAtMs: Double
  let lastSeenAtMs: Double

  /// Polled within the last two minutes, the console's own "connected".
  func connected(now: Double) -> Bool { now - lastSeenAtMs < 120_000 }
}

/// A six-digit code the paired screen enters, good for ten minutes and usable once.
struct PosPairingCode: Equatable {
  let code: String
  let expiresAtMs: Double
  var spoken: String { code.count == 6 ? "\(code.prefix(3)) \(code.suffix(3))" : code }
}

/// The register's staff half of the display route, as the signed-in member.
protocol PosDisplayAPI: Sendable {
  func state(registerID: String) async throws -> (state: PosDisplayState?, connected: Bool)
  func push(registerID: String, state: PosDisplayState) async throws
  func pairingCode(registerID: String, mode: PosDeviceMode) async throws -> PosPairingCode
  func devices(registerID: String) async throws -> [PosPairedDevice]
  func revoke(registerID: String, deviceID: String) async throws -> Int
}

struct ConsolePosDisplayAPI: PosDisplayAPI {
  let api: ConsoleAPIClient
  let hostID: String

  private func body(_ registerID: String, _ action: String, _ extra: [String: JSONValue] = [:]) -> JSONValue {
    var record: [String: JSONValue] = ["hostId": .string(hostID), "registerId": .string(registerID), "action": .string(action)]
    record.merge(extra) { _, given in given }
    return .object(record)
  }

  func state(registerID: String) async throws -> (state: PosDisplayState?, connected: Bool) {
    let answer = try await api.request(
      posDisplayRoute, query: [("action", "state"), ("hostId", hostID), ("registerId", registerID)])
    var state: PosDisplayState?
    if let raw = answer?["state"], raw != .null, let data = try? raw.encoded() {
      state = try? JSONDecoder().decode(PosDisplayState.self, from: data)
    }
    return (state, answer?["connected"]?.flag ?? false)
  }

  func push(registerID: String, state: PosDisplayState) async throws {
    let encoded = try JSONEncoder().encode(state)
    _ = try await api.request(
      posDisplayRoute, method: .post, body: body(registerID, "push", ["state": JSONValue.decode(encoded) ?? .null]))
  }

  func pairingCode(registerID: String, mode: PosDeviceMode) async throws -> PosPairingCode {
    let answer = try await api.request(
      posDisplayRoute, method: .post, body: body(registerID, "pairing-code", ["mode": .string(mode.rawValue)]))
    guard let code = answer?["code"]?.stringValue else {
      throw ConsoleAPIError(status: 502, message: "The register did not answer with a code.")
    }
    return PosPairingCode(code: code, expiresAtMs: answer?["expiresAtMs"]?.numberValue ?? 0)
  }

  func devices(registerID: String) async throws -> [PosPairedDevice] {
    let answer = try await api.request(posDisplayRoute, method: .post, body: body(registerID, "displays"))
    return (answer?["displays"]?.arrayValue ?? []).compactMap { entry in
      guard let id = entry["id"]?.stringValue else { return nil }
      return PosPairedDevice(
        id: id, label: entry["label"]?.stringValue ?? "Customer display",
        mode: entry["mode"]?.stringValue == "kiosk" ? .kiosk : .display,
        createdAtMs: entry["createdAtMs"]?.numberValue ?? 0, lastSeenAtMs: entry["lastSeenAtMs"]?.numberValue ?? 0)
    }
  }

  func revoke(registerID: String, deviceID: String) async throws -> Int {
    let answer = try await api.request(
      posDisplayRoute, method: .post, body: body(registerID, "revoke", ["displayId": .string(deviceID)]))
    return answer?["revoked"]?.cents ?? 0
  }
}

/// The display route where there is no console to ask: every call finds it unreachable.
struct OfflinePosDisplay: PosDisplayAPI {
  private func unreachable() -> ConsoleAPIError {
    ConsoleAPIError(status: 0, message: "The register is offline. Check the connection and try again.")
  }
  func state(registerID: String) async throws -> (state: PosDisplayState?, connected: Bool) { throw unreachable() }
  func push(registerID: String, state: PosDisplayState) async throws { throw unreachable() }
  func pairingCode(registerID: String, mode: PosDeviceMode) async throws -> PosPairingCode { throw unreachable() }
  func devices(registerID: String) async throws -> [PosPairedDevice] { throw unreachable() }
  func revoke(registerID: String, deviceID: String) async throws -> Int { throw unreachable() }
}

/// The tip the customer screen shows beside the sale: the tips already on its payments, plus one chosen
/// for the payment about to be taken (on the display or by the cashier), which the ledger does not hold
/// until that payment is recorded (`posDisplayTipCents`).
func posDisplayTipCents(saleStatus: String, saleTipCents: Int, pendingTipCents: Int) -> Int {
  let pending = saleStatus == "paid" ? 0 : max(0, pendingTipCents)
  return max(0, saleTipCents) + pending
}

/// What the display shows while the cashier builds the basket, or while a sale is open on it: the lines,
/// then the server's total once the sale is priced, with what is paid and due and the tip so far.
func posDisplayBasketState(cart: Cart, sale: PosSale?, pendingTipCents: Int, now: Int64) -> PosDisplayState {
  guard !cart.isEmpty else { return PosDisplayState(mode: .idle, updatedAtMs: Double(now)) }
  let items = cart.subtotalCents
  let discount = cart.discountCents
  let estimate = items - discount
  let lines = cart.lines.suffix(Int(ContractValues.shared.posDisplayMaxLines)).map {
    PosDisplayLine(
      amountCents: Double($0.unitCents * $0.quantity), name: $0.name, quantity: Double($0.quantity), variantLabel: $0.variantLabel)
  }
  let display = PosDisplayCart(
    discountCents: Double(discount), dueCents: sale.map { Double($0.dueCents) }, itemsCents: Double(items), lines: lines,
    paidCents: sale.map { Double($0.paidCents) }, taxCents: Double(sale.map { max(0, $0.totalCents - estimate) } ?? 0),
    tipCents: sale.map { Double(posDisplayTipCents(saleStatus: $0.status, saleTipCents: $0.tipCents, pendingTipCents: pendingTipCents)) },
    totalCents: Double(sale?.totalCents ?? estimate))
  return PosDisplayState(cart: display, mode: .cart, updatedAtMs: Double(now))
}

/// The register's side of the paired screens: whether one is connected, what it shows, what it is asked, who is paired.
@MainActor
@Observable
final class PosDisplayControl {
  /// A display for this register polled within the last two minutes.
  private(set) var connected = false
  /// The prompt the register is waiting on, if any.
  private(set) var asking: PosDisplayMode?
  private(set) var devices: [PosPairedDevice] = []
  private(set) var pairing: PosPairingCode?
  private(set) var pairingMode = PosDeviceMode.display
  private(set) var busy = false
  private(set) var error: String?
  var notice: String?

  @ObservationIgnored private let api: PosDisplayAPI
  @ObservationIgnored private let registerID: () -> String?
  @ObservationIgnored private let now: () -> Int64
  @ObservationIgnored private let sleep: (Duration) async -> Void
  @ObservationIgnored private let mintKey: () -> String
  @ObservationIgnored private let timeout: Duration
  @ObservationIgnored private let poll: Duration
  /// Each ask takes the next number; an older ask sees it has been replaced and gives up.
  @ObservationIgnored private var generation = 0

  init(
    api: PosDisplayAPI, registerID: @escaping () -> String?, now: @escaping () -> Int64 = nowMs,
    sleep: @escaping (Duration) async -> Void = { try? await Task.sleep(for: $0) },
    mintKey: @escaping () -> String = { newAttemptKey("display") }, timeout: Duration = posDisplayAnswerTimeout,
    poll: Duration = posDisplayAnswerPoll
  ) {
    self.api = api
    self.registerID = registerID
    self.now = now
    self.sleep = sleep
    self.mintKey = mintKey
    self.timeout = timeout
    self.poll = poll
  }

  /// A new register is a new set of screens.
  func reset() {
    connected = false
    devices = []
    pairing = nil
    cancelAsk()
  }

  /// Asks whether a display is polling; the register's beat calls this.
  func check() async {
    guard let register = registerID() else { return }
    do {
      connected = try await api.state(registerID: register).connected
    } catch {
      connected = false
    }
  }

  /// Shows something on the display with no answer expected. Nothing while no display is connected or a prompt waits.
  func show(_ state: PosDisplayState) async {
    guard connected, asking == nil, let register = registerID() else { return }
    try? await api.push(registerID: register, state: state)
  }

  /// Shows the thank-you; the display returns to idle by itself a few seconds later.
  func thank() async { await show(PosDisplayState(mode: .thanks, updatedAtMs: Double(now()))) }

  /// Asks the customer (a tip or a receipt) and returns their answer, or nil when the cashier cancels,
  /// the customer does not answer, or the display cannot be reached.
  func ask(_ state: PosDisplayState) async -> PosDisplayResponse? {
    guard let register = registerID() else { return nil }
    generation += 1
    let mine = generation
    var prompt = state
    let promptID = String(mintKey().prefix(32))
    prompt.promptId = promptID
    prompt.updatedAtMs = Double(now())
    do { try await api.push(registerID: register, state: prompt) } catch { return nil }
    asking = state.mode
    defer { if generation == mine { asking = nil } }
    let ticks = max(1, Int(timeout / poll))
    for _ in 0..<ticks {
      await sleep(poll)
      if generation != mine || Task.isCancelled { return nil }
      if let response = try? await api.state(registerID: register).state?.response, response.promptId == promptID {
        return response
      }
    }
    return nil
  }

  /// The cashier answers for the customer, or the sale moved on.
  func cancelAsk() {
    generation += 1
    asking = nil
  }

  /// A fresh code for a new screen.
  func newPairingCode(_ mode: PosDeviceMode) async {
    guard let register = registerID(), !busy else { return }
    busy = true
    error = nil
    pairingMode = mode
    defer { busy = false }
    do {
      pairing = try await api.pairingCode(registerID: register, mode: mode)
    } catch {
      pairing = nil
      self.error = (error as? ConsoleAPIError)?.message ?? "Could not make a code. Try again."
    }
  }

  func closePairing() { pairing = nil }

  func loadDevices() async {
    guard let register = registerID() else { return }
    do {
      devices = try await api.devices(registerID: register)
      error = nil
    } catch {
      self.error = (error as? ConsoleAPIError)?.message ?? "Could not read the paired screens."
    }
  }

  /// Signs one screen out, or every screen of this register ("*").
  func revoke(_ deviceID: String) async {
    guard let register = registerID(), !busy else { return }
    busy = true
    defer { busy = false }
    do {
      let count = try await api.revoke(registerID: register, deviceID: deviceID)
      notice = count == 1 ? "Screen signed out" : "\(count) screens signed out"
      devices = try await api.devices(registerID: register)
      await check()
    } catch {
      self.error = (error as? ConsoleAPIError)?.message ?? "Could not sign the screen out."
    }
  }
}

/// What the customer is asked for a tip on the display: percentages the store offers, and a custom amount.
func posDisplayTipPrompt(baseCents: Int, percentages: [Double], now: Int64) -> PosDisplayState {
  PosDisplayState(
    mode: .tip, tip: PosDisplayStateTip(allowCustom: true, baseCents: Double(baseCents), percentages: percentages),
    updatedAtMs: Double(now))
}

/// What the customer is asked for their receipt on the display.
func posDisplayReceiptPrompt(smsAvailable: Bool, offerMarketing: Bool, now: Int64) -> PosDisplayState {
  PosDisplayState(
    mode: .receipt,
    receipt: PosDisplayStateReceipt(channels: [PosReceiptChannel.email] + (smsAvailable ? [.sms] : []) + [.print, PosReceiptChannel.none], offerMarketing: offerMarketing),
    updatedAtMs: Double(now))
}

/// "Tap, insert or swipe your card on the reader."
func posDisplayProcessing(now: Int64) -> PosDisplayState {
  PosDisplayState(
    mode: .processing, processing: PosDisplayStateProcessing(message: "Tap, insert or swipe your card on the reader."),
    updatedAtMs: Double(now))
}
