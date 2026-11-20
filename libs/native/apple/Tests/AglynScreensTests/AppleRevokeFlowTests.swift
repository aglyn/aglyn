// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import XCTest

@testable import AglynScreens

/// Close account for an account that signs in with Apple (`Reconfirm.AppleRevokeFlow`): "Confirm it is you" asks for
/// Sign in with Apple at most once more, the revoke runs with that authorization's code before the close is sent, and
/// nothing about it can stop the close.
@MainActor
final class AppleRevokeFlowTests: XCTestCase {
  /// What the person does with "Confirm it is you".
  private enum Answer {
    case apple(String)
    case anotherWay
    case close
  }

  private final class Sink: TelemetrySink, @unchecked Sendable {
    var recorded: [String] = []
    func record(_ error: Error, context: String) { recorded.append("\(context) \((error as NSError).code)") }
    func breadcrumb(_ message: String) {}
    func setUser(_ uid: String?) {}
    func setValue(_ value: String, forKey key: String) {}
    func log(_ event: String, parameters: [String: String]) {}
  }

  override func tearDown() {
    Telemetry.stop()
    super.tearDown()
  }

  /// Presses Close my account the way `SpecScreenBody.execute` runs it: every "Confirm it is you" the flow opens is
  /// answered with the next answer, then the close goes out (`AppleRevocation.close`). The log holds each sheet with its
  /// ways, each revoke with its code, and the close.
  private func pressClose(
    providers: [String], methods: [ReconfirmMethod], answers: [Answer],
    revoke: @escaping (String) throws -> Void = { _ in }
  ) async -> [String] {
    var flow = Reconfirm.AppleRevokeFlow()
    var log: [String] = []
    var answers = answers
    for _ in 0..<5 {
      switch flow.next(providers: providers, methods: methods) {
      case .ask(let ways):
        log.append("ask \(ways.map(\.rawValue).joined(separator: ","))")
        switch answers.isEmpty ? .close : answers.removeFirst() {
        case .apple(let code):
          flow.authorized(code: code)
          flow.confirmed()
        case .anotherWay:
          flow.confirmed()
        case .close:
          break
        }
      case .close(let owed, let code):
        await AppleRevocation.close(
          owed: owed, code: code,
          revoke: { code in
            log.append("revoke \(code)")
            try revoke(code)
          }
        ) { log.append("close") }
        return log
      }
    }
    XCTFail("the flow never closed")
    return log
  }

  func testAnAppleOnlyAccountApprovesOnceAndRevokesWithThatCodeBeforeTheClose() async {
    let log = await pressClose(providers: ["apple.com"], methods: [.apple], answers: [.apple("code-1")])
    XCTAssertEqual(log, ["ask apple", "revoke code-1", "close"])
  }

  func testAnAccountWithAPasswordThatPicksAppleIsAlsoAskedOnce() async {
    let log = await pressClose(
      providers: ["password", "apple.com"], methods: [.password, .apple], answers: [.apple("code-1")])
    XCTAssertEqual(log, ["ask password,apple", "revoke code-1", "close"])
  }

  func testConfirmedByPasswordAppleIsAskedOnceMoreThenRevokeThenClose() async {
    let log = await pressClose(
      providers: ["password", "apple.com"], methods: [.password, .apple], answers: [.anotherWay, .apple("code-2")])
    XCTAssertEqual(log, ["ask password,apple", "ask apple", "revoke code-2", "close"])
  }

  func testTheAppleStepClosedWithoutAppleStillClosesAndIsRecorded() async {
    let sink = Sink()
    Telemetry.start(collecting: true, sink: sink, app: .aglyn, info: [:])
    let log = await pressClose(
      providers: ["password", "apple.com"], methods: [.password, .apple], answers: [.anotherWay, .close])
    XCTAssertEqual(log, ["ask password,apple", "ask apple", "close"])
    XCTAssertEqual(sink.recorded, ["\(AppleRevocation.telemetryContext) 1"])
  }

  func testARevokeThatThrowsStillClosesAndIsRecorded() async {
    let sink = Sink()
    Telemetry.start(collecting: true, sink: sink, app: .aglyn, info: [:])
    let log = await pressClose(providers: ["apple.com"], methods: [.apple], answers: [.apple("code-1")]) { _ in
      throw IdentityToolkitError(code: nil, status: 500)
    }
    XCTAssertEqual(log, ["ask apple", "revoke code-1", "close"])
    XCTAssertEqual(sink.recorded, ["\(AppleRevocation.telemetryContext) 2"])
  }

  func testABuildThatCannotRunAppleClosesAndRecordsTheMissingRevoke() async {
    let sink = Sink()
    Telemetry.start(collecting: true, sink: sink, app: .aglyn, info: [:])
    let log = await pressClose(providers: ["password", "apple.com"], methods: [.password], answers: [])
    XCTAssertEqual(log, ["close"])
    XCTAssertEqual(sink.recorded, ["\(AppleRevocation.telemetryContext) 1"])
  }

  func testAnAccountWithoutAppleClosesExactlyAsBefore() async {
    let sink = Sink()
    Telemetry.start(collecting: true, sink: sink, app: .aglyn, info: [:])
    for providers in [["password"], ["google.com"], ["password", "google.com"], ["saml.acme"], []] {
      let log = await pressClose(providers: providers, methods: [.password, .google], answers: [])
      XCTAssertEqual(log, ["close"], "\(providers)")
    }
    XCTAssertEqual(sink.recorded, [])
  }

  func testAnAuthorizationFromTheRoutesOwnAskIsUsedOnTheRetry() {
    // The revoke step closed without Apple, the close went out and the route asked for a fresh sign-in: confirming
    // there with Apple gives the code, and the retry revokes with it, once.
    var flow = Reconfirm.AppleRevokeFlow()
    XCTAssertEqual(flow.next(providers: ["password", "apple.com"], methods: [.password, .apple]), .ask([.password, .apple]))
    XCTAssertEqual(flow.next(providers: ["password", "apple.com"], methods: [.password, .apple]), .close(owed: true, code: nil))
    flow.authorized(code: "late")
    flow.confirmed()
    XCTAssertEqual(flow.next(providers: ["password", "apple.com"], methods: [.password, .apple]), .close(owed: true, code: "late"))
    XCTAssertEqual(flow.next(providers: ["password", "apple.com"], methods: [.password, .apple]), .close(owed: false, code: nil))
  }

  func testTheRouteAskingAgainAfterTheRevokeAsksNothingMore() {
    var flow = Reconfirm.AppleRevokeFlow()
    _ = flow.next(providers: ["apple.com"], methods: [.apple])
    flow.authorized(code: "code-1")
    flow.confirmed()
    XCTAssertEqual(flow.next(providers: ["apple.com"], methods: [.apple]), .close(owed: true, code: "code-1"))
    flow.confirmed()
    XCTAssertEqual(flow.next(providers: ["apple.com"], methods: [.apple]), .close(owed: false, code: nil))
  }
}
