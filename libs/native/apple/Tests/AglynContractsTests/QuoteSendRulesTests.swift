// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import XCTest

@testable import AglynContracts

/// The console's commerce-quote-email spec cases, and the send section's words, as the apps read them (the Kotlin kit's
/// QuoteSendRulesTest).
final class QuoteSendRulesTests: XCTestCase {
  private func record(_ revision: Int, _ linkVersion: Int, at: Double = 1, to: String = "jane@example.com") -> [String: Any] {
    ["atMs": at, "by": "u", "linkVersion": linkVersion, "messageId": "<m@x>", "revision": revision, "subject": "s", "to": to]
  }

  private func proof(_ revision: Int) -> [String: Any] {
    [
      "addedAtMs": 0, "addedBy": "u", "contentType": "image/png", "id": "p\(revision)", "name": "Proof.png", "path": "x",
      "revision": revision, "size": 1,
    ]
  }

  private func order(_ quote: [String: Any] = [:], lines: Int = 1, status: String = "pending") throws -> HostOrder {
    var section: [String: Any] = [
      "createdAtMs": 0, "createdBy": "u", "customer": ["email": "jane@example.com"], "revision": 1, "stage": "sent",
      "tax": ["kind": "none"], "updatedAtMs": 0, "updatedBy": "u",
    ]
    section.merge(quote) { _, given in given }
    let fields: [String: Any] = [
      "channel": "quote", "status": status, "number": 1042, "quote": section,
      "lineItems": (0..<lines).map { _ in ["name": "Canopy", "productId": "p", "quantity": 1, "unitAmountCents": 1000] },
      "totals": ["discountCents": 0, "feeCents": 0, "itemsCents": 0, "shippingCents": 0, "taxCents": 0, "totalCents": 0],
    ]
    return try JSONDecoder().decode(HostOrder.self, from: JSONSerialization.data(withJSONObject: fields))
  }

  func testANewRevisionReplacesTheLinkOnceAndOnlyOnce() throws {
    XCTAssertFalse(quoteSendReplacesLink(try order().quote))
    XCTAssertFalse(quoteSendReplacesLink(try order(["sends": [record(1, 1)]]).quote))
    XCTAssertTrue(quoteSendReplacesLink(try order(["revision": 2, "sends": [record(1, 1)]]).quote))
    XCTAssertTrue(
      quoteSendReplacesLink(try order(["revision": 3, "linkVersion": 2, "sends": [record(1, 1), record(2, 2)]]).quote))
    XCTAssertFalse(quoteSendReplacesLink(try order(["revision": 2, "linkVersion": 2, "sends": [record(1, 1)]]).quote))
  }

  func testTheSendButtonSaysWhatItSends() throws {
    XCTAssertEqual(quoteSendLabel(try order().quote), "Send quote")
    XCTAssertEqual(quoteSendLabel(try order(["sends": [record(1, 1)]]).quote), "Send again")
    XCTAssertEqual(quoteSendLabel(try order(["revision": 2, "sends": [record(1, 1)]]).quote), "Send revision 2")
    XCTAssertEqual(quoteSendLabel(try order().quote, proofOnly: true), "Send proof")
  }

  func testTheSubjectKeepsTheConversation() throws {
    XCTAssertEqual(quoteEmailDefaultSubject(try order(), businessName: "Acme Signs", quoteId: nil), "Quote #1042 from Acme Signs")
    XCTAssertEqual(quoteEmailDefaultSubject(try order(), businessName: "", quoteId: nil), "Quote #1042")
    let thread: [String: Any] = ["messageId": "<a@b.co>", "references": ["<a@b.co>"], "subject": "Your request"]
    XCTAssertEqual(quoteEmailDefaultSubject(try order(["emailThread": thread]), businessName: "Acme", quoteId: nil), "Your request")
    XCTAssertEqual(quoteEmailDefaultSubject(try order(lines: 0), businessName: "Acme", quoteId: nil), "Proof #1042 from Acme")
  }

  func testTheFormStartsAddressedToTheCustomerElseTheLastSend() throws {
    XCTAssertEqual(quoteSendPrefill(try order(["sends": [record(1, 1, to: "buyer@example.org")]])), "jane@example.com")
    XCTAssertEqual(
      quoteSendPrefill(
        try order(["customer": ["email": ""], "sends": [record(1, 1), record(1, 1, at: 2, to: "buyer@example.org")]])),
      "buyer@example.org")
    XCTAssertEqual(quoteSendPrefill(try order(["customer": ["email": ""]])), "")
  }

  func testTheSectionSaysWhenItWasSentAndWhatTheEmailShows() throws {
    let at = { (ms: Double) in "at \(Int(ms))" }
    XCTAssertEqual(
      quoteSendStatus(try order(), sentAt: at),
      "Not sent yet. Email it with your message, the proof and the PDF, or copy the pay link below and send it yourself.")
    XCTAssertEqual(
      quoteSendStatus(try order(["revision": 2, "sends": [record(1, 1, at: 5)]]), sentAt: at),
      "Sent at 5 to jane@example.com (revision 1).")
    XCTAssertEqual(quoteSendStatus(try order(status: "paid"), sentAt: at), "This quote was paid without being emailed.")
    XCTAssertEqual(
      quoteSendNote(try order(["revision": 2, "proofs": [proof(2)], "requireProofApproval": true]), contact: "hello@example.com"),
      "The email shows the quote number, revision 2 and total, the proof, with the quote attached as a PDF and a button to approve the proof on your site. Replies go to hello@example.com."
    )
    XCTAssertEqual(
      quoteSendNote(try order(), contact: nil),
      "The email shows the quote number, revision 1 and total, with the quote attached as a PDF and a button to pay on your site. Replies go to your email."
    )
  }

  func testApprovalBlocksPayOnlyForAProofedRevisionNotYetApproved() throws {
    XCTAssertFalse(quotePaymentBlockedByApproval(try order(["requireProofApproval": true]).quote))
    XCTAssertTrue(quotePaymentBlockedByApproval(try order(["proofs": [proof(1)], "requireProofApproval": true]).quote))
    XCTAssertFalse(
      quotePaymentBlockedByApproval(
        try order(["proofs": [proof(1)], "requireProofApproval": true, "approvedRevision": 1]).quote))
    XCTAssertEqual(quoteLinkVersion(try order().quote), 1)
    XCTAssertEqual(quoteLinkVersion(try order(["linkVersion": 3]).quote), 3)
  }
}
