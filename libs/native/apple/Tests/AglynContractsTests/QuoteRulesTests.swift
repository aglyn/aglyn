// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynContracts

/// The quote rules the console's specs hold (commerce-quote-pay, commerce-invoices, use-merchant-payments), as the
/// Kotlin kit's QuoteRulesTest.
final class QuoteRulesTests: XCTestCase {
  private func quote(_ tax: QuoteTaxBasis, lines: Int = 1) -> HostOrder {
    HostOrder(
      channel: .quote,
      lineItems: (0..<lines).map { _ in OrderLineItem(name: "Canopy", productId: "p", quantity: 1, unitAmountCents: 1000) },
      quote: OrderQuote(
        createdAtMs: 0, createdBy: "u", customer: QuoteCustomer(), revision: 1, stage: .sent, tax: tax, updatedAtMs: 0,
        updatedBy: "u"),
      status: .pending)
  }
  private let undecided = QuoteTaxBasis(kind: .none, reason: .undecided)

  func testAQuoteSavedBeforeTheStoreChoseTakesTheChoiceAsItStandsNow() {
    XCTAssertEqual(quotePayTax(quote(undecided).quote, store: PayLinkStore()).source, "stored")
    XCTAssertEqual(quotePayTax(quote(undecided).quote, store: payLinkStoreOf(["mode": "stripe"])).basis.kind, .atPayment)
    XCTAssertEqual(quotePayTax(quote(undecided).quote, store: payLinkStoreOf(["mode": "none"])).source, "current")
    XCTAssertEqual(quotePayTax(quote(undecided).quote, store: payLinkStoreOf(["mode": "manual"])).source, "save")
    XCTAssertEqual(
      quotePayTax(quote(undecided).quote, store: payLinkStoreOf(["mode": "manual", "pricesIncludeTax": true])).basis.reason,
      .pricesIncludeTax)
    XCTAssertEqual(quotePayTax(quote(QuoteTaxBasis(kind: .rate, pct: 8)).quote, store: payLinkStoreOf(["mode": "stripe"])).source, "stored")
  }

  func testTheNoticeNamesEachGapOnceBothAnswersAreIn() {
    let sent = quote(undecided)
    XCTAssertNil(payLinkGaps(sent, paymentsReady: nil, store: PayLinkStore()))
    XCTAssertNil(payLinkGaps(sent, paymentsReady: true, store: nil))
    XCTAssertEqual(payLinkGaps(sent, paymentsReady: false, store: PayLinkStore()), [.payments, .taxUndecided])
    XCTAssertEqual(payLinkGaps(sent, paymentsReady: true, store: payLinkStoreOf(["mode": "manual"])), [.taxSave])
    XCTAssertEqual(payLinkGaps(sent, paymentsReady: true, store: payLinkStoreOf(["mode": "stripe"])), [])
    XCTAssertEqual(payLinkGaps(quote(undecided, lines: 0), paymentsReady: false, store: PayLinkStore()), [])
    var paid = sent
    paid.status = .paid
    XCTAssertEqual(payLinkGaps(paid, paymentsReady: false, store: PayLinkStore()), [])
    XCTAssertEqual(payLinkGaps(nil, paymentsReady: false, store: payLinkStoreOf(["mode": "none"])), [.payments])
  }

  func testEachReadinessStateHasTheConsolesSentence() {
    XCTAssertEqual(merchantPaymentsBlockedReason("not-connected"), "Connect Stripe to take card payments.")
    XCTAssertEqual(
      merchantPaymentsBlockedReason("mode-unverified"),
      "Reconnect Stripe to take card payments: the connected account has not been confirmed for live payments.")
    XCTAssertEqual(
      merchantPaymentsBlockedReason("mode-mismatch"),
      "Set up payments to take card payments: the connected Stripe account is a test account, and live payments need a live one.")
    XCTAssertNil(merchantPaymentsBlockedReason("ready"))
  }

  func testEachGapSaysWhatToDo() {
    XCTAssertEqual(payLinkGapLine(.payments, paymentsReason: "Connect Stripe to take card payments.", noun: "quote").action, "Open Payments")
    XCTAssertEqual(
      payLinkGapLine(.taxSave, paymentsReason: nil, noun: "quote").text, "Save this quote again to apply the store’s sales tax setting.")
    XCTAssertEqual(payLinkNoticeTitle("quote"), "Customers can’t pay this quote online yet.")
  }

  func testTheLatestAnswerIsTheCurrentRevisions() {
    let action = QuoteCustomerResponseAction.allCases.first!
    var q = quote(undecided).quote!
    q.revision = 2
    q.responses = [QuoteCustomerResponse(action: action, atMs: 1, revision: 1), QuoteCustomerResponse(action: action, atMs: 5, revision: 2)]
    XCTAssertEqual(latestQuoteResponse(q)?.atMs, 5)
    q.revision = 3
    XCTAssertNil(latestQuoteResponse(q))
  }
}
