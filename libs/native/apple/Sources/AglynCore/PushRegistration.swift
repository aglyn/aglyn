// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// The APNs gateway a device token was minted for; a token only works on its own.
public enum ApnsEnvironment: String, Sendable {
  case sandbox
  case production

  /// A debug build is signed for development, so its token is a sandbox
  /// token; a release build (TestFlight, the App Store, Developer ID) is a
  /// production one.
  public static var current: ApnsEnvironment {
    #if DEBUG
      .sandbox
    #else
      .production
    #endif
  }
}

/// What a tapped push carries: the `MobilePushData` the server's APNs sender
/// puts beside `aps` (`libs/aglyn/src/lib/app-utils/mobile-push.ts`).
public struct MobilePushData: Equatable, Sendable {
  public let type: String
  public let link: String?
  public let orgID: String?
  public let hostID: String?

  /// Reads a push's payload back, refusing anything that is not ours. The
  /// link is kept only when it is a console path or an `https` URL, never a
  /// scheme the app would hand to the system.
  public init?(userInfo: [AnyHashable: Any]) {
    func text(_ key: String) -> String? {
      guard let value = userInfo[key] as? String, !value.isEmpty else { return nil }
      return value
    }
    guard let type = text("type") else { return nil }
    self.type = type
    let link = text("link")
    self.link = link.flatMap { $0.hasPrefix("/") || $0.hasPrefix("https://") ? $0 : nil }
    orgID = text("orgId")
    hostID = text("hostId")
  }
}

/// This install's row in the push device registry, `users/{uid}/devices/{installId}`:
/// written by the signed-in owner on launch and when APNs hands out a
/// token, deleted on sign-out. The Firestore rules accept exactly these
/// fields, with `lastSeen` the server's time.
public struct PushDeviceRegistration: @unchecked Sendable {
  public static let collection = "devices"

  public let app: AglynAppID
  public let appVersion: String?
  public let environment: ApnsEnvironment
  /// Thread-safe, as `UserDefaults` documents.
  private let defaults: UserDefaults

  public init(
    app: AglynAppID, appVersion: String? = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
    environment: ApnsEnvironment = .current, defaults: UserDefaults = .standard
  ) {
    self.app = app
    self.appVersion = appVersion
    self.environment = environment
    self.defaults = defaults
  }

  /// The platform the registry names: `ios` for iPhone and iPad, `macos` for the Mac.
  public static var platform: String {
    #if os(macOS)
      "macos"
    #else
      "ios"
    #endif
  }

  private static let installKey = "AglynPushInstallID"

  /// A stable id for this install, minted once; the device row's id.
  public var installID: String {
    if let existing = defaults.string(forKey: Self.installKey), !existing.isEmpty { return existing }
    let minted = UUID().uuidString.lowercased()
    defaults.set(minted, forKey: Self.installKey)
    return minted
  }

  /// An APNs device token as the registry stores it: lowercase hex.
  public static func hex(_ token: Data) -> String {
    token.map { String(format: "%02x", $0) }.joined()
  }

  /// The same check the rules and the server make (`isApnsDeviceToken`).
  public static func isApnsDeviceToken(_ token: String) -> Bool {
    (64...200).contains(token.count) && token.allSatisfy(\.isHexDigit)
  }

  /// The fields the row is written with.
  public func fields(token: String) -> [String: Any] {
    var fields: [String: Any] = [
      "token": token,
      "transport": "apns",
      "apnsEnvironment": environment.rawValue,
      "platform": Self.platform,
      "app": app.rawValue,
      "lastSeen": FirestoreSentinel.serverTimestamp,
    ]
    if let appVersion, !appVersion.isEmpty { fields["appVersion"] = String(appVersion.prefix(32)) }
    return fields
  }

  public func path(uid: String) -> [String] {
    ["users", uid, Self.collection, installID]
  }

  /// Writes (or refreshes) this install's row; a token of the wrong shape is never written.
  public func register(token: Data, uid: String, reader: FirestoreReader) async throws {
    let hex = Self.hex(token)
    guard Self.isApnsDeviceToken(hex) else { return }
    try await reader.setDocument(path(uid: uid), fields(token: hex), merge: true)
  }

  /// Drops this install's row, so a signed-out device is not pushed to.
  public func unregister(uid: String, reader: FirestoreReader) async {
    try? await reader.deleteDocument(path(uid: uid))
  }
}
