// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// Which app this is; stamped on device registrations.
public enum AglynAppID: String, Sendable, CaseIterable {
  case aglyn = "aglyn"
  case pos = "aglyn-pos"
}

/// The public Firebase web config the console builds with. None of it is a secret.
public struct AglynFirebaseOptions: Equatable, Sendable {
  public var apiKey: String
  public var authDomain: String
  public var projectID: String
  public var appID: String
  public var storageBucket: String?
  public var messagingSenderID: String?

  public init(
    apiKey: String, authDomain: String, projectID: String, appID: String,
    storageBucket: String? = nil, messagingSenderID: String? = nil
  ) {
    self.apiKey = apiKey
    self.authDomain = authDomain
    self.projectID = projectID
    self.appID = appID
    self.storageBucket = storageBucket
    self.messagingSenderID = messagingSenderID
  }
}

public struct AglynGoogleClient: Equatable, Sendable {
  public var iosClientID: String
  public var webClientID: String
}

public enum AglynConfigError: Error, Equatable, LocalizedError {
  case notAnOrigin(String)
  case insecureOrigin

  public var errorDescription: String? {
    switch self {
    case .notAnOrigin(let raw): return "AGLYN_CONSOLE_URL is not an origin: \(raw)"
    case .insecureOrigin: return "AGLYN_CONSOLE_URL must be https outside a local stack."
    }
  }
}

/// What an app is started with, read from the Info.plist keys its xcconfig sets.
///
/// The keys and their validation mirror the console's mobile config: an
/// `https:` console origin except on a local stack, emulator hosts as
/// `host:port`, and Google sign-in offered only when both OAuth client ids are
/// configured. Nothing here reads an environment by itself; the app hands it a
/// dictionary (its Info.plist), so tests hand it one too.
public struct AglynConfig: Equatable, Sendable {
  public static let defaultConsoleOrigin = "https://app.aglyn.com"
  public static let defaultBrandName = "Aglyn"

  public var app: AglynAppID
  /// The console origin every API call and WebView page is on.
  public var consoleOrigin: String
  public var firebase: AglynFirebaseOptions
  /// `host:port` of the local Auth emulator, when the app runs against one.
  public var authEmulatorHost: String?
  /// `host:port` of the local Firestore emulator.
  public var firestoreEmulatorHost: String?
  /// Google sign-in; nil (and its button hidden) until configured.
  public var google: AglynGoogleClient?
  /// The product name the app's copy says (white-label and self-hosted builds rename it).
  public var brandName: String

  public static let keys = [
    "AGLYN_CONSOLE_URL", "AGLYN_FIREBASE_API_KEY", "AGLYN_FIREBASE_AUTH_DOMAIN",
    "AGLYN_FIREBASE_PROJECT_ID", "AGLYN_FIREBASE_APP_ID", "AGLYN_FIREBASE_STORAGE_BUCKET",
    "AGLYN_FIREBASE_MESSAGING_SENDER_ID", "AGLYN_AUTH_EMULATOR_HOST",
    "AGLYN_FIRESTORE_EMULATOR_HOST", "AGLYN_GOOGLE_IOS_CLIENT_ID", "AGLYN_GOOGLE_WEB_CLIENT_ID",
    "AGLYN_BRAND_NAME",
  ]

  /// True for the hosts a local development stack runs on.
  public static func isLocalHost(_ host: String) -> Bool {
    host == "localhost" || host == "127.0.0.1" || host == "10.0.2.2" || host.hasSuffix(".localhost")
  }

  private static func clean(_ value: String?) -> String {
    (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  }

  /// `host:port`, or nil for anything else.
  static func hostPort(_ value: String?) -> String? {
    var raw = clean(value)
    if let range = raw.range(of: "^https?://", options: .regularExpression) { raw.removeSubrange(range) }
    return raw.range(of: "^[A-Za-z0-9.-]+:[0-9]{2,5}$", options: .regularExpression) != nil ? raw : nil
  }

  /// An `https:` origin, or `http:` for a local stack only.
  public static func normalizeConsoleOrigin(_ value: String?) throws -> String {
    var raw = clean(value)
    while raw.hasSuffix("/") { raw.removeLast() }
    if raw.isEmpty { return defaultConsoleOrigin }
    let pattern = try! NSRegularExpression(pattern: "^(https?)://([A-Za-z0-9.-]+)(:[0-9]{2,5})?$")
    let ns = raw as NSString
    guard let match = pattern.firstMatch(in: raw, range: NSRange(location: 0, length: ns.length)) else {
      throw AglynConfigError.notAnOrigin(raw)
    }
    let scheme = ns.substring(with: match.range(at: 1))
    let host = ns.substring(with: match.range(at: 2)).lowercased()
    if scheme == "http" && !isLocalHost(host) { throw AglynConfigError.insecureOrigin }
    return raw.lowercased()
  }

  public static func read(_ env: [String: String], app: AglynAppID) throws -> AglynConfig {
    let iosClient = clean(env["AGLYN_GOOGLE_IOS_CLIENT_ID"])
    let webClient = clean(env["AGLYN_GOOGLE_WEB_CLIENT_ID"])
    let bucket = clean(env["AGLYN_FIREBASE_STORAGE_BUCKET"])
    let sender = clean(env["AGLYN_FIREBASE_MESSAGING_SENDER_ID"])
    let brand = clean(env["AGLYN_BRAND_NAME"])
    return AglynConfig(
      app: app,
      consoleOrigin: try normalizeConsoleOrigin(env["AGLYN_CONSOLE_URL"]),
      firebase: AglynFirebaseOptions(
        apiKey: clean(env["AGLYN_FIREBASE_API_KEY"]),
        authDomain: clean(env["AGLYN_FIREBASE_AUTH_DOMAIN"]),
        projectID: clean(env["AGLYN_FIREBASE_PROJECT_ID"]),
        appID: clean(env["AGLYN_FIREBASE_APP_ID"]),
        storageBucket: bucket.isEmpty ? nil : bucket,
        messagingSenderID: sender.isEmpty ? nil : sender
      ),
      authEmulatorHost: hostPort(env["AGLYN_AUTH_EMULATOR_HOST"]),
      firestoreEmulatorHost: hostPort(env["AGLYN_FIRESTORE_EMULATOR_HOST"]),
      google: !iosClient.isEmpty && !webClient.isEmpty
        ? AglynGoogleClient(iosClientID: iosClient, webClientID: webClient) : nil,
      brandName: brand.isEmpty ? defaultBrandName : brand
    )
  }

  /// Reads the `AGLYN_*` keys from a bundle's Info.plist.
  public static func fromBundle(_ bundle: Bundle = .main, app: AglynAppID) throws -> AglynConfig {
    var env: [String: String] = [:]
    for key in keys {
      if let value = bundle.object(forInfoDictionaryKey: key) as? String { env[key] = value }
    }
    return try read(env, app: app)
  }

  /// What is missing for the app to sign anyone in, in words for a build log.
  public var problems: [String] {
    var problems: [String] = []
    if firebase.apiKey.isEmpty { problems.append("AGLYN_FIREBASE_API_KEY is not set.") }
    if firebase.projectID.isEmpty { problems.append("AGLYN_FIREBASE_PROJECT_ID is not set.") }
    if firebase.appID.isEmpty { problems.append("AGLYN_FIREBASE_APP_ID is not set.") }
    if firebase.authDomain.isEmpty { problems.append("AGLYN_FIREBASE_AUTH_DOMAIN is not set.") }
    // A production build pointed at an emulator would sign nobody in.
    if !isLocalConsole {
      if authEmulatorHost != nil { problems.append("The Auth emulator is set for a non-local console.") }
      if firestoreEmulatorHost != nil {
        problems.append("The Firestore emulator is set for a non-local console.")
      }
    }
    return problems
  }

  public var isLocalConsole: Bool {
    AglynConfig.isLocalHost(URL(string: consoleOrigin)?.host?.lowercased() ?? "")
  }
}

/// The product name for copy, set once when the app configures itself.
public enum AglynBrand {
  nonisolated(unsafe) public static var name: String = AglynConfig.defaultBrandName
}
