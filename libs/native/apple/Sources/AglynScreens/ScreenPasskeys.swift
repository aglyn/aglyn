// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation

/// The person closed the system's passkey prompt without making one.
public struct PasskeyCancelled: Error, Equatable {
  public init() {}
}

/// Makes a passkey on this device: given the WebAuthn creation options the server answered (the JSON the
/// console hands `navigator.credentials.create`), it asks the platform and returns the registration the
/// server verifies (`RegistrationResponseJSON`). Throws `PasskeyCancelled` when the person dismisses it.
public typealias PasskeyCreator = @Sendable (_ options: JSONValue) async throws -> JSONValue

/// The parts of a passkey ceremony that are not the platform's: the encodings it speaks and the words a
/// failure is shown in.
public enum ScreenPasskeys {
  /// Base64url (RFC 4648 §5, no padding), the encoding every WebAuthn field travels in.
  public static func base64URL(_ data: Data) -> String {
    data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  /// The bytes a base64url text stands for; nil when it is not base64url.
  public static func data(fromBase64URL text: String) -> Data? {
    var base64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    while base64.count % 4 != 0 { base64.append("=") }
    return Data(base64Encoded: base64)
  }

  /// The origin the platform wrote into the credential's client data: the server checks the ceremony
  /// against exactly this (`https://aglyn.com` for an Apple app, `android:apk-key-hash:…` for an Android
  /// one), so it is what the verify request is sent as.
  public static func clientDataOrigin(of registration: JSONValue) -> String? {
    guard let encoded = registration["response"]?["clientDataJSON"]?.stringValue,
      let bytes = data(fromBase64URL: encoded), let client = JSONValue.decode(bytes)
    else { return nil }
    return client["origin"]?.stringValue
  }

  /// The words for a failed ceremony: the action's own for the route's reason (`limit-reached`), else its
  /// general ones.
  public static func message(for error: Error, in passkey: JSONValue, scope: JSONValue) -> String {
    func words(_ text: JSONValue?) -> String? { text?.stringValue.map { ScreenValues.render($0, in: scope) } }
    if let error = error as? ConsoleAPIError {
      let reason = [error.body?["error"], error.body?["reason"]].compactMap { $0?.stringValue }.first
      if let reason, let known = words(passkey["errors"]?[reason]) { return known }
    }
    return words(passkey["otherwise"]) ?? "Adding the passkey failed. Try again."
  }
}
