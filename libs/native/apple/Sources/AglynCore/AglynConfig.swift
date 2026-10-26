// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// Which app this is; stamped on device registrations.
public enum AglynAppID: String, Sendable, CaseIterable {
  case aglyn = "aglyn"
  case pos = "aglyn-pos"

  /// Whether the server sends this app any push. Aglyn carries every
  /// workspace notification; the register is pushed only the types in the
  /// server's `POS_PUSH_TYPES` (`push-delivery.ts`), which lists none, so
  /// Aglyn POS neither asks for notification permission nor registers a device.
  public var receivesPushes: Bool { self == .aglyn }
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
  case appCheckSetting(String)

  public var errorDescription: String? {
    switch self {
    case .notAnOrigin(let raw): return "AGLYN_CONSOLE_URL is not an origin: \(raw)"
    case .insecureOrigin: return "AGLYN_CONSOLE_URL must be https outside a local stack."
    case .appCheckSetting(let raw): return "AGLYN_APP_CHECK must be on or off, not \(raw)."
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
  /// Where the published Terms of Service and Privacy Policy live (the console's `OPERATOR_LEGAL_ORIGIN`).
  public static let defaultLegalOrigin = "https://aglyn.com"
  /// Where the documentation lives (the console's `NEXT_PUBLIC_DOCS_ORIGIN`).
  public static let defaultDocsOrigin = "https://docs.aglyn.com"

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
  /// The relying party passkeys are made for (`aglyn.com`, the registrable domain the console's passkeys
  /// belong to), set once the app is linked to it (the `webcredentials:` Associated Domains entry and the
  /// domain's `apple-app-site-association`); nil, and the "Set up a passkey" action hidden, until then.
  public var passkeyRelyingParty: String?
  /// Whether Firebase App Check is on (`AGLYN_APP_CHECK`): App Attest on iPhone and iPad, DeviceCheck
  /// on a Mac. Production enforces it, so a Release build has it on; the emulator stack does not, so
  /// it is off there, and off by default whenever an emulator or a local console is configured.
  public var appCheck: Bool = true
  /// The origin the sign-up's Terms of Service and Privacy Policy links point at (`AGLYN_LEGAL_ORIGIN`), the console's
  /// `LEGAL_URLS` (`<origin>/legal/terms`, `<origin>/legal/privacy`).
  public var legalOrigin: String = AglynConfig.defaultLegalOrigin
  /// The origin the Documentation and What's new links point at (`AGLYN_DOCS_ORIGIN`), the console's
  /// `NEXT_PUBLIC_DOCS_ORIGIN`: a self-hosted build's own documentation, never ours presented as theirs.
  public var docsOrigin: String = AglynConfig.defaultDocsOrigin
  /// Whether Sign in with Apple is offered (`AGLYN_APPLE_SIGN_IN`): it needs the app's Sign in with Apple capability and
  /// the Firebase project's Apple provider, so a build turns it on once both exist.
  public var appleSignIn: Bool = false
  /// Whether crash reports, non-fatal errors and Analytics are collected (`AGLYN_TELEMETRY`, AGL-4067): on for a release
  /// build pointed at production, off by default whenever an emulator or a local console is configured, so a debug build
  /// on the emulator stack never reports. `AglynFirebase.configure` also keeps it off in any DEBUG build.
  public var telemetry: Bool = true

  public static let keys = [
    "AGLYN_CONSOLE_URL", "AGLYN_FIREBASE_API_KEY", "AGLYN_FIREBASE_AUTH_DOMAIN",
    "AGLYN_FIREBASE_PROJECT_ID", "AGLYN_FIREBASE_APP_ID", "AGLYN_FIREBASE_STORAGE_BUCKET",
    "AGLYN_FIREBASE_MESSAGING_SENDER_ID", "AGLYN_AUTH_EMULATOR_HOST",
    "AGLYN_FIRESTORE_EMULATOR_HOST", "AGLYN_GOOGLE_IOS_CLIENT_ID", "AGLYN_GOOGLE_WEB_CLIENT_ID",
    "AGLYN_BRAND_NAME", "AGLYN_PASSKEY_RP_ID", "AGLYN_APP_CHECK", "AGLYN_LEGAL_ORIGIN", "AGLYN_APPLE_SIGN_IN",
    "AGLYN_DOCS_ORIGIN", "AGLYN_TELEMETRY",
  ]

  /// True for the hosts a local development stack runs on.
  public static func isLocalHost(_ host: String) -> Bool {
    host == "localhost" || host == "127.0.0.1" || host == "10.0.2.2" || host.hasSuffix(".localhost")
  }

  private static func clean(_ value: String?) -> String {
    (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  }

  /// A domain name (no scheme, port or path) that is not a local host; nil for anything else.
  static func relyingParty(_ value: String?) -> String? {
    let raw = clean(value).lowercased()
    guard raw.range(of: "^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$", options: .regularExpression) != nil,
      !isLocalHost(raw)
    else { return nil }
    return raw
  }

  /// `AGLYN_APP_CHECK`: on or off, or unset for the default (`localStack` decides).
  static func appCheckSetting(_ value: String?, localStack: Bool) throws -> Bool {
    switch clean(value).lowercased() {
    case "": return !localStack
    case "on", "true", "yes", "1": return true
    case "off", "false", "no", "0": return false
    default: throw AglynConfigError.appCheckSetting(clean(value))
    }
  }

  /// `AGLYN_TELEMETRY`: on or off, or unset for the default (on, except on a local stack). Anything else is off: a
  /// typo never turns collection on.
  static func telemetrySetting(_ value: String?, localStack: Bool) -> Bool {
    switch clean(value).lowercased() {
    case "": return !localStack
    case "on", "true", "yes", "1": return !localStack
    default: return false
    }
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
    let origin = try normalizeConsoleOrigin(env["AGLYN_CONSOLE_URL"])
    let authEmulator = hostPort(env["AGLYN_AUTH_EMULATOR_HOST"])
    let firestoreEmulator = hostPort(env["AGLYN_FIRESTORE_EMULATOR_HOST"])
    let localStack =
      authEmulator != nil || firestoreEmulator != nil || isLocalHost(URL(string: origin)?.host?.lowercased() ?? "")
    return AglynConfig(
      app: app,
      consoleOrigin: origin,
      firebase: AglynFirebaseOptions(
        apiKey: clean(env["AGLYN_FIREBASE_API_KEY"]),
        authDomain: clean(env["AGLYN_FIREBASE_AUTH_DOMAIN"]),
        projectID: clean(env["AGLYN_FIREBASE_PROJECT_ID"]),
        appID: clean(env["AGLYN_FIREBASE_APP_ID"]),
        storageBucket: bucket.isEmpty ? nil : bucket,
        messagingSenderID: sender.isEmpty ? nil : sender
      ),
      authEmulatorHost: authEmulator,
      firestoreEmulatorHost: firestoreEmulator,
      google: !iosClient.isEmpty && !webClient.isEmpty
        ? AglynGoogleClient(iosClientID: iosClient, webClientID: webClient) : nil,
      brandName: brand.isEmpty ? defaultBrandName : brand,
      passkeyRelyingParty: relyingParty(env["AGLYN_PASSKEY_RP_ID"]),
      appCheck: try appCheckSetting(env["AGLYN_APP_CHECK"], localStack: localStack),
      legalOrigin: legalOriginSetting(env["AGLYN_LEGAL_ORIGIN"]),
      docsOrigin: originSetting(env["AGLYN_DOCS_ORIGIN"], default: defaultDocsOrigin),
      appleSignIn: ["yes", "on", "true", "1"].contains(clean(env["AGLYN_APPLE_SIGN_IN"]).lowercased()),
      telemetry: telemetrySetting(env["AGLYN_TELEMETRY"], localStack: localStack)
    )
  }

  /// An `https:` origin for the legal documents, or the default.
  static func legalOriginSetting(_ value: String?) -> String { originSetting(value, default: defaultLegalOrigin) }

  /// An `https:` origin, or `fallback`.
  static func originSetting(_ value: String?, default fallback: String) -> String {
    var raw = clean(value)
    while raw.hasSuffix("/") { raw.removeLast() }
    return raw.range(of: "^https://[A-Za-z0-9.-]+(:[0-9]{2,5})?$", options: .regularExpression) != nil
      ? raw.lowercased() : fallback
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

  /// The domain workspace addresses sit under (`acme-inc.aglyn.com`): the console's host without its own label.
  public var workspaceDomain: String {
    let host = URL(string: consoleOrigin)?.host?.lowercased() ?? ""
    let labels = host.split(separator: ".")
    if labels.count >= 3 { return labels.dropFirst().joined(separator: ".") }
    return host.isEmpty || isLocalConsole ? "aglyn.com" : host
  }

  public var isLocalConsole: Bool {
    AglynConfig.isLocalHost(URL(string: consoleOrigin)?.host?.lowercased() ?? "")
  }
}

/// The product name for copy, set once when the app configures itself.
public enum AglynBrand {
  nonisolated(unsafe) public static var name: String = AglynConfig.defaultBrandName
}
