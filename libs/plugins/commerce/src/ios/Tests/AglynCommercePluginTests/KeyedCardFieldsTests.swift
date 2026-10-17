// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynHardware
import Foundation
import XCTest

@testable import AglynCommercePlugin

/// The card form's session: the Pay press, Stripe's answer, the register's verdict, and the fields emptied at the end.
/// The numbers are Stripe's published TEST cards.
@MainActor
final class KeyedCardFieldsTests: XCTestCase {
  private let now = Date(timeIntervalSince1970: 1_792_108_800)
  private let request = KeyedCardRequest(
    publishableKey: "pk_test_51Habc", amountCents: 1080, amountText: "$10.80", merchantName: "Corner Shop")

  /// Stripe, as the tests see it: answers each card with a PaymentMethod, or with an error.
  private final class FakeStripe: @unchecked Sendable {
    var calls = 0
    var answer: (Int, String) = (200, #"{"id":"pm_1QabcDEFghi"}"#)
    var tokenizer: StripeCardTokenizer {
      StripeCardTokenizer { [self] request in
        calls += 1
        return (Data(answer.1.utf8), HTTPURLResponse(url: request.url!, statusCode: answer.0, httpVersion: nil, headerFields: nil)!)
      }
    }
  }

  private func session(_ stripe: FakeStripe, verdicts: [KeyedCardVerdict]) -> (CardFormSession, () -> [String], () -> KeyedCardOutcome?) {
    var sent: [String] = []
    var remaining = verdicts
    var closed: KeyedCardOutcome?
    let session = CardFormSession(request: request, tokenizer: stripe.tokenizer, now: { [now] in now }) { paymentMethod in
      sent.append(paymentMethod)
      return remaining.removeFirst()
    }
    session.onClose = { closed = $0 }
    return (session, { sent }, { closed })
  }

  private func type(_ session: CardFormSession, number: String = "4242424242424242", expiry: String = "1234", cvc: String = "123", postal: String = "78701") {
    session.edit(.number, number)
    session.edit(.expiry, expiry)
    session.edit(.cvc, cvc)
    session.edit(.postalCode, postal)
  }

  func testFieldsAreFormattedAsTyped() {
    let (form, _, _) = session(FakeStripe(), verdicts: [])
    type(form)
    XCTAssertEqual(form.fields.number, "4242 4242 4242 4242")
    XCTAssertEqual(form.fields.expiry, "12 / 34")
    XCTAssertTrue(form.isComplete(.number))
    XCTAssertTrue(form.isComplete(.expiry))
  }

  func testTheCursorMovesOnAsEachFieldIsComplete() {
    let (form, _, _) = session(FakeStripe(), verdicts: [])
    XCTAssertEqual(form.type(.number, "4242 4242 4242 424", cursor: .number), .number)
    XCTAssertEqual(form.type(.number, "4242 4242 4242 4242", cursor: .number), .expiry)
    XCTAssertEqual(form.type(.expiry, "12 / 34", cursor: .expiry), .cvc)
    XCTAssertEqual(form.type(.cvc, "123", cursor: .cvc), .postalCode)
    XCTAssertEqual(form.type(.postalCode, "78701", cursor: .postalCode), .postalCode)
  }

  /// A fast typist's keys keep landing in the number after the cursor has moved
  /// on: they go to the expiry and the security code, never onto the number.
  func testKeysTypedAheadOfTheCursorGoToTheFieldItMovedTo() {
    let (form, _, _) = session(FakeStripe(), verdicts: [])
    var cursor = form.type(.number, "4000 0000 0000 0002", cursor: .number)
    XCTAssertEqual(cursor, .expiry)
    for key in ["1", "2", "3", "4"] { cursor = form.type(.number, form.fields.number + key, cursor: cursor) }
    XCTAssertEqual(form.fields.number, "4000 0000 0000 0002")
    XCTAssertEqual(form.fields.expiry, "12 / 34")
    XCTAssertEqual(cursor, .cvc)
    cursor = form.type(.number, form.fields.number + "123", cursor: cursor)
    XCTAssertEqual(form.fields.cvc, "123")
    XCTAssertEqual(cursor, .postalCode)
  }

  /// Back in a finished number on purpose, the cashier edits the number itself.
  func testEditingAFinishedFieldTheCursorIsInStaysInIt() {
    let (form, _, _) = session(FakeStripe(), verdicts: [])
    _ = form.type(.number, "4242 4242 4242 4242", cursor: .number)
    XCTAssertEqual(form.type(.number, "4242 4242 4242 424", cursor: .number), .number)
    XCTAssertEqual(form.fields.number, "4242 4242 4242 424")
    XCTAssertEqual(form.fields.expiry, "")
  }

  func testPayWithAnUnfinishedCardShowsEachErrorAndNeverCallsStripe() async {
    let stripe = FakeStripe()
    let (form, sent, _) = session(stripe, verdicts: [])
    form.edit(.number, "4242 4242")
    await form.pay()
    XCTAssertEqual(stripe.calls, 0)
    XCTAssertTrue(sent().isEmpty)
    XCTAssertEqual(form.error(.number, editing: nil), "The card number is incomplete.")
    XCTAssertEqual(form.error(.expiry, editing: nil), "Enter the expiry date.")
    XCTAssertEqual(form.error(.cvc, editing: nil), "Enter the security code.")
    XCTAssertEqual(form.error(.postalCode, editing: nil), "Enter the billing postal code.")
    form.edit(.number, "4242 4242 4")
    XCTAssertNil(form.error(.number, editing: .number), "editing a field clears its error while it is unfinished")
  }

  func testAnApprovedCardClosesTheFormAndEmptiesIt() async {
    let stripe = FakeStripe()
    let (form, sent, closed) = session(stripe, verdicts: [.paid])
    type(form)
    await form.pay()
    XCTAssertEqual(stripe.calls, 1)
    XCTAssertEqual(sent(), ["pm_1QabcDEFghi"], "the register gets the PaymentMethod, never the card")
    XCTAssertEqual(closed(), .paid)
    XCTAssertEqual(form.fields, CardFields(), "the fields are emptied")
  }

  func testADeclineKeepsTheFormOpenWithTheWordsAndAsksForTheCodeAgain() async {
    let (form, _, closed) = session(FakeStripe(), verdicts: [.declined("Your card was declined.")])
    type(form)
    await form.pay()
    XCTAssertNil(closed())
    XCTAssertEqual(form.message, "Your card was declined.")
    XCTAssertEqual(form.fields.cvc, "")
    XCTAssertEqual(form.fields.number, "4242 4242 4242 4242")
    XCTAssertFalse(form.busy)
  }

  func testStripesRefusalShowsUnderTheFieldAndReachesNoServer() async {
    let stripe = FakeStripe()
    stripe.answer = (402, #"{"error":{"code":"incorrect_cvc","message":"Your card's security code is incorrect."}}"#)
    let (form, sent, closed) = session(stripe, verdicts: [])
    type(form)
    await form.pay()
    XCTAssertTrue(sent().isEmpty)
    XCTAssertNil(closed())
    XCTAssertEqual(form.error(.cvc, editing: nil), "Check the security code.")
  }

  func testALostAnswerClosesTheForm() async {
    let (form, _, closed) = session(FakeStripe(), verdicts: [.lost(lostAnswer)])
    type(form)
    await form.pay()
    XCTAssertEqual(closed(), .lost(lostAnswer))
    XCTAssertEqual(form.fields, CardFields())
  }

  func testCancelClosesAndEmptiesTheForm() {
    let (form, _, closed) = session(FakeStripe(), verdicts: [])
    type(form)
    form.cancel()
    XCTAssertEqual(closed(), .canceled)
    XCTAssertEqual(form.fields, CardFields())
  }

  func testThePresenterOpensOneFormAtATime() async {
    let presenter = CardFieldsPresenter(tokenizer: FakeStripe().tokenizer, now: { [now] in now })
    let first = Task { await presenter.collect(self.request) { _ in .paid } }
    while presenter.session == nil { await Task.yield() }
    let opened = presenter.session
    presenter.dismiss()
    let outcome = await first.value
    XCTAssertEqual(outcome, .canceled)
    XCTAssertNil(presenter.session)
    XCTAssertNotNil(opened)
  }
}
