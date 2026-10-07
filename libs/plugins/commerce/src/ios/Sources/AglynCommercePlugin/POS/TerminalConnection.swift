// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynHardware
import Foundation

/*
 * THE CARD READER'S SERVER SIDE.
 *
 * A device reader (the Stripe Terminal SDK) asks for a connection token
 * whenever it needs one. `commerce/pos-terminal-connection-token` mints it
 * for ONE site, scoped to the site's Terminal Location, after the same gate
 * as a sale. Card-present payments settle on the platform account, so there
 * is no merchant to connect on behalf of: the reader never sets
 * `onBehalfOf`, and the server's intent route alone chooses the account.
 */

let terminalTokenRoute = "/api/commerce/pos-terminal-connection-token"

/// What the readers screen draws: may this site take cards on a device reader yet.
struct TerminalReadiness: Equatable {
  let available: Bool
  let testMode: Bool
  let merchantReady: Bool
  let locationReady: Bool
  var ready: Bool { available && merchantReady && locationReady }
}

/// The route's 409 as a setup error the screen can act on; anything else unchanged.
func asSetupError(_ error: Error) -> Error {
  guard let api = error as? ConsoleAPIError, api.status == 409, case .object(let body)? = api.body,
    case .string(let raw)? = body["code"], let code = CardReaderSetupCode(rawValue: raw)
  else { return error }
  return CardReaderSetupError(code: code, message: api.message)
}

func readReaderSession(_ body: JSONValue?) throws -> CardReaderSession {
  guard case .object(let record)? = body else { throw TerminalSessionError.notSetUp }
  let secret = record["secret"]?.stringValue ?? ""
  let location = record["locationId"]?.stringValue ?? ""
  guard secret.hasPrefix("pst_"), location.hasPrefix("tml_") else { throw TerminalSessionError.notSetUp }
  let name = String((record["merchantDisplayName"]?.stringValue ?? "").prefix(100))
  return CardReaderSession(
    secret: secret, locationID: location, merchantDisplayName: name.isEmpty ? "Store" : name,
    testMode: record["testMode"] == .bool(true))
}

enum TerminalSessionError: Error, LocalizedError {
  case notSetUp
  var errorDescription: String? { "Card readers are not set up for this store yet." }
}

/// Commerce's connection tokens, readiness and Terminal Location for one site.
struct CommerceTerminalConnection: CardReaderSessionSource {
  let api: ConsoleAPIClient

  func session(hostID: String) async throws -> CardReaderSession {
    do {
      return try readReaderSession(
        try await api.request(
          terminalTokenRoute, method: .post, body: ["hostId": .string(hostID), "action": "token"]))
    } catch {
      throw asSetupError(error)
    }
  }

  func readiness(hostID: String) async throws -> TerminalReadiness {
    let body = try await api.request(
      terminalTokenRoute, method: .post, body: ["hostId": .string(hostID), "action": "status"])
    func flag(_ key: String) -> Bool { body?[key] == .bool(true) }
    return TerminalReadiness(
      available: flag("available"), testMode: flag("testMode"), merchantReady: flag("merchantReady"),
      locationReady: flag("locationReady"))
  }
}
