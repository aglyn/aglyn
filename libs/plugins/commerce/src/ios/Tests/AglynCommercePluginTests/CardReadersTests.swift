// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynCommercePlugin

/// The readers screen's server side: what the readers route lists, and when a pairing may be sent.
final class CardReadersTests: XCTestCase {
  func testTheReadersRouteListsEachSmartReaderWithItsRegister() {
    let list = readPosReadersList(
      .object([
        "available": true, "testMode": true, "locationReady": false,
        "readers": .array([
          .object([
            "id": "tmr_1", "label": "Front counter", "registerId": "r1", "deviceType": "bbpos_wisepos_e",
            "serialNumber": "WSC-1", "status": "online", "livemode": false,
          ]),
          .object(["label": "No id, so not listed"]),
        ]),
      ]))
    XCTAssertTrue(list.available)
    XCTAssertTrue(list.testMode)
    XCTAssertFalse(list.locationReady)
    XCTAssertEqual(list.readers.map(\.id), ["tmr_1"])
    XCTAssertEqual(list.readers.first?.registerID, "r1")
    XCTAssertEqual(list.readers.first?.online, true)
  }

  func testAPairingNeedsTheReadersCode() {
    XCTAssertNil(checkReaderPairing(code: "sepia-cerulean-aqua", address: nil))
    XCTAssertEqual(checkReaderPairing(code: "ab", address: nil), "Enter the code the reader shows on its screen.")
    XCTAssertEqual(checkReaderPairing(code: "not a code!", address: nil), "Enter the code the reader shows on its screen.")
  }

  func testAStoreWithNoReaderAddressGivesOne() {
    var address = ReaderAddress(line1: "100 Main St", city: "Austin", state: "TX", postalCode: "78701", country: "us")
    XCTAssertNil(checkReaderPairing(code: "sepia-cerulean-aqua", address: address))
    address.city = " "
    XCTAssertEqual(checkReaderPairing(code: "sepia-cerulean-aqua", address: address), "Enter the street, city and postal code.")
    address.city = "Austin"
    address.country = "USA"
    XCTAssertEqual(
      checkReaderPairing(code: "sepia-cerulean-aqua", address: address), "Enter the two-letter country code, such as US.")
    XCTAssertEqual(address.json.objectValue["country"], "USA")
  }

  func testAMissingAddressOffersTheFormOnlyToWhoeverMaySetUpTheStoresDevices() {
    XCTAssertTrue(offersReaderAddress(locationReady: false, maySetUpDevices: true))
    XCTAssertFalse(offersReaderAddress(locationReady: false, maySetUpDevices: false))
    XCTAssertFalse(offersReaderAddress(locationReady: true, maySetUpDevices: true))
    XCTAssertEqual(readerAddressPermission, "posDevices")
  }

  func testTheAddressIsCheckedAsThePairingChecksIt() {
    var address = ReaderAddress(line1: "100 Main St", city: "Austin", state: "TX", postalCode: "78701", country: "us")
    XCTAssertNil(checkReaderAddress(address))
    address.postalCode = " "
    XCTAssertEqual(checkReaderAddress(address), "Enter the street, city and postal code.")
    XCTAssertEqual(checkReaderAddress(address), checkReaderPairing(code: "sepia-cerulean-aqua", address: address))
  }

  func testSavingTheAddressGivesTheStoreItsLocationAndTheRowTurnsReady() async throws {
    let transport = ReaderAnswers([
      (200, #"{"locationId":"tml_1"}"#),
      (200, #"{"available":true,"testMode":true,"merchantReady":true,"locationReady":true}"#),
    ])
    let connection = CommerceTerminalConnection(api: readerAPI(transport))
    let address = ReaderAddress(line1: "100 Main St", city: "Austin", state: "TX", postalCode: "78701", country: "us")
    let location = try await connection.registerLocation(hostID: "h1", address: address)
    XCTAssertEqual(location, "tml_1")
    let readiness = try await connection.readiness(hostID: "h1")
    XCTAssertTrue(readiness.locationReady)
    let sent = try XCTUnwrap(transport.bodies.first)
    XCTAssertEqual(sent["action"] as? String, "location")
    XCTAssertEqual(sent["hostId"] as? String, "h1")
    XCTAssertEqual((sent["address"] as? [String: Any])?["country"] as? String, "US")
  }

  func testARefusedSaveShowsTheServersOwnWords() async {
    let connection = CommerceTerminalConnection(api: readerAPI(ReaderAnswers([(400, #"{"error":"Stripe could not use that address."}"#)])))
    do {
      _ = try await connection.registerLocation(
        hostID: "h1", address: ReaderAddress(line1: "1 A St", city: "B", state: "", postalCode: "1", country: "US"))
      XCTFail("A refused save throws")
    } catch {
      XCTAssertEqual(setupFailureMessage(error), "Stripe could not use that address.")
    }
  }

  private func readerAPI(_ transport: ReaderAnswers) -> ConsoleAPIClient {
    ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "token" }, transport: transport, sleep: { _ in }, maxAttempts: 1)
  }
}

/// Answers each request with the next scripted answer, keeping the JSON bodies sent.
private final class ReaderAnswers: HTTPTransport, @unchecked Sendable {
  private let lock = NSLock()
  private var answers: [(Int, String)]
  private(set) var bodies: [[String: Any]] = []
  init(_ answers: [(Int, String)]) { self.answers = answers }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let (status, body) = lock.withLock { () -> (Int, String) in
      if let data = request.httpBody, let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
        bodies.append(object)
      }
      return answers.count > 1 ? answers.removeFirst() : answers[0]
    }
    return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
  }
}
