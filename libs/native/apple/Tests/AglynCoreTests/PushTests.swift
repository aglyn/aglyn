// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import XCTest

@testable import AglynCore

/// The console's own answers, recorded by `generate-native-contracts.mjs`.
private func functionCases(_ name: String) throws -> [(args: [Any], result: Any)] {
  let url = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().appendingPathComponent("contracts/function-cases.generated.json")
  let root = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
  let function = (root?["functions"] as? [String: Any])?[name] as? [String: Any]
  let cases = try XCTUnwrap(function?["cases"] as? [[String: Any]], "no cases for \(name)")
  return cases.map { ($0["args"] as? [Any] ?? [], $0["result"] ?? NSNull()) }
}

final class PushContractTests: XCTestCase {
  func testThePushSwitchAnswersAsTheConsoleDoes() throws {
    let cases = try functionCases("accountPushSwitch")
    XCTAssertFalse(cases.isEmpty)
    for (index, item) in cases.enumerated() {
      let args = item.args
      let answer = accountPushSwitch(
        settings: args[0] as? [String: Any], type: args[1] as! String, category: args[2] as! String,
        consoleDefault: (args[3] as! NSNumber).boolValue, legacyPrefs: args.count > 4 ? args[4] as? [String: Any] : nil)
      XCTAssertEqual(answer, (item.result as! NSNumber).boolValue, "case \(index): \(args)")
    }
  }

  func testATappedPushIsReadAsTheConsoleReadsIt() throws {
    let cases = try functionCases("readMobilePushData")
    XCTAssertFalse(cases.isEmpty)
    for (index, item) in cases.enumerated() {
      let input = item.args.first as? [String: Any] ?? [:]
      let read = MobilePushData(userInfo: input)
      guard let expected = item.result as? [String: Any] else {
        XCTAssertNil(read, "case \(index)")
        continue
      }
      XCTAssertEqual(read?.type, expected["type"] as? String, "case \(index)")
      XCTAssertEqual(read?.link, expected["link"] as? String, "case \(index)")
      XCTAssertEqual(read?.orgID, expected["orgId"] as? String, "case \(index)")
      XCTAssertEqual(read?.hostID, expected["hostId"] as? String, "case \(index)")
    }
  }
}

final class PushDeviceRegistrationTests: XCTestCase {
  private var defaults: UserDefaults!

  override func setUp() {
    defaults = UserDefaults(suiteName: "PushDeviceRegistrationTests")
    defaults.removePersistentDomain(forName: "PushDeviceRegistrationTests")
  }

  func testTheRowCarriesOnlyTheRegistrysFields() {
    let registration = PushDeviceRegistration(app: .pos, appVersion: "1.2.3", environment: .sandbox, defaults: defaults)
    let fields = registration.fields(token: String(repeating: "ab", count: 32))
    XCTAssertEqual(
      Set(fields.keys), ["token", "transport", "apnsEnvironment", "platform", "app", "appVersion", "lastSeen"])
    XCTAssertEqual(fields["transport"] as? String, "apns")
    XCTAssertEqual(fields["apnsEnvironment"] as? String, "sandbox")
    XCTAssertEqual(fields["app"] as? String, "aglyn-pos")
    XCTAssertEqual(fields["platform"] as? String, PushDeviceRegistration.platform)
    XCTAssertTrue(fields["lastSeen"] is FirestoreSentinel)
  }

  func testTheInstallIDIsMintedOnce() {
    let first = PushDeviceRegistration(app: .aglyn, defaults: defaults).installID
    let second = PushDeviceRegistration(app: .aglyn, defaults: defaults).installID
    XCTAssertEqual(first, second)
    XCTAssertEqual(PushDeviceRegistration(app: .aglyn, defaults: defaults).path(uid: "u1"), ["users", "u1", "devices", first])
  }

  func testATokenIsWrittenAsLowercaseHexOfTheRulesLength() {
    let token = Data((0..<32).map { UInt8($0 * 7 % 256) })
    let hex = PushDeviceRegistration.hex(token)
    XCTAssertEqual(hex.count, 64)
    XCTAssertEqual(hex, hex.lowercased())
    XCTAssertTrue(PushDeviceRegistration.isApnsDeviceToken(hex))
    XCTAssertFalse(PushDeviceRegistration.isApnsDeviceToken(String(hex.prefix(62))))
    XCTAssertFalse(PushDeviceRegistration.isApnsDeviceToken(String(repeating: "z", count: 64)))
  }
}

final class NotificationCatalogTests: XCTestCase {
  func testTheBundledCatalogLoads() {
    let catalog = NotificationCatalog.shared
    XCTAssertFalse(catalog.categories.isEmpty)
    XCTAssertNotNil(catalog.entry("content.order"))
  }

  func testAStampedLevelWinsAndATypeFallsBackToItsOwn() {
    let catalog = NotificationCatalog.shared
    XCTAssertEqual(catalog.level(stamped: "warning", type: "content.order"), "warning")
    XCTAssertEqual(catalog.level(stamped: nil, type: "billing.paymentFailed"), catalog.entry("billing.paymentFailed")?.level)
    XCTAssertEqual(catalog.level(stamped: nil, type: "nope"), "info")
    XCTAssertEqual(catalog.level(stamped: "bogus", type: nil), "info")
  }
}
