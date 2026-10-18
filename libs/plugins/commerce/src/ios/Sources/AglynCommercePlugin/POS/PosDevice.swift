// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import Observation

/*
 * A PAIRED SCREEN, on the tablet (AGL-3608, AGL-3623, AGL-3651, AGL-3652): the
 * customer display a register turns toward its customer. The Kotlin app's
 * `PosDevice.kt`, line for line. The self-service kiosk shares the pairing, the
 * store's look and the device calls here.
 *
 * It works with NO staff sign-in on the tablet, so it holds nothing but a device
 * token, minted once by the register's six-digit code and good for one register.
 * Every call carries that token (never a staff session) to `commerce/pos-display`,
 * which answers 401 when the token is unknown or revoked, read here as "pair
 * again". The display reads its register's state by polling that route, and
 * everything the customer answers goes back through `respond`, where the server
 * checks it against the prompt it claims to answer, so a stale screen cannot
 * answer the next sale's question.
 */

/// The header a paired screen's token travels in.
let posDeviceTokenHeader = "X-Pos-Display-Token"

/// How often the display asks for news while a sale is on screen, and between sales.
let posDisplayActivePoll: Duration = .seconds(1)
let posDisplayIdlePoll: Duration = .seconds(3)

/// The store's name and logo are re-read this often, so an edit reaches the screen.
let posDeviceBrandingRefreshMs: Int64 = 10 * 60 * 1000

/// The store's look for the idle and thank-you screens.
struct PosDeviceBranding: Equatable {
  let name: String
  let logoURL: URL?
  let logoDarkURL: URL?
  let message: String

  /// The branding the display route sends; its logos are served from `origin`, the console the screen is paired with.
  static func read(_ element: JSONValue?, origin: String) -> PosDeviceBranding? {
    guard let record = element?.objectValue, !record.isEmpty else { return nil }
    // The routes send a library logo as a path on the console's media CDN, read from the paired console.
    func url(_ key: String) -> URL? { mediaPreviewURL(record[key]?.stringValue, origin: origin, hostID: nil, width: 640) }
    return PosDeviceBranding(
      name: record["name"]?.stringValue ?? "Welcome", logoURL: url("logoUrl"), logoDarkURL: url("logoDarkUrl"),
      message: record["message"]?.stringValue ?? "Welcome")
  }
}

/// The display's state as the route hands it to the screen: the register's prompt, with the answer withheld.
struct PosDisplayRead: Equatable {
  let state: PosDisplayState
  /// This prompt has been answered (by this screen or another).
  let answered: Bool
}

/// What the customer sends back for the current prompt.
struct PosDisplayAnswer: Equatable {
  var promptID: String
  var tipChoice: PosDisplayResponseTipChoice?
  var tipPercent: Double?
  var tipCents: Int?
  var receiptChannel: PosReceiptChannel?
  var email: String?
  var phone: String?
  var marketingOptIn: Bool?

  var json: JSONValue {
    var record: [String: JSONValue] = ["promptId": .string(promptID)]
    if let tipChoice { record["tipChoice"] = .string(tipChoice.rawValue) }
    if let tipPercent { record["tipPercent"] = .number(tipPercent) }
    if let tipCents { record["tipCents"] = .number(Double(tipCents)) }
    if let receiptChannel { record["receiptChannel"] = .string(receiptChannel.rawValue) }
    if let email { record["email"] = .string(email) }
    if let phone { record["phone"] = .string(phone) }
    if let marketingOptIn { record["marketingOptIn"] = .bool(marketingOptIn) }
    return .object(record)
  }
}

/// What pairing hands back.
struct PosPaired: Equatable {
  let token: String
  let mode: PosDeviceMode
  let branding: PosDeviceBranding?
}

/// The paired screen's half of the display route, with its device token.
protocol PosDeviceAPI: Sendable {
  func pair(code: String, mode: PosDeviceMode) async throws -> PosPaired
  func poll(token: String, withBranding: Bool) async throws -> (read: PosDisplayRead, branding: PosDeviceBranding?)
  func respond(token: String, answer: PosDisplayAnswer) async throws
  func forget(token: String) async throws
}

struct ConsolePosDeviceAPI: PosDeviceAPI {
  let api: ConsoleAPIClient

  func pair(code: String, mode: PosDeviceMode) async throws -> PosPaired {
    let answer = try await api.request(
      posDisplayRoute, method: .post,
      body: .object([
        "action": "pair", "code": .string(code), "mode": .string(mode.rawValue),
        "label": .string(mode == .kiosk ? "Self-service kiosk" : "Customer display"),
      ]), anonymous: true)
    guard let token = answer?["token"]?.stringValue else {
      throw ConsoleAPIError(status: 502, message: "The register did not answer with a token.")
    }
    return PosPaired(
      token: token, mode: answer?["mode"]?.stringValue == "kiosk" ? .kiosk : .display,
      branding: PosDeviceBranding.read(answer?["branding"], origin: api.origin))
  }

  func poll(token: String, withBranding: Bool) async throws -> (read: PosDisplayRead, branding: PosDeviceBranding?) {
    let answer = try await api.request(
      posDisplayRoute, query: [("action", "poll"), ("branding", withBranding ? "true" : nil)], anonymous: true,
      headers: [posDeviceTokenHeader: token])
    guard let raw = answer?["state"], let data = try? raw.encoded(),
      let state = try? JSONDecoder().decode(PosDisplayState.self, from: data)
    else { throw ConsoleAPIError(status: 502, message: "The register did not answer with a screen.") }
    return (
      PosDisplayRead(state: state, answered: raw["answered"]?.flag ?? false),
      PosDeviceBranding.read(answer?["branding"], origin: api.origin)
    )
  }

  func respond(token: String, answer: PosDisplayAnswer) async throws {
    _ = try await api.request(
      posDisplayRoute, method: .post, body: .object(["action": "respond", "response": answer.json]), anonymous: true,
      headers: [posDeviceTokenHeader: token])
  }

  func forget(token: String) async throws {
    _ = try await api.request(
      posDisplayRoute, method: .post, body: .object(["action": "forget"]), anonymous: true,
      headers: [posDeviceTokenHeader: token])
  }
}

/// Where a paired screen keeps its one secret on the device.
struct PosDeviceTokenStore {
  let defaults: UserDefaults
  let mode: PosDeviceMode

  private var key: String { "commerce.pos.device.token.\(mode.rawValue)" }
  var token: String? {
    get { defaults.string(forKey: key).flatMap { $0.isEmpty ? nil : $0 } }
    nonmutating set { if let newValue { defaults.set(newValue, forKey: key) } else { defaults.removeObject(forKey: key) } }
  }
}

/// What the display shows right now.
enum PosDisplayScreen: Equatable {
  case idle
  case thanks
  case processing(message: String, total: Int?)
  /// The customer answered; the cashier finishes up.
  case answered
  case cart(PosDisplayCart)
  case tip(PosDisplayStateTip, promptID: String)
  case receipt(PosDisplayStateReceipt, promptID: String)
}

@MainActor
@Observable
final class PosCustomerDisplayModel {
  /// nil while the stored token is being read; "" never.
  private(set) var started = false
  private(set) var token: String?
  private(set) var branding: PosDeviceBranding?
  private(set) var read: PosDisplayRead?
  private(set) var offline = false
  private(set) var busy = false
  private(set) var notice: String?
  private(set) var pairError: String?
  private(set) var pairing = false
  @ObservationIgnored private(set) var sentPromptID: String?
  @ObservationIgnored private var thanksKey = ""
  @ObservationIgnored private var thanksShownAt: Int64 = 0
  @ObservationIgnored private var brandingAt: Int64 = 0
  @ObservationIgnored private var promptKey = ""

  @ObservationIgnored private let api: PosDeviceAPI
  @ObservationIgnored private var store: PosDeviceTokenStore
  @ObservationIgnored private let now: () -> Int64

  init(api: PosDeviceAPI, store: PosDeviceTokenStore, now: @escaping () -> Int64 = nowMs) {
    self.api = api
    self.store = store
    self.now = now
  }

  /// Reads the stored token, so a paired display never flashes the pairing screen.
  func start() {
    token = store.token
    started = true
  }

  var currency: String? { read?.state.currency }

  func pair(code: String) async {
    let digits = code.filter(\.isNumber)
    guard digits.count == 6, !pairing else { return }
    pairing = true
    pairError = nil
    defer { pairing = false }
    do {
      let paired = try await api.pair(code: digits, mode: .display)
      store.token = paired.token
      token = paired.token
      branding = paired.branding
      brandingAt = now()
    } catch {
      pairError = (error as? ConsoleAPIError)?.message ?? "That code is not valid. Show a new code on the register."
    }
  }

  /// How long to wait before the next poll: quick while a sale is on screen, slower between sales.
  var pollDelay: Duration { (read?.state.mode ?? .idle) == .idle ? posDisplayIdlePoll : posDisplayActivePoll }

  /// One poll. A 401 unpairs; a lost answer keeps the screen and says it is reconnecting.
  func poll() async {
    guard let token else { return }
    let withBranding = now() - brandingAt > posDeviceBrandingRefreshMs
    do {
      let answer = try await api.poll(token: token, withBranding: withBranding)
      offline = false
      read = answer.read
      if let fresh = answer.branding {
        branding = fresh
        brandingAt = now()
      }
      noteMoves(answer.read.state)
    } catch let failure as ConsoleAPIError where failure.status == 401 {
      unpaired()
    } catch {
      offline = true
    }
  }

  /// A new prompt clears whatever this screen said about the last one; a new thank-you starts its clock.
  private func noteMoves(_ state: PosDisplayState) {
    let key = "\(state.mode.rawValue):\(state.promptId ?? "")"
    if key != promptKey {
      promptKey = key
      notice = nil
    }
    if state.mode == .thanks {
      let thanks = "\(state.promptId ?? ""):\(state.updatedAtMs)"
      if thanks != thanksKey {
        thanksKey = thanks
        thanksShownAt = now()
      }
    } else {
      thanksKey = ""
    }
  }

  /// What to show: the thank-you returns to idle on its own after a few seconds, even if the next poll is late.
  var screen: PosDisplayScreen {
    guard let read else { return .idle }
    let state = read.state
    switch state.mode {
    case .thanks:
      return now() - thanksShownAt > Int64(ContractValues.shared.posDisplayThanksMs) ? .idle : .thanks
    case .processing:
      let due = (state.cart?.dueCents ?? state.cart?.totalCents).map { Int($0) }
      return .processing(message: state.processing?.message ?? "Tap, insert or swipe your card on the reader.", total: due)
    case .tip, .receipt:
      let promptID = state.promptId ?? ""
      if read.answered || (!promptID.isEmpty && promptID == sentPromptID) { return .answered }
      if state.mode == .tip, let tip = state.tip, !promptID.isEmpty { return .tip(tip, promptID: promptID) }
      if state.mode == .receipt, let receipt = state.receipt, !promptID.isEmpty { return .receipt(receipt, promptID: promptID) }
      return state.cart.map(PosDisplayScreen.cart) ?? .idle
    case .cart:
      return state.cart.map(PosDisplayScreen.cart) ?? .idle
    default: return .idle
    }
  }

  /// Sends the customer's answer. A 401 unpairs; a screen that moved on says so.
  func answer(_ answer: PosDisplayAnswer) async {
    guard let token, !busy else { return }
    busy = true
    notice = nil
    defer { busy = false }
    do {
      try await api.respond(token: token, answer: answer)
      sentPromptID = answer.promptID
    } catch let failure as ConsoleAPIError {
      if failure.status == 401 {
        unpaired()
      } else {
        notice = failure.status == 409 ? "That screen has moved on. Check the display." : failure.message
      }
    } catch {
      notice = "Something went wrong. Try again."
    }
  }

  /// Unpairs from the tablet: the route forgets the token (a display only), and the tablet asks for a code again.
  func unpair() async {
    if let token { try? await api.forget(token: token) }
    unpaired()
  }

  private func unpaired() {
    store.token = nil
    token = nil
    read = nil
    branding = nil
    brandingAt = 0
    sentPromptID = nil
    promptKey = ""
    offline = false
  }
}
