// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import XCTest

@testable import AglynCore

/// Everything Telemetry hands its sink, in order.
final class RecordingSink: TelemetrySink, @unchecked Sendable {
  private let lock = NSLock()
  private var _calls: [String] = []
  var calls: [String] {
    lock.lock()
    defer { lock.unlock() }
    return _calls
  }

  private func add(_ call: String) {
    lock.lock()
    _calls.append(call)
    lock.unlock()
  }

  func record(_ error: Error, context: String) { add("record \(context) \((error as NSError).code)") }
  func breadcrumb(_ message: String) { add("crumb \(message)") }
  func setUser(_ uid: String?) { add("user \(uid ?? "-")") }
  func setValue(_ value: String, forKey key: String) { add("key \(key)=\(value)") }
  func log(_ event: String, parameters: [String: String]) {
    add("event \(event) \(parameters.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: ","))")
  }
}

final class TelemetryTests: XCTestCase {
  override func tearDown() {
    Telemetry.stop()
    super.tearDown()
  }

  private func driveEverything() {
    Telemetry.record(NSError(domain: "FIRFirestoreErrorDomain", code: 7), "firestore.listen:sites")
    Telemetry.screen("site.pages")
    Telemetry.event(.posSaleCompleted, ["tender": "cash"])
    Telemetry.user("uid-1")
  }

  func testTheHookIsANoOpWhenCollectionIsOff() {
    let sink = RecordingSink()
    Telemetry.start(collecting: false, sink: sink, app: .aglyn, info: ["CFBundleShortVersionString": "1.0.0"])
    XCTAssertFalse(Telemetry.isCollecting)
    driveEverything()
    XCTAssertEqual(sink.calls, [])
  }

  func testCollectionOnReportsTheVersionScreenEventsUidAndErrors() {
    let sink = RecordingSink()
    Telemetry.start(
      collecting: true, sink: sink, app: .pos, info: ["AGLYN_VERSION": "1.0.0-beta.282", "CFBundleVersion": "202610251200"])
    XCTAssertTrue(Telemetry.isCollecting)
    driveEverything()
    XCTAssertEqual(
      sink.calls,
      [
        "key app_version=1.0.0-beta.282", "key app_build=202610251200", "key app=aglyn-pos",
        "record firestore.listen:sites 7",
        "key screen=site.pages", "crumb screen site.pages", "event screen_view screen_class=site.pages,screen_name=site.pages",
        "crumb pos_sale_completed", "event pos_sale_completed tender=cash",
        "user uid-1",
      ])
  }

  func testStoppingTurnsTheHookBackIntoANoOp() {
    let sink = RecordingSink()
    Telemetry.start(collecting: true, sink: sink, info: [:])
    Telemetry.stop()
    let before = sink.calls
    driveEverything()
    XCTAssertEqual(sink.calls, before)
  }

  func testAnErrorIsSentOncePerKindAndPlaceAndNoiseNever() {
    let sink = RecordingSink()
    Telemetry.start(collecting: true, sink: sink, info: [:])
    let denied = NSError(domain: "FIRFirestoreErrorDomain", code: 7)
    Telemetry.record(denied, "firestore.listen:sites")
    Telemetry.record(denied, "firestore.listen:sites")
    Telemetry.record(denied, "firestore.listen:orgs")
    Telemetry.record(CancellationError(), "firestore.listen:sites")
    Telemetry.record(URLError(.notConnectedToInternet), "firestore.listen:sites")
    Telemetry.record(URLError(.cancelled), "webview.navigation")
    XCTAssertEqual(sink.calls.filter { $0.hasPrefix("record") }, ["record firestore.listen:sites 7", "record firestore.listen:orgs 7"])
  }

  func testOnlyIdentifiersLeaveTheApp() {
    let sink = RecordingSink()
    Telemetry.start(collecting: true, sink: sink, info: [:])
    // A name or free text in a screen key or a parameter is never sent as it is.
    Telemetry.screen("Jordan's Bakery")
    Telemetry.event(.signIn, ["method": "password", "email": "jordan@example.com", "note": "two words"])
    Telemetry.screen("site.pages")
    Telemetry.screen("site.pages")
    XCTAssertEqual(
      sink.calls,
      [
        "key app_version=0", "key app_build=0",
        "key screen=other", "crumb screen other", "event screen_view screen_class=other,screen_name=other",
        "crumb sign_in", "event sign_in method=password",
        "key screen=site.pages", "crumb screen site.pages", "event screen_view screen_class=site.pages,screen_name=site.pages",
      ])
    XCTAssertEqual(Telemetry.firestoreContext("listen", ["users", "u1", "hostMemberships"]), "firestore.listen:hostMemberships")
    XCTAssertEqual(Telemetry.firestoreContext("listen_document", ["hosts", "h1"]), "firestore.listen_document:hosts")
  }

  func testTelemetryIsOnForProductionAndOffForTheEmulatorStack() throws {
    let production = [
      "AGLYN_FIREBASE_API_KEY": "key", "AGLYN_FIREBASE_AUTH_DOMAIN": "x.firebaseapp.com",
      "AGLYN_FIREBASE_PROJECT_ID": "x", "AGLYN_FIREBASE_APP_ID": "1:1:ios:1",
    ]
    XCTAssertTrue(try AglynConfig.read(production, app: .aglyn).telemetry)
    var off = production
    off["AGLYN_TELEMETRY"] = "off"
    XCTAssertFalse(try AglynConfig.read(off, app: .aglyn).telemetry)
    off["AGLYN_TELEMETRY"] = "maybe"
    XCTAssertFalse(try AglynConfig.read(off, app: .aglyn).telemetry)
    var emulator = production
    emulator["AGLYN_CONSOLE_URL"] = "http://localhost:4200"
    emulator["AGLYN_AUTH_EMULATOR_HOST"] = "127.0.0.1:9099"
    XCTAssertFalse(try AglynConfig.read(emulator, app: .aglyn).telemetry)
    // Even asked for, a local stack never reports.
    emulator["AGLYN_TELEMETRY"] = "on"
    XCTAssertFalse(try AglynConfig.read(emulator, app: .aglyn).telemetry)
    XCTAssertTrue(AglynConfig.keys.contains("AGLYN_TELEMETRY"))
  }

  /// Nothing is sent before the config decides: both apps keep Crashlytics and Analytics off in Info.plist, carry the
  /// setting, and turn off ad personalization signals.
  func testBothAppsStartWithCollectionOff() throws {
    let repo = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    let config = repo.appendingPathComponent("apps/ios/Config")
    for name in ["Aglyn-Info.plist", "AglynPOS-Info.plist"] {
      let data = try Data(contentsOf: config.appendingPathComponent(name))
      let plist = try XCTUnwrap(PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any])
      XCTAssertEqual(plist["FirebaseCrashlyticsCollectionEnabled"] as? Bool, false, name)
      XCTAssertEqual(plist["FIREBASE_ANALYTICS_COLLECTION_ENABLED"] as? Bool, false, name)
      XCTAssertEqual(plist["GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_PERSONALIZATION_SIGNALS"] as? Bool, false, name)
      XCTAssertEqual(plist["AGLYN_TELEMETRY"] as? String, "$(AGLYN_TELEMETRY)", name)
    }
    let emulator = try String(contentsOf: config.appendingPathComponent("Emulator.xcconfig"), encoding: .utf8)
    XCTAssertTrue(emulator.contains("AGLYN_TELEMETRY = off"))
    for app in ["Aglyn", "AglynPOS"] {
      let manifest = try Data(contentsOf: repo.appendingPathComponent("apps/ios/\(app)/PrivacyInfo.xcprivacy"))
      let plist = try XCTUnwrap(PropertyListSerialization.propertyList(from: manifest, format: nil) as? [String: Any])
      XCTAssertEqual(plist["NSPrivacyTracking"] as? Bool, false, app)
    }
  }
}
