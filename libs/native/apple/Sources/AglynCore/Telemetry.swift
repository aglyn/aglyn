// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

// Crash reporting and product analytics (AGL-4067): one hook every screen and store reports through, so a swallowed
// error, a screen change or a key flow is told to Crashlytics and Analytics from one place. Nothing reaches either
// until `Telemetry.start` is told collection is on, which only a release build pointed at production does
// (`AglynConfig.telemetry`); a debug or emulator build reports nothing. The Kotlin kit's `Telemetry.kt`.
//
// What it may carry is narrow on purpose: the Firebase uid (never an email or a name), screen KEYS such as
// "site.pages" (never a site, page or person name), and event parameters that are identifiers such as a tender
// type, never an amount or anything about a customer.

/// Where telemetry goes: Firebase Crashlytics and Analytics in the apps (`FirebaseTelemetrySink`), a recorder in tests.
public protocol TelemetrySink: AnyObject, Sendable {
  /// A non-fatal error, with where it was caught.
  func record(_ error: Error, context: String)
  /// A breadcrumb in the next crash report.
  func breadcrumb(_ message: String)
  /// The signed-in person's Firebase uid; nil when nobody is signed in.
  func setUser(_ uid: String?)
  /// A custom key on every later crash report.
  func setValue(_ value: String, forKey key: String)
  /// An Analytics event.
  func log(_ event: String, parameters: [String: String])
}

/// The events the apps log. Names follow Firebase's (`screen_view`, `sign_up`) where Firebase has one.
public enum TelemetryEvent: String, Sendable, CaseIterable {
  case screenView = "screen_view"
  case signIn = "sign_in"
  case signUp = "sign_up"
  case workspaceSwitch = "workspace_switch"
  case siteOpen = "site_open"
  case posSaleCompleted = "pos_sale_completed"
}

/// The one telemetry hook (see the file comment).
public enum Telemetry {
  private final class State: @unchecked Sendable {
    let lock = NSLock()
    var sink: TelemetrySink?
    var lastScreen: String?
    var recorded = Set<String>()
  }

  private static let state = State()

  /// Installs the sink. With `collecting` false nothing is ever handed to it: every call below is a no-op.
  public static func start(collecting: Bool, sink: TelemetrySink, app: AglynAppID? = nil, info: [String: Any]? = nil) {
    state.lock.lock()
    state.sink = collecting ? sink : nil
    state.lastScreen = nil
    state.recorded = []
    state.lock.unlock()
    guard collecting else { return }
    let info = info ?? Bundle.main.infoDictionary ?? [:]
    sink.setValue(AppVersion.resolve(info), forKey: "app_version")
    sink.setValue(info["CFBundleVersion"] as? String ?? "0", forKey: "app_build")
    if let app { sink.setValue(app.rawValue, forKey: "app") }
  }

  /// Turns every call into a no-op again (sign-out of a test, a test's tear-down).
  public static func stop() {
    state.lock.lock()
    state.sink = nil
    state.lastScreen = nil
    state.recorded = []
    state.lock.unlock()
  }

  /// Whether anything is collected in this process.
  public static var isCollecting: Bool { current != nil }

  private static var current: TelemetrySink? {
    state.lock.lock()
    defer { state.lock.unlock() }
    return state.sink
  }

  /// A non-fatal error that was caught and handled (a card that shows "could not load", a listener that failed): sent
  /// once per kind and place per launch, so a listener failing on every change cannot crowd out the rest. A
  /// cancellation or a dropped connection is not a fault and is never sent.
  public static func record(_ error: Error, _ context: String) {
    guard !isNoise(error), let sink = current else { return }
    let ns = error as NSError
    let key = "\(context)|\(ns.domain)|\(ns.code)"
    state.lock.lock()
    let first = state.recorded.insert(key).inserted
    state.lock.unlock()
    if first { sink.record(error, context: identifier(context)) }
  }

  /// The screen on show, by its KEY ("site.pages", "home"): a `screen_view` event, the `screen` key on later crash
  /// reports and a breadcrumb. A repeat of the screen already on show is ignored.
  public static func screen(_ key: String) {
    guard let sink = current else { return }
    let key = identifier(key)
    state.lock.lock()
    let changed = state.lastScreen != key
    state.lastScreen = key
    state.lock.unlock()
    guard changed else { return }
    sink.setValue(key, forKey: "screen")
    sink.breadcrumb("screen \(key)")
    sink.log(TelemetryEvent.screenView.rawValue, parameters: ["screen_name": key, "screen_class": key])
  }

  /// A key flow. Parameter values must be identifiers (a tender type, a sign-in method); anything else is dropped.
  public static func event(_ event: TelemetryEvent, _ parameters: [String: String] = [:]) {
    guard let sink = current else { return }
    var clean: [String: String] = [:]
    for (name, value) in parameters where isIdentifier(name) && isIdentifier(value) { clean[name] = value }
    sink.breadcrumb(event.rawValue)
    sink.log(event.rawValue, parameters: clean)
  }

  /// The signed-in person: their Firebase uid only.
  public static func user(_ uid: String?) {
    current?.setUser(uid.flatMap { $0.isEmpty ? nil : $0 })
  }

  /// Where a Firestore call failed, as `record` names it: the operation and the collection's name
  /// ("firestore.listen:hostMemberships"), never a document id. `path` is a collection's (odd length) or a document's.
  public static func firestoreContext(_ operation: String, _ path: [String]) -> String {
    let collection = path.count % 2 == 1 ? path.last : path.dropLast().last
    return "firestore.\(operation):\(collection ?? "")"
  }

  /// Errors that are not faults: a cancelled task or request, and a device that is offline.
  public static func isNoise(_ error: Error) -> Bool {
    if error is CancellationError { return true }
    let ns = error as NSError
    if ns.domain == NSURLErrorDomain {
      return [
        NSURLErrorCancelled, NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost, NSURLErrorTimedOut,
        NSURLErrorDataNotAllowed, NSURLErrorInternationalRoamingOff,
      ].contains(ns.code)
    }
    // WebKit's "frame load interrupted": a navigation the app itself replaced or handed elsewhere.
    if ns.domain == "WebKitErrorDomain" && ns.code == 102 { return true }
    return false
  }

  /// Letters, digits and `._:-`, up to 100 characters: a key or a code, never free text.
  static func isIdentifier(_ value: String) -> Bool {
    !value.isEmpty && value.count <= 100
      && value.unicodeScalars.allSatisfy { CharacterSet.alphanumerics.contains($0) && $0.isASCII || "._:-".unicodeScalars.contains($0) }
  }

  /// `value` when it is an identifier, else "other".
  static func identifier(_ value: String) -> String { isIdentifier(value) ? value : "other" }
}
