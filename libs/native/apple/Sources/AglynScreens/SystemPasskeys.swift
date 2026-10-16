// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AuthenticationServices
import Foundation
import SwiftUI

/// Makes a passkey with the platform (iCloud Keychain or a security key) from the WebAuthn creation options
/// the console's route answers, the same JSON the console hands `navigator.credentials.create`.
///
/// It needs the app signed with the Associated Domains capability `webcredentials:<relying party>`, and the
/// relying party serving an `apple-app-site-association` that names the app; without them the system refuses
/// with `ASAuthorizationError.notHandled` or `.failed`, and the account screen says the passkey could not be
/// added (docs/mobile/native-architecture.md).
enum SystemPasskeys {
  struct OptionsError: Error, Equatable {
    let field: String
  }

  /// The system's registration request for WebAuthn creation options.
  static func request(for options: JSONValue) throws -> ASAuthorizationPlatformPublicKeyCredentialRegistrationRequest {
    guard let relyingParty = options["rp"]?["id"]?.stringValue, !relyingParty.isEmpty else { throw OptionsError(field: "rp.id") }
    guard let challenge = options["challenge"]?.stringValue.flatMap(ScreenPasskeys.data(fromBase64URL:)) else {
      throw OptionsError(field: "challenge")
    }
    guard let userID = options["user"]?["id"]?.stringValue.flatMap(ScreenPasskeys.data(fromBase64URL:)) else {
      throw OptionsError(field: "user.id")
    }
    let name = options["user"]?["name"]?.stringValue ?? ""
    let request = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: relyingParty)
      .createCredentialRegistrationRequest(challenge: challenge, name: name, userID: userID)
    if let display = options["user"]?["displayName"]?.stringValue, !display.isEmpty { request.displayName = display }
    switch options["authenticatorSelection"]?["userVerification"]?.stringValue {
    case "required": request.userVerificationPreference = .required
    case "discouraged": request.userVerificationPreference = .discouraged
    default: request.userVerificationPreference = .preferred
    }
    // A passkey this authenticator already holds for the account is not made twice.
    if #available(iOS 17.4, macOS 14.4, *) {
      let excluded = options["excludeCredentials"].array.compactMap { entry in
        entry["id"]?.stringValue.flatMap(ScreenPasskeys.data(fromBase64URL:)).map {
          ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: $0)
        }
      }
      if !excluded.isEmpty { request.excludedCredentials = excluded }
    }
    return request
  }

  /// The `RegistrationResponseJSON` the server verifies, from what the system made.
  static func registration(from result: ASAuthorizationResult) throws -> JSONValue {
    guard case .passkeyRegistration(let credential) = result, let attestation = credential.rawAttestationObject else {
      throw OptionsError(field: "registration")
    }
    let id = JSONValue.string(ScreenPasskeys.base64URL(credential.credentialID))
    return [
      "id": id,
      "rawId": id,
      "type": "public-key",
      "authenticatorAttachment": "platform",
      "clientExtensionResults": [:],
      "response": [
        "clientDataJSON": .string(ScreenPasskeys.base64URL(credential.rawClientDataJSON)),
        "attestationObject": .string(ScreenPasskeys.base64URL(attestation)),
        // What a passkey in the iCloud Keychain reports in a browser as well.
        "transports": ["internal", "hybrid"],
      ],
    ]
  }

  /// Runs the ceremony: the system's prompt, then the registration it made.
  @MainActor
  static func create(_ options: JSONValue, using controller: AuthorizationController) async throws -> JSONValue {
    do {
      return try registration(from: try await controller.performRequests([try request(for: options)]))
    } catch let error as ASAuthorizationError where error.code == .canceled {
      throw PasskeyCancelled()
    }
  }

  /// The system's sign-in request for WebAuthn authentication options: a discoverable passkey when the server names no
  /// credential, which is how the console's sign-in page asks.
  static func request(forAssertion options: JSONValue) throws -> ASAuthorizationPlatformPublicKeyCredentialAssertionRequest {
    guard let relyingParty = options["rpId"]?.stringValue, !relyingParty.isEmpty else { throw OptionsError(field: "rpId") }
    guard let challenge = options["challenge"]?.stringValue.flatMap(ScreenPasskeys.data(fromBase64URL:)) else {
      throw OptionsError(field: "challenge")
    }
    let request = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: relyingParty)
      .createCredentialAssertionRequest(challenge: challenge)
    switch options["userVerification"]?.stringValue {
    case "required": request.userVerificationPreference = .required
    case "discouraged": request.userVerificationPreference = .discouraged
    default: request.userVerificationPreference = .preferred
    }
    let allowed = options["allowCredentials"].array.compactMap { entry in
      entry["id"]?.stringValue.flatMap(ScreenPasskeys.data(fromBase64URL:)).map {
        ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: $0)
      }
    }
    if !allowed.isEmpty { request.allowedCredentials = allowed }
    return request
  }

  /// The `AuthenticationResponseJSON` the server verifies, from what the system signed.
  static func assertion(from result: ASAuthorizationResult) throws -> JSONValue {
    guard case .passkeyAssertion(let credential) = result else { throw OptionsError(field: "assertion") }
    let id = JSONValue.string(ScreenPasskeys.base64URL(credential.credentialID))
    var response: [String: JSONValue] = [
      "clientDataJSON": .string(ScreenPasskeys.base64URL(credential.rawClientDataJSON)),
      "authenticatorData": .string(ScreenPasskeys.base64URL(credential.rawAuthenticatorData)),
      "signature": .string(ScreenPasskeys.base64URL(credential.signature)),
    ]
    if let handle = credential.userID { response["userHandle"] = .string(ScreenPasskeys.base64URL(handle)) }
    return [
      "id": id, "rawId": id, "type": "public-key", "authenticatorAttachment": "platform", "clientExtensionResults": [:],
      "response": .object(response),
    ]
  }

  /// Runs the sign-in ceremony: the system's prompt, then the assertion it made.
  @MainActor
  static func get(_ options: JSONValue, using controller: AuthorizationController) async throws -> JSONValue {
    do {
      return try assertion(from: try await controller.performRequests([try request(forAssertion: options)]))
    } catch let error as ASAuthorizationError where error.code == .canceled {
      throw PasskeyCancelled()
    }
  }
}
