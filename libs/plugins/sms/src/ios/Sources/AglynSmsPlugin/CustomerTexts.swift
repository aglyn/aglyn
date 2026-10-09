// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import Observation

let orderReceiptRoute = "/api/commerce/order-receipt-send"

/// The store settings document the Customer notifications card writes.
func storeSettingsPath(_ hostID: String) -> [String] { ["hosts", hostID, "settings", "store"] }

/// The words under the switch, as the console card words them.
let textsSwitchTitle = "Also send as texts"
let textsSwitchSupporting = "When an order has the customer\u{2019}s phone number for updates. Customers can reply STOP to opt out."

/// Whether the platform can text, as the receipt route answers the site's admins and editors.
enum TextChannel: Equatable, Sendable {
  case checking
  /// The platform can send texts.
  case available
  /// No provider is set up: the console hides the switch, so there is nothing to switch.
  case unavailable
  /// Only a site admin or editor sees the channels, as the route holds it.
  case notPermitted
  case failed
}

protocol TextsAPI: Sendable {
  /// The receipt route's channel answer: `sms` is true when texts can be sent.
  func channel() async -> TextChannel
}

struct ConsoleTextsAPI: TextsAPI {
  let api: ConsoleAPIClient
  let hostID: String

  func channel() async -> TextChannel {
    do {
      let answer = try await api.request(orderReceiptRoute, method: .get, query: [("hostId", hostID)])
      return answer.boolField("sms") == true ? .available : .unavailable
    } catch let failure as ConsoleAPIError where failure.status == 403 {
      return .notPermitted
    } catch {
      return .failed
    }
  }
}

/// The texts switch for one site: the channel answer, the stored switch and the write.
@MainActor
@Observable
final class CustomerTexts {
  private(set) var channel: TextChannel = .checking
  private(set) var saving = false
  private(set) var error: String?

  @ObservationIgnored private let api: TextsAPI
  @ObservationIgnored private let writer: FirestoreWriter
  @ObservationIgnored private let hostID: String

  init(api: TextsAPI, writer: FirestoreWriter, hostID: String) {
    self.api = api
    self.writer = writer
    self.hostID = hostID
  }

  func check() async {
    channel = .checking
    channel = await api.channel()
  }

  /// The switch, from the store settings document's `buyerNotifications` map.
  func enabled(_ storeSettings: [String: Any]?) -> Bool {
    buyerNotificationEnabled(storeSettings?["buyerNotifications"], "texts")
  }

  /// Writes only the `texts` key, so the card beside it can never be overwritten.
  func set(_ on: Bool) async {
    guard !saving else { return }
    saving = true
    error = nil
    defer { saving = false }
    do {
      try await writer.merge(storeSettingsPath(hostID), ["buyerNotifications": ["texts": on]])
    } catch {
      self.error = "That setting could not be saved. Try again."
    }
  }
}
