// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynCommercePlugin

/// A register's receipt printers read and change the way the console's register hardware card does (AGL-3909).
final class PosPrintersTests: XCTestCase {
  func testAPrinterIsWaitingOnlineOrOfflineByItsLastPoll() {
    let now = 10_000_000.0
    XCTAssertEqual(printerDisplayState(state: "online", atMs: nil, nowMs: now), "unknown")
    XCTAssertEqual(printerDisplayState(state: "online", atMs: now - 30_000, nowMs: now), "online")
    XCTAssertEqual(printerDisplayState(state: "paper_out", atMs: now - 60_000, nowMs: now), "paper_out")
    XCTAssertEqual(printerDisplayState(state: "online", atMs: now - 121_000, nowMs: now), "offline")
    XCTAssertEqual(printerStateChip("offline").0, "Offline")
    XCTAssertEqual(printerStateChip("online").0, "Online")
    XCTAssertEqual(printerStateChip("paper_out").0, "Out of paper")
    XCTAssertEqual(printerStateChip("unknown").0, "Waiting for the printer")
  }

  func testLastSeenReadsAsTheConsoleSaysIt() {
    let now = 1_800_000_000_000.0
    XCTAssertEqual(printerSeenAgo(nil, nowMs: now), "never")
    XCTAssertEqual(printerSeenAgo(now - 10_000, nowMs: now), "just now")
    XCTAssertEqual(printerSeenAgo(now - 5 * 60_000, nowMs: now), "5 min ago")
    XCTAssertEqual(printerSeenAgo(now - 3 * 3_600_000, nowMs: now), "3 h ago")
    XCTAssertEqual(printerSeenAgo(now - 72 * 3_600_000, nowMs: now), "3 days ago")
  }

  func testTheFormSendsTheRoutesFieldsAndTheBrandOnlyWhenAdding() {
    var draft = PrinterDraft()
    XCTAssertFalse(draft.complete)
    draft.name = " Counter Star "
    draft.deviceID = "00:11:62:AB:CD:EF"
    XCTAssertTrue(draft.complete)
    let adding = draft.fields(includingBrand: true)
    XCTAssertEqual(adding["brand"], .string("star"))
    XCTAssertEqual(adding["name"], .string("Counter Star"))
    XCTAssertEqual(adding["paperWidthMm"], .number(80))
    XCTAssertEqual(adding["autoPrintReceipts"], .bool(true))
    XCTAssertEqual(adding["kickDrawer"], .bool(true))
    XCTAssertNil(draft.fields(includingBrand: false)["brand"])
  }

  func testAStoredPrinterAndTheRoutesURLAnswerAreRead() {
    let row = PosPrinterRow(
      FirestoreDocument(
        id: "p1",
        data: [
          "name": "Front", "brand": "epson", "model": "TM-m30III", "deviceId": "front-1", "paperWidthMm": 58,
          "autoPrintReceipts": false, "kickDrawer": true, "status": ["state": "online", "atMs": 1_000],
        ]))
    XCTAssertEqual(row.paperWidthMm, 58)
    XCTAssertFalse(row.autoPrintReceipts)
    XCTAssertEqual(row.statusState, "online")
    XCTAssertEqual(PrinterDraft(row).brand, "epson")
    let answer: JSONValue = ["printerId": "p1", "brand": "epson", "pollUrl": "https://console.test/api/commerce/sdp/h/p1/x", "deviceId": "front-1"]
    XCTAssertEqual(PrinterCredentials(answer)?.pollURL, "https://console.test/api/commerce/sdp/h/p1/x")
    XCTAssertNil(PrinterCredentials(["ok": true]))
  }
}
