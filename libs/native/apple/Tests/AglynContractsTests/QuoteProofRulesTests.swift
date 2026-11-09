// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import XCTest

@testable import AglynContracts

/// The console's visitor-upload and commerce-quote-proofs spec cases, as the apps read them (the Kotlin kit's
/// QuoteProofRulesTest).
final class QuoteProofRulesTests: XCTestCase {
  private func order(revision: Int = 1, proofs: Int = 0, answered: Bool = false, status: String = "pending") throws -> HostOrder {
    let proofList = (0..<proofs).map {
      [
        "addedAtMs": 0, "addedBy": "u", "contentType": "image/png", "id": "p\($0)", "name": "p.png", "path": "x",
        "revision": revision, "size": 1,
      ] as [String: Any]
    }
    var quote: [String: Any] = [
      "createdAtMs": 0, "createdBy": "u", "customer": [:] as [String: Any], "revision": revision, "stage": "sent",
      "tax": ["kind": "none"], "updatedAtMs": 0, "updatedBy": "u", "proofs": proofList,
    ]
    if answered { quote["responses"] = [["action": "approve", "atMs": 1, "revision": revision, "name": "Robin"]] }
    let fields: [String: Any] = [
      "channel": "quote", "status": status, "quote": quote, "lineItems": [] as [Any],
      "totals": ["discountCents": 0, "feeCents": 0, "itemsCents": 0, "shippingCents": 0, "taxCents": 0, "totalCents": 0],
    ]
    return try JSONDecoder().decode(HostOrder.self, from: JSONSerialization.data(withJSONObject: fields))
  }

  func testDrawsOnlyRasterImages() {
    XCTAssertTrue(["image/png", "image/jpeg", "image/webp", "image/gif"].allSatisfy(visitorUploadIsInline))
    for type in ["image/svg+xml", "application/pdf", "application/illustrator", "image/tiff", "text/html"] {
      XCTAssertFalse(visitorUploadIsInline(type))
    }
  }

  func testRefusesOneByteOverAnEmptyFileAndATypeItDoesNotTake() {
    XCTAssertEqual(
      checkVisitorUploadRequest(name: "big.pdf", contentType: "application/pdf", size: visitorUploadMaxBytes + 1),
      "big.pdf is 25 MB. Files can be up to 25 MB.")
    XCTAssertEqual(checkVisitorUploadRequest(name: "empty.pdf", contentType: "application/pdf", size: 0), "empty.pdf is empty.")
    XCTAssertEqual(
      checkVisitorUploadRequest(name: "run.exe", contentType: "", size: 10),
      "run.exe can't be sent. Send a PNG, JPEG, WebP, GIF, PDF, SVG, AI, EPS, PSD or TIFF file.")
    XCTAssertNil(checkVisitorUploadRequest(name: "Logo.PNG", contentType: "image/png", size: visitorUploadMaxBytes))
  }

  func testChecksASelectionForTheCountAsWellAsEachFile() {
    let file = (name: "a.png", contentType: "image/png", size: 10)
    XCTAssertNil(checkVisitorUploadSelection([file, file], already: 8))
    XCTAssertEqual(checkVisitorUploadSelection([file, file, file], already: 8), "Send up to 10 files at a time.")
    XCTAssertTrue(
      checkVisitorUploadSelection([(name: "a.txt", contentType: "text/plain", size: 1)], already: 0)?.contains("can't be sent") == true)
  }

  func testSizesReadAsTheConsoleWritesThem() {
    XCTAssertEqual(formatVisitorUploadBytes(0), "0 KB")
    XCTAssertEqual(formatVisitorUploadBytes(300), "1 KB")
    XCTAssertEqual(formatVisitorUploadBytes(340 * 1024), "340 KB")
    XCTAssertEqual(formatVisitorUploadBytes(2_621_440), "2.5 MB")
    XCTAssertEqual(formatVisitorUploadBytes(3 * 1024 * 1024), "3 MB")
    XCTAssertEqual(formatVisitorUploadBytes(25 * 1024 * 1024), "25 MB")
  }

  func testProofsChangeOnlyOnAnUnpaidUnansweredRevisionWithRoom() throws {
    XCTAssertNil(quoteProofChangeRefusal(try order(), adding: true))
    XCTAssertEqual(
      quoteProofChangeRefusal(try order(proofs: 10), adding: true), "A revision holds up to 10 proofs. Remove one first.")
    XCTAssertNil(quoteProofChangeRefusal(try order(proofs: 10), adding: false))
    XCTAssertEqual(
      quoteProofChangeRefusal(try order(answered: true), adding: false),
      "The customer has answered this revision. Start a new revision to send different proofs.")
    XCTAssertEqual(
      quoteProofChangeRefusal(try order(status: "paid"), adding: true),
      "This quote has been paid, so its proofs can no longer be changed.")
  }

  func testALibraryFileMustBeAKindAProofCanBe() {
    XCTAssertNil(quoteLibraryProofProblem(fileName: "Banner.png", contentType: "image/png", mediaID: "m1", mediaScope: "hosts/site1"))
    XCTAssertEqual(
      quoteLibraryProofProblem(fileName: "Banner.png", contentType: "image/png", mediaID: "", mediaScope: "hosts/site1"),
      "That file can’t be used as a proof. Choose another.")
    XCTAssertEqual(
      quoteLibraryProofProblem(fileName: "Clip.mp4", contentType: "video/mp4", mediaID: "m1", mediaScope: "hosts/site1"),
      "Clip.mp4 can’t be used as a proof. Choose an image or a PDF.")
  }
}
