// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import XCTest

@testable import AglynCommercePlugin

/// A reader with nothing in it: the register's catalog is not under test.
private final class EmptyReader: FirestoreReader, @unchecked Sendable {
  private final class Nothing: FirestoreListening { func remove() {} }

  @MainActor
  func listen(_ query: FirestoreQuery, _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void)
    -> FirestoreListening
  {
    Nothing()
  }

  @MainActor
  func listenDocument(_ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void)
    -> FirestoreListening
  {
    Nothing()
  }

  func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {}
  func deleteDocument(_ path: [String]) async throws {}
}

/// A console that loses its first `lost` requests, then answers every one.
private final class FlakyConsole: HTTPTransport, @unchecked Sendable {
  private let lock = NSLock()
  private var lost: Int
  private(set) var calls = 0

  init(lost: Int) { self.lost = lost }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let drop: Bool = lock.withLock {
      calls += 1
      if lost > 0 {
        lost -= 1
        return true
      }
      return false
    }
    if drop { throw URLError(.notConnectedToInternet) }
    let url = request.url ?? URL(string: "https://console.test")!
    let body = Data(#"{"settings":{"tippingEnabled":true},"terminal":{"available":true,"testMode":true},"readers":[]}"#.utf8)
    return (body, HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!)
  }
}

@MainActor
final class RegisterConnectionTests: XCTestCase {
  private func model(_ console: FlakyConsole) -> RegisterModel {
    let api = ConsoleAPIClient(
      origin: "https://console.test", getIDToken: { _ in "token" }, transport: console, sleep: { _ in }, maxAttempts: 1)
    let model = RegisterModel(hostID: "h1", reader: EmptyReader(), api: api, collector: nil)
    model.reconnectInterval = .milliseconds(20)
    return model
  }

  private func waitUntil(_ what: String, _ condition: @MainActor () -> Bool) async {
    for _ in 0..<200 {
      if condition() { return }
      try? await Task.sleep(for: .milliseconds(10))
    }
    XCTFail("Timed out waiting for \(what)")
  }

  func testARegisterWhoseFirstReadWasLostAsksAgainAndComesBackOnline() async {
    let console = FlakyConsole(lost: 1)
    let register = model(console)
    register.start()
    defer { register.stop() }
    await waitUntil("the beat to reach the console") { register.online && register.context != nil }
    XCTAssertTrue(register.online)
    XCTAssertGreaterThanOrEqual(console.calls, 2)
  }

  func testRetryAsksAtOnce() async {
    let console = FlakyConsole(lost: 1)
    let register = model(console)
    register.reconnectInterval = .seconds(600)
    await register.loadContext()
    XCTAssertFalse(register.online, "a lost first read marks the register offline")
    register.reconnect()
    await waitUntil("the retry to reach the console") { register.online }
    XCTAssertTrue(register.online)
  }
}
