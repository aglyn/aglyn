// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import XCTest

@testable import AglynCore

/// A sink that records the Analytics switch and the events, nothing else.
private final class SwitchSink: TelemetrySink, @unchecked Sendable {
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

  func record(_ error: Error, context: String) { add("record \(context)") }
  func breadcrumb(_ message: String) {}
  func setUser(_ uid: String?) {}
  func setValue(_ value: String, forKey key: String) {}
  func log(_ event: String, parameters: [String: String]) { add("event \(event)") }
  func setAnalyticsCollection(_ on: Bool) { add("analytics \(on)") }
}

/// "Your Privacy Choices": the analytics choice kept on this device, read before telemetry starts and applied at once.
final class PrivacyChoicesTests: XCTestCase {
  private var defaults: UserDefaults!
  private let suite = "PrivacyChoicesTests"

  override func setUp() {
    super.setUp()
    defaults = UserDefaults(suiteName: suite)
    defaults.removePersistentDomain(forName: suite)
  }

  override func tearDown() {
    Telemetry.stop()
    defaults.removePersistentDomain(forName: suite)
    super.tearDown()
  }

  /// Nothing stored: what the build does today (Analytics on wherever the build collects).
  func testWithNothingStoredAnalyticsFollowTheBuild() {
    XCTAssertTrue(PrivacyChoices.analyticsAllowed(defaults))
    let sink = SwitchSink()
    Telemetry.start(collecting: true, sink: sink, info: [:], analytics: PrivacyChoices.analyticsAllowed(defaults))
    Telemetry.screen("home")
    XCTAssertEqual(sink.calls, ["analytics true", "event screen_view"])
  }

  /// A choice stored on the device is read before start: off, Analytics is switched off and no event is logged, while
  /// errors still reach crash reports.
  func testAStoredRefusalIsReadBeforeStart() {
    defaults.set(false, forKey: PrivacyChoices.analyticsKey)
    let sink = SwitchSink()
    Telemetry.start(collecting: true, sink: sink, info: [:], analytics: PrivacyChoices.analyticsAllowed(defaults))
    Telemetry.screen("home")
    Telemetry.event(.signIn)
    Telemetry.record(NSError(domain: "x", code: 1), "place")
    XCTAssertEqual(sink.calls, ["analytics false", "record place"])
  }

  /// Flipping the switch stores the choice and calls the collection switch at once, both ways.
  func testFlippingTheSwitchAppliesAtOnce() {
    let sink = SwitchSink()
    Telemetry.start(collecting: true, sink: sink, info: [:], analytics: true)
    PrivacyChoices.setAnalytics(false, defaults)
    XCTAssertFalse(PrivacyChoices.analyticsAllowed(defaults))
    Telemetry.event(.signIn)
    PrivacyChoices.setAnalytics(true, defaults)
    Telemetry.event(.signIn)
    XCTAssertEqual(sink.calls, ["analytics true", "analytics false", "analytics true", "event sign_in"])
  }

  /// A build that does not collect (debug, emulator stack) sends nothing whatever the choice; the choice is still kept.
  func testABuildThatDoesNotCollectStaysSilent() {
    let sink = SwitchSink()
    Telemetry.start(collecting: false, sink: sink, info: [:], analytics: true)
    PrivacyChoices.setAnalytics(false, defaults)
    PrivacyChoices.setAnalytics(true, defaults)
    Telemetry.screen("home")
    XCTAssertEqual(sink.calls, [])
    XCTAssertTrue(PrivacyChoices.analyticsAllowed(defaults))
  }
}
