// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynHardware
import Foundation
import XCTest

@testable import AglynCommercePlugin

/*
 * "ENTER CARD MANUALLY": the register's own card fields. These tests hand the
 * tender a fake `KeyedCardEntry` that "types" PaymentMethods in order (what
 * Stripe answers for each card) and hold everything else: the route's words,
 * the key, how each server answer closes the form or keeps it open, and the
 * attempt key each card is sent under.
 */

private let opened = PosOpenedSale(
  orderID: "o1", subtotalCents: 1000, discountCents: 0, taxCents: 80, totalCents: 1080, dueCents: 1080, stockWarnings: [])

private func keyedPayment(_ status: String, id: String = "pay1", tip: Int = 0, failure: String? = nil) -> PosSalePayment {
  PosSalePayment(
    id: id, method: "card_keyed", amountCents: 1080, tipCents: tip, status: status,
    cardBrand: status == "succeeded" ? "visa" : nil, last4: status == "succeeded" ? "4242" : nil, changeCents: 0,
    readerID: nil, failureMessage: failure)
}

private func keyedAnswer(due: Int, _ payment: PosSalePayment?, completed: Bool = false) -> PosPaymentAnswer {
  PosPaymentAnswer(
    sale: PosSale(
      orderID: "o1", status: due == 0 ? "paid" : "pending", totalCents: 1080, paidCents: 1080 - due, dueCents: due,
      tenderableCents: due, tipCents: 0, payments: payment.map { [$0] } ?? []),
    paymentID: payment?.id, completed: completed, clientSecret: nil, paymentIntentID: nil)
}

/// The card fields, as the tests see them: each "card" is the PaymentMethod Stripe made from it.
@MainActor
private final class FakeCardForm: KeyedCardEntry {
  let cards: [String]
  private(set) var requests: [KeyedCardRequest] = []
  private(set) var verdicts: [KeyedCardVerdict] = []
  private(set) var dismissed = false

  init(_ cards: [String]) { self.cards = cards }

  func collect(_ request: KeyedCardRequest, submit: @escaping @MainActor (String) async -> KeyedCardVerdict) async
    -> KeyedCardOutcome
  {
    requests.append(request)
    for card in cards {
      let verdict = await submit(card)
      verdicts.append(verdict)
      switch verdict {
      case .paid: return .paid
      case .lost(let words): return .lost(words)
      case .declined: continue
      }
    }
    return .canceled
  }

  func dismiss() { dismissed = true }
}

@MainActor
final class KeyedCardTenderTests: XCTestCase {
  private func service(_ form: FakeCardForm, key: String = "pk_test_51Habc") -> KeyedCardService {
    KeyedCardService(entry: form, publishableKey: key, merchantName: "Corner Shop")
  }

  private func checkout(_ api: ScriptedSaleAPI) -> Checkout {
    Checkout(api: api, opened: opened, settings: PosRegisterSettings(tippingEnabled: true, tipPercentages: [20]), sleep: { _ in })
  }

  func testTheRouteSendsOnlyThePaymentMethodNeverTheCard() {
    let step = SaleStep.cardKeyed(amountCents: 1080, tipCents: 200, paymentMethodID: "pm_1QabcDEF")
    let body = step.body(hostID: "h1", orderID: "o1").objectValue
    XCTAssertEqual(body["action"], "card-keyed")
    XCTAssertEqual(body["amountCents"], .number(1080))
    XCTAssertEqual(body["tipCents"], .number(200))
    XCTAssertEqual(body["paymentMethodId"], "pm_1QabcDEF")
    XCTAssertEqual(Set(body.keys), ["hostId", "orderId", "action", "amountCents", "tipCents", "paymentMethodId"])
    XCTAssertNil(SaleStep.cardKeyed(amountCents: 1080, tipCents: 0).body(hostID: "h1", orderID: "o1").objectValue["paymentMethodId"])
    XCTAssertTrue(step.startsPayment, "a typed card takes money, so it needs its attempt key")
  }

  func testAnApprovedCardSettlesTheSale() async {
    let api = ScriptedSaleAPI()
    api.answers = [.success(keyedAnswer(due: 0, keyedPayment("succeeded"), completed: true))]
    let form = FakeCardForm(["pm_visa1234"])
    let checkout = checkout(api)
    await checkout.payCard(service(form))
    XCTAssertEqual(checkout.step, .receipt(changeCents: 0))
    XCTAssertEqual(api.steps.first?.0, .cardKeyed(amountCents: 1080, tipCents: 0, paymentMethodID: "pm_visa1234"))
    XCTAssertNotNil(api.steps.first?.1, "the press carries its attempt key")
    XCTAssertEqual(form.verdicts, [.paid])
    let request = form.requests.first
    XCTAssertEqual(request?.publishableKey, "pk_test_51Habc")
    XCTAssertEqual(request?.amountCents, 1080)
    XCTAssertEqual(request?.amountText, "$10.80")
    XCTAssertEqual(request?.merchantName, "Corner Shop")
  }

  func testTheTipIsPartOfWhatTheFormCharges() async {
    let api = ScriptedSaleAPI()
    api.answers = [.success(keyedAnswer(due: 0, keyedPayment("succeeded", tip: 200), completed: true))]
    let form = FakeCardForm(["pm_visa1234"])
    let checkout = checkout(api)
    checkout.customTip(200)
    await checkout.payCard(service(form))
    XCTAssertEqual(api.steps.first?.0, .cardKeyed(amountCents: 1080, tipCents: 200, paymentMethodID: "pm_visa1234"))
    XCTAssertEqual(form.requests.first?.amountCents, 1280)
  }

  func testADeclineKeepsTheFormOpenAndTheNextCardIsANewAttempt() async {
    let api = ScriptedSaleAPI()
    api.answers = [
      .success(keyedAnswer(due: 1080, keyedPayment("failed", id: "pay1", failure: "Your card was declined."))),
      .success(keyedAnswer(due: 0, keyedPayment("succeeded", id: "pay2"), completed: true)),
    ]
    let form = FakeCardForm(["pm_declined1", "pm_visa1234"])
    let checkout = checkout(api)
    await checkout.payCard(service(form))
    XCTAssertEqual(form.verdicts, [.declined("Your card was declined."), .paid])
    XCTAssertEqual(form.requests.count, 1, "one form for both cards")
    XCTAssertNotEqual(api.steps[0].1, api.steps[1].1, "a declined card retires its attempt key")
    XCTAssertEqual(checkout.step, .receipt(changeCents: 0))
  }

  func testClosingAfterADeclineLeavesTheSaleOpenForAnotherTender() async {
    let api = ScriptedSaleAPI()
    api.answers = [.success(keyedAnswer(due: 1080, keyedPayment("failed", failure: "Your card was declined.")))]
    let form = FakeCardForm(["pm_declined1"])
    let checkout = checkout(api)
    await checkout.payCard(service(form))
    XCTAssertEqual(checkout.step, .tender)
    XCTAssertEqual(checkout.sale.payments.first?.status, "failed", "the decline stays in the ledger, as the console shows it")
  }

  func testAProcessingCardIsSettledByTheServersReadOfStripe() async {
    let api = ScriptedSaleAPI()
    api.answers = [
      .success(keyedAnswer(due: 1080, keyedPayment("pending"))),
      .success(keyedAnswer(due: 0, keyedPayment("succeeded"), completed: true)),
    ]
    let form = FakeCardForm(["pm_visa1234"])
    let checkout = checkout(api)
    await checkout.payCard(service(form))
    XCTAssertEqual(api.steps.map { $0.0.action }, ["card-keyed", "status"])
    XCTAssertEqual(checkout.step, .receipt(changeCents: 0))
  }

  func testALostAnswerClosesTheFormAndBlocksTendersUntilTheSaleIsReadAgain() async {
    let api = ScriptedSaleAPI()
    // The checkout re-reads the sale after a lost answer; that read is lost too.
    api.answers = [.failure(ConsoleAPIError(status: 0, message: "offline")), .failure(ConsoleAPIError(status: 0, message: "offline"))]
    let form = FakeCardForm(["pm_visa1234", "pm_never"])
    let checkout = checkout(api)
    await checkout.payCard(service(form))
    XCTAssertEqual(form.verdicts, [.lost(lostAnswer)], "the second card is never sent")
    XCTAssertTrue(checkout.lost)
  }

  func testARefusalToStartShowsTheServersWordsInTheForm() async {
    let api = ScriptedSaleAPI()
    api.answers = [.failure(ConsoleAPIError(status: 409, message: "Card payments not set up"))]
    let form = FakeCardForm(["pm_visa1234"])
    await checkout(api).payCard(service(form))
    XCTAssertEqual(form.verdicts, [.declined("Card payments not set up")])
  }

  func testWithNoKeyAnywhereTheFormNeverOpens() async {
    let api = ScriptedSaleAPI()
    let form = FakeCardForm(["pm_visa1234"])
    let checkout = checkout(api)
    await checkout.payCard(service(form, key: ""))
    XCTAssertTrue(form.requests.isEmpty)
    XCTAssertTrue(api.steps.isEmpty, "nothing was started, so nothing is left to release")
    XCTAssertEqual(checkout.notice?.message, "Card entry is not set up for this site.")
  }

  func testTheKeyIsReadAgainAtThePressWhenTheRegisterHasNone() async {
    let api = ScriptedSaleAPI()
    api.contextKey = "pk_test_fromContext"
    api.answers = [.success(keyedAnswer(due: 0, keyedPayment("succeeded"), completed: true))]
    let form = FakeCardForm(["pm_visa1234"])
    await checkout(api).payCard(service(form, key: ""))
    XCTAssertEqual(form.requests.first?.publishableKey, "pk_test_fromContext")
  }

  func testCancelingTheCardStepClosesTheForm() async {
    let form = FakeCardForm([])
    let keyed = service(form)
    await keyed.cancel(TenderDeps(api: ScriptedSaleAPI(), orderID: "o1"), paymentID: nil)
    XCTAssertTrue(form.dismissed)
  }

  func testATestModeSmartReaderCanBeTappedWhileTheCustomerStepIsOpen() async {
    let api = ScriptedSaleAPI()
    api.answers = [.success(keyedAnswer(due: 1080, keyedPayment("pending")))]
    await checkout(api).simulateTapOnReader("pay1")
    XCTAssertEqual(api.steps.first?.0, .simulate(paymentID: "pay1"))
  }

  func testTheCardStepReadsAsTypingNotTapping() {
    let keyed = service(FakeCardForm([]))
    XCTAssertEqual(keyed.label, "Enter card manually")
    XCTAssertEqual(keyed.kind, .keyed)
    XCTAssertEqual(keyed.prompt, "Enter the card in the card form.")
  }
}

/// A console that answers the register's one read with a context carrying (or lacking) the publishable key.
private final class ContextConsole: HTTPTransport, @unchecked Sendable {
  let key: String
  init(key: String) { self.key = key }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let url = request.url ?? URL(string: "https://console.test")!
    let body = Data(
      #"{"settings":{},"terminal":{"available":true,"testMode":true},"readers":[],"publishableKey":"\#(key)"}"#.utf8)
    return (body, HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!)
  }
}

private final class NoDocuments: FirestoreReader, @unchecked Sendable {
  private final class Nothing: FirestoreListening { func remove() {} }

  @MainActor
  func listen(_ query: FirestoreQuery, _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void)
    -> FirestoreListening
  { Nothing() }

  @MainActor
  func listenDocument(_ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void)
    -> FirestoreListening
  { Nothing() }

  func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {}
  func deleteDocument(_ path: [String]) async throws {}
}

@MainActor
final class KeyedCardOfferTests: XCTestCase {
  private func register(key: String, entry: KeyedCardEntry?) async -> RegisterModel {
    let api = ConsoleAPIClient(
      origin: "https://console.test", getIDToken: { _ in "token" }, transport: ContextConsole(key: key), sleep: { _ in },
      maxAttempts: 1)
    let model = RegisterModel(hostID: "h1", reader: NoDocuments(), api: api, collector: nil, keyedEntry: entry)
    await model.loadContext()
    return model
  }

  func testEnterCardManuallyIsOfferedWithTheSitesKeyAndThisAppsCardForm() async {
    let model = await register(key: "pk_test_51Habc", entry: FakeCardForm([]))
    XCTAssertEqual(model.keyedCard?.label, "Enter card manually")
    XCTAssertEqual(model.keyedCard?.publishableKey, "pk_test_51Habc")
    XCTAssertEqual(model.cardService(labeled: "Enter card manually")?.kind, .keyed)
  }

  func testEnterCardManuallyIsOfferedEvenWhenTheContextHasNoKey() async {
    // The tender reads the key again at the press, so a missing (or unread) context never hides it.
    let model = await register(key: "", entry: FakeCardForm([]))
    XCTAssertEqual(model.keyedCard?.label, "Enter card manually")
    XCTAssertEqual(model.keyedCard?.publishableKey, "")
  }

  func testEnterCardManuallyIsNotOfferedWhereTheAppHasNoCardForm() async {
    let model = await register(key: "pk_test_51Habc", entry: nil)
    XCTAssertNil(model.keyedCard, "the Mac register and the Aglyn app carry no Stripe card SDK")
    XCTAssertNil(model.cardService(labeled: "Enter card manually"))
  }
}
