// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import XCTest

@testable import AglynCore

/// A `URLProtocol` stub: each request is recorded and answered from a queue.
final class StubProtocol: URLProtocol {
  enum Answer {
    case status(Int, String)
    case failure(URLError.Code)
  }

  nonisolated(unsafe) static var answers: [Answer] = []
  nonisolated(unsafe) static var requests: [URLRequest] = []

  static func reset(_ answers: [Answer]) {
    self.answers = answers
    requests = []
  }

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    var recorded = request
    if let stream = request.httpBodyStream {
      stream.open()
      var data = Data()
      var buffer = [UInt8](repeating: 0, count: 4096)
      while stream.hasBytesAvailable {
        let count = stream.read(&buffer, maxLength: buffer.count)
        if count <= 0 { break }
        data.append(buffer, count: count)
      }
      recorded.httpBody = data
    }
    Self.requests.append(recorded)
    let answer = Self.answers.isEmpty ? .status(200, "{}") : Self.answers.removeFirst()
    switch answer {
    case .failure(let code):
      client?.urlProtocol(self, didFailWithError: URLError(code))
    case .status(let status, let body):
      let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: Data(body.utf8))
      client?.urlProtocolDidFinishLoading(self)
    }
  }

  override func stopLoading() {}
}

actor TokenLog {
  var forced: [Bool] = []
  func record(_ force: Bool) { forced.append(force) }
}

actor SleepLog {
  var waits: [UInt64] = []
  func record(_ ms: UInt64) { waits.append(ms) }
}

final class ConsoleAPIClientTests: XCTestCase {
  private var session: URLSession!
  private let tokens = TokenLog()
  private let sleeps = SleepLog()

  override func setUp() {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [StubProtocol.self]
    session = URLSession(configuration: configuration)
  }

  private func client(token: String? = "tok", maxAttempts: Int = 3) -> ConsoleAPIClient {
    let tokens = tokens
    let sleeps = sleeps
    return ConsoleAPIClient(
      origin: "https://app.example.com/",
      getIDToken: { force in
        await tokens.record(force)
        return token.map { force ? "\($0)-fresh" : $0 }
      },
      transport: session,
      sleep: { await sleeps.record($0) },
      maxAttempts: maxAttempts)
  }

  func testSendsTheBearerAndBuildsTheURL() async throws {
    StubProtocol.reset([.status(200, #"{"ok":true}"#)])
    let value = try await client().request("/api/x", query: [("a b", "1&2"), ("skip", nil), ("n", "3")])
    XCTAssertEqual(value?["ok"], .bool(true))
    let sent = StubProtocol.requests[0]
    XCTAssertEqual(sent.url?.absoluteString, "https://app.example.com/api/x?a%20b=1%262&n=3")
    XCTAssertEqual(sent.value(forHTTPHeaderField: "Authorization"), "Bearer tok")
    XCTAssertEqual(sent.value(forHTTPHeaderField: "Accept"), "application/json")
  }

  func testSendsARawBodyWithItsOwnContentType() async throws {
    StubProtocol.reset([.status(200, #"{"ok":true}"#)])
    let bytes = Data([0, 1, 2, 3])
    _ = try await client().request("/api/fonts/prepare", method: .post, query: [("hostId", "h1")], rawBody: (bytes, "application/octet-stream"))
    let sent = StubProtocol.requests[0]
    XCTAssertEqual(sent.value(forHTTPHeaderField: "Content-Type"), "application/octet-stream")
    XCTAssertEqual(sent.httpBody, bytes)
    XCTAssertEqual(sent.url?.absoluteString, "https://app.example.com/api/fonts/prepare?hostId=h1")
  }

  func testAPathStartsWithOneSlash() async {
    do {
      _ = try await client().request("//evil.example/x")
      XCTFail("expected a refusal")
    } catch {
      XCTAssertTrue((error as? ConsoleAPIError)?.message.contains("starts with one") == true)
    }
  }

  func testRefreshesTheTokenOnceOnA401() async throws {
    StubProtocol.reset([.status(401, "{}"), .status(200, "{}")])
    try await client().request("/api/x")
    XCTAssertEqual(StubProtocol.requests.map { $0.value(forHTTPHeaderField: "Authorization") }, ["Bearer tok", "Bearer tok-fresh"])
    let forced = await tokens.forced
    XCTAssertEqual(forced, [false, true])
  }

  func testASecond401IsTheAnswer() async {
    StubProtocol.reset([.status(401, "{}"), .status(401, "{}")])
    do {
      try await client().request("/api/x")
      XCTFail("expected a refusal")
    } catch {
      XCTAssertEqual(error as? ConsoleAPIError, ConsoleAPIError(status: 401, message: "Your session ended. Sign in again.", body: .object([:])))
    }
  }

  func testRetriesAGetOnA503WithBackoff() async throws {
    StubProtocol.reset([.status(503, ""), .status(502, ""), .status(200, "{}")])
    try await client().request("/api/x")
    XCTAssertEqual(StubProtocol.requests.count, 3)
    let waits = await sleeps.waits
    XCTAssertEqual(waits, [400, 800])
  }

  func testNeverRetriesAWriteWithoutAnIdempotencyKey() async {
    StubProtocol.reset([.status(503, #"{"error":"Busy"}"#)])
    do {
      try await client().request("/api/x", method: .post, body: ["a": 1])
      XCTFail("expected a refusal")
    } catch {
      XCTAssertEqual((error as? ConsoleAPIError)?.message, "Busy")
      XCTAssertEqual(StubProtocol.requests.count, 1)
      XCTAssertEqual(StubProtocol.requests[0].httpBody, Data(#"{"a":1}"#.utf8))
      XCTAssertEqual(StubProtocol.requests[0].value(forHTTPHeaderField: "Content-Type"), "application/json")
    }
  }

  func testRetriesAnIdempotentWriteAfterANetworkError() async throws {
    StubProtocol.reset([.failure(.networkConnectionLost), .status(200, "{}")])
    try await client().request("/api/x", method: .post, body: [:], idempotencyKey: "k1")
    XCTAssertEqual(StubProtocol.requests.map { $0.value(forHTTPHeaderField: "Idempotency-Key") }, ["k1", "k1"])
  }

  func testAnUnreachableConsoleSaysSo() async {
    StubProtocol.reset([.failure(.notConnectedToInternet), .failure(.notConnectedToInternet)])
    do {
      try await client(maxAttempts: 2).request("/api/x")
      XCTFail("expected a refusal")
    } catch {
      XCTAssertEqual((error as? ConsoleAPIError)?.status, 0)
      XCTAssertEqual((error as? ConsoleAPIError)?.message, "Aglyn could not be reached. Check the connection and try again.")
    }
  }

  func testSignedOutIsRefusedBeforeSending() async {
    StubProtocol.reset([])
    do {
      try await client(token: nil).request("/api/x")
      XCTFail("expected a refusal")
    } catch {
      XCTAssertEqual((error as? ConsoleAPIError)?.message, "Sign in to continue.")
      XCTAssertTrue(StubProtocol.requests.isEmpty)
    }
  }

  func testAnAnonymousCallSendsNoBearer() async throws {
    StubProtocol.reset([.status(200, "{}")])
    try await client(token: nil).request("/api/public", anonymous: true)
    XCTAssertNil(StubProtocol.requests[0].value(forHTTPHeaderField: "Authorization"))
  }

  func testErrorMessagesByStatus() {
    XCTAssertEqual(consoleErrorMessage(status: 400, body: ["message": "Bad name"]), "Bad name")
    XCTAssertEqual(consoleErrorMessage(status: 403, body: nil), "You do not have permission to do that.")
    XCTAssertEqual(consoleErrorMessage(status: 404, body: ["error": ""]), "That was not found.")
    XCTAssertEqual(consoleErrorMessage(status: 500, body: nil), "Aglyn could not be reached. Try again in a moment.")
    XCTAssertEqual(consoleErrorMessage(status: 422, body: nil), "That did not work. Try again.")
  }
}
