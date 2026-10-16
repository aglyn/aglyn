// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynHardware
import Foundation
import XCTest

@testable import AglynCommercePlugin

/*
 * "TYPE CARD": the console's Payment Element path on the device. The Stripe
 * card SDK is Aglyn POS's alone, so these tests hand the tender a fake
 * `KeyedCardEntry` (the seam the SDK sits behind) and hold everything else:
 * the route's words, the checks before the form opens, and how each way the
 * form can close ends the sale step.
 */

private let secret = "pi_12345678abc_secret_abcdefgh"
private let intent = "pi_12345678abc"
private let opened = PosOpenedSale(
  orderID: "o1", subtotalCents: 1000, discountCents: 0, taxCents: 80, totalCents: 1080, dueCents: 1080, stockWarnings: [])

private func keyedPayment(_ status: String, amount: Int = 1080, tip: Int = 0, failure: String? = nil) -> PosSalePayment {
  PosSalePayment(
    id: "pay1", method: "card_keyed", amountCents: amount, tipCents: tip, status: status, cardBrand: status == "succeeded" ? "visa" : nil,
    last4: status == "succeeded" ? "4242" : nil, changeCents: 0, readerID: nil, failureMessage: failure)
}

private func keyedAnswer(
  due: Int, _ payment: PosSalePayment?, completed: Bool = false, secret: String? = nil, intent: String? = nil
) -> PosPaymentAnswer {
  PosPaymentAnswer(
    sale: PosSale(
      orderID: "o1", status: due == 0 ? "paid" : "pending", totalCents: 1080, paidCents: 1080 - due, dueCents: due,
      tenderableCents: due, tipCents: 0, payments: payment.map { [$0] } ?? []),
    paymentID: payment?.id, completed: completed, clientSecret: secret, paymentIntentID: intent)
}

/// Stripe's card form, as the tests see it: it records what it was asked and answers from a script.
@MainActor
private final class FakeCardForm: KeyedCardEntry {
  var answer: KeyedCardOutcome
  private(set) var requests: [KeyedCardRequest] = []

  init(_ answer: KeyedCardOutcome) { self.answer = answer }

  func collect(_ request: KeyedCardRequest) async -> KeyedCardOutcome {
    requests.append(request)
    return answer
  }
}

@MainActor
final class KeyedCardTenderTests: XCTestCase {
  private func service(_ form: FakeCardForm) -> KeyedCardService {
    KeyedCardService(entry: form, publishableKey: "pk_test_51Habc", merchantName: "Corner Shop")
  }

  private func checkout(_ api: ScriptedSaleAPI) -> Checkout {
    Checkout(api: api, opened: opened, settings: PosRegisterSettings(tippingEnabled: true, tipPercentages: [20]), sleep: { _ in })
  }

  func testTheRouteSpeaksTheConsolesWords() {
    let step = SaleStep.cardKeyed(amountCents: 1080, tipCents: 200)
    let body = step.body(hostID: "h1", orderID: "o1").objectValue
    XCTAssertEqual(body["action"], "card-keyed")
    XCTAssertEqual(body["amountCents"], .number(1080))
    XCTAssertEqual(body["tipCents"], .number(200))
    XCTAssertTrue(step.startsPayment, "a typed card takes money, so it needs its attempt key")
  }

  func testTheContextCarriesTheSitesPublishableKey() {
    let with = readPosContext(.object(["settings": .object([:]), "publishableKey": "pk_test_51Habc"]))
    XCTAssertEqual(with.publishableKey, "pk_test_51Habc")
    XCTAssertEqual(readPosContext(.object(["settings": .object([:])])).publishableKey, "", "no key, no typed card")
  }

  func testAConfirmedCardIsRecordedFromTheServersReadOfStripe() async {
    let api = ScriptedSaleAPI()
    api.answers = [
      .success(keyedAnswer(due: 1080, keyedPayment("pending"), secret: secret)),
      .success(keyedAnswer(due: 0, keyedPayment("succeeded"), completed: true)),
    ]
    let form = FakeCardForm(.confirmed(paymentIntentID: intent))
    let checkout = checkout(api)
    await checkout.payCard(service(form))
    XCTAssertEqual(checkout.step, .receipt(changeCents: 0))
    XCTAssertEqual(api.steps.map { $0.0.action }, ["card-keyed", "status"], "the form's say-so is never the record")
    XCTAssertEqual(api.steps.first?.0, .cardKeyed(amountCents: 1080, tipCents: 0))
    XCTAssertNotNil(api.steps.first?.1, "the press carries its attempt key")
    let request = form.requests.first
    XCTAssertEqual(request?.paymentIntentID, intent, "the intent is named by its own secret")
    XCTAssertEqual(request?.clientSecret, secret)
    XCTAssertEqual(request?.publishableKey, "pk_test_51Habc")
    XCTAssertEqual(request?.amountCents, 1080)
    XCTAssertEqual(request?.merchantName, "Corner Shop")
  }

  func testTheKeyTheServerAnsweredWithLoadsTheForm() async {
    var started = keyedAnswer(due: 1080, keyedPayment("pending"), secret: secret)
    started.publishableKey = "pk_test_fromServer"
    XCTAssertEqual(
      readPaymentAnswer(.object(["sale": .object([:]), "publishableKey": "pk_test_fromServer"])).publishableKey,
      "pk_test_fromServer")
    let api = ScriptedSaleAPI()
    api.answers = [.success(started), .success(keyedAnswer(due: 0, keyedPayment("succeeded"), completed: true))]
    let form = FakeCardForm(.confirmed(paymentIntentID: intent))
    let checkout = checkout(api)
    // A register whose context never loaded has no key of its own.
    await checkout.payCard(KeyedCardService(entry: form, publishableKey: "", merchantName: "Corner Shop"))
    XCTAssertEqual(form.requests.first?.publishableKey, "pk_test_fromServer")
    XCTAssertEqual(checkout.step, .receipt(changeCents: 0))
  }

  func testNoKeyAnywhereSaysCardEntryIsNotSetUpAndReleasesTheAmount() async {
    let api = ScriptedSaleAPI()
    api.answers = [
      .success(keyedAnswer(due: 1080, keyedPayment("pending"), secret: secret)),
      .success(keyedAnswer(due: 1080, keyedPayment("canceled"))),
    ]
    let form = FakeCardForm(.confirmed(paymentIntentID: intent))
    let checkout = checkout(api)
    await checkout.payCard(KeyedCardService(entry: form, publishableKey: "", merchantName: "Corner Shop"))
    XCTAssertTrue(form.requests.isEmpty, "the form never opens without a key")
    XCTAssertEqual(api.steps.map { $0.0.action }, ["card-keyed", "cancel"])
    XCTAssertEqual(checkout.notice?.message, "Card entry is not set up for this site.")
  }

  func testTheTipIsPartOfWhatTheFormCharges() async {
    let api = ScriptedSaleAPI()
    api.answers = [
      .success(keyedAnswer(due: 1080, keyedPayment("pending", tip: 200), secret: secret, intent: intent)),
      .success(keyedAnswer(due: 0, keyedPayment("succeeded", tip: 200), completed: true)),
    ]
    let form = FakeCardForm(.confirmed(paymentIntentID: intent))
    let checkout = checkout(api)
    checkout.customTip(200)
    await checkout.payCard(service(form))
    XCTAssertEqual(api.steps.first?.0, .cardKeyed(amountCents: 1080, tipCents: 200))
    XCTAssertEqual(form.requests.first?.amountCents, 1280)
  }

  func testClosingTheFormWithoutPayingReleasesTheAmount() async {
    let api = ScriptedSaleAPI()
    api.answers = [
      .success(keyedAnswer(due: 1080, keyedPayment("pending"), secret: secret)),
      .success(keyedAnswer(due: 1080, keyedPayment("canceled"))),
    ]
    let form = FakeCardForm(.canceled(paymentIntentID: intent))
    let checkout = checkout(api)
    await checkout.payCard(service(form))
    XCTAssertEqual(api.steps.map { $0.0.action }, ["card-keyed", "cancel"])
    XCTAssertEqual(checkout.step, .tender)
    XCTAssertEqual(checkout.dueCents, 1080)
    XCTAssertFalse(checkout.busy)
  }

  func testAFormThatFailedReleasesTheAmountAndSaysWhy() async {
    let api = ScriptedSaleAPI()
    api.answers = [
      .success(keyedAnswer(due: 1080, keyedPayment("pending"), secret: secret)),
      .success(keyedAnswer(due: 1080, keyedPayment("canceled"))),
    ]
    let form = FakeCardForm(.failed(paymentIntentID: intent, message: "Your card was declined."))
    let checkout = checkout(api)
    await checkout.payCard(service(form))
    XCTAssertEqual(api.steps.map { $0.0.action }, ["card-keyed", "cancel"])
    XCTAssertEqual(checkout.step, .tender)
    XCTAssertEqual(checkout.notice?.message, "Your card was declined.")
  }

  func testACardStripeTookJustBeforeTheFormFailedIsStillRecordedAsPaid() async {
    let api = ScriptedSaleAPI()
    // The server reads Stripe before it cancels, so the cancel itself answers "succeeded".
    api.answers = [
      .success(keyedAnswer(due: 1080, keyedPayment("pending"), secret: secret)),
      .success(keyedAnswer(due: 0, keyedPayment("succeeded"), completed: true)),
    ]
    let form = FakeCardForm(.failed(paymentIntentID: intent, message: "The connection dropped."))
    let checkout = checkout(api)
    await checkout.payCard(service(form))
    XCTAssertEqual(checkout.step, .receipt(changeCents: 0), "a charge that went through is never lost")
  }

  func testAnIntentForAnotherAmountNeverOpensTheForm() async {
    let api = ScriptedSaleAPI()
    api.answers = [
      .success(keyedAnswer(due: 1080, keyedPayment("pending", amount: 9999), secret: secret)),
      .success(keyedAnswer(due: 1080, nil)),
    ]
    let form = FakeCardForm(.confirmed(paymentIntentID: intent))
    let checkout = checkout(api)
    await checkout.payCard(service(form))
    XCTAssertTrue(form.requests.isEmpty)
    XCTAssertEqual(checkout.notice?.message, "The amount to charge does not match the register. Start the payment again.")
    XCTAssertEqual(api.steps.map { $0.0.action }, ["card-keyed", "cancel"])
  }

  func testASecretThatDoesNotMatchItsIntentNeverOpensTheForm() async {
    let api = ScriptedSaleAPI()
    api.answers = [
      .success(keyedAnswer(due: 1080, keyedPayment("pending"), secret: secret, intent: "pi_other0000000")),
      .success(keyedAnswer(due: 1080, nil)),
    ]
    let form = FakeCardForm(.confirmed(paymentIntentID: intent))
    let checkout = checkout(api)
    await checkout.payCard(service(form))
    XCTAssertTrue(form.requests.isEmpty)
    XCTAssertEqual(checkout.notice?.message, "The payment to collect does not match its secret.")
  }

  func testAnAnswerWithNoSecretFailsWithTheServersWords() async {
    let api = ScriptedSaleAPI()
    api.answers = [.success(keyedAnswer(due: 1080, keyedPayment("failed", failure: "Card payments are not set up.")))]
    let form = FakeCardForm(.confirmed(paymentIntentID: intent))
    let checkout = checkout(api)
    await checkout.payCard(service(form))
    XCTAssertTrue(form.requests.isEmpty)
    XCTAssertEqual(checkout.notice?.message, "Card payments are not set up.")
    XCTAssertEqual(checkout.step, .tender)
  }

  func testAPaymentTheServerRefusesToStartShowsItsWords() async {
    let api = ScriptedSaleAPI()
    api.answers = [.failure(ConsoleAPIError(status: 409, message: "Card payments not set up"))]
    let form = FakeCardForm(.confirmed(paymentIntentID: intent))
    let checkout = checkout(api)
    await checkout.payCard(service(form))
    XCTAssertTrue(form.requests.isEmpty)
    XCTAssertEqual(checkout.notice?.message, "Card payments not set up")
  }

  func testALostAnswerBlocksTendersUntilTheSaleIsReadAgain() async {
    let api = ScriptedSaleAPI()
    api.answers = [.failure(ConsoleAPIError(status: 0, message: "offline")), .failure(ConsoleAPIError(status: 0, message: "offline"))]
    let form = FakeCardForm(.confirmed(paymentIntentID: intent))
    let checkout = checkout(api)
    await checkout.payCard(service(form))
    XCTAssertTrue(checkout.lost)
    XCTAssertTrue(form.requests.isEmpty)
  }

  func testAPressRetriedAfterTheFirstSettledDoesNotOpenTheFormAgain() async {
    let api = ScriptedSaleAPI()
    api.answers = [.success(keyedAnswer(due: 0, keyedPayment("succeeded"), completed: true, secret: secret))]
    let form = FakeCardForm(.confirmed(paymentIntentID: intent))
    let checkout = checkout(api)
    await checkout.payCard(service(form))
    XCTAssertTrue(form.requests.isEmpty)
    XCTAssertEqual(checkout.step, .receipt(changeCents: 0))
  }

  func testTheCardStepReadsAsTypingNotTapping() {
    let form = FakeCardForm(.canceled(paymentIntentID: intent))
    let keyed = service(form)
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
    let model = await register(key: "pk_test_51Habc", entry: FakeCardForm(.canceled(paymentIntentID: intent)))
    XCTAssertEqual(model.keyedCard?.label, "Enter card manually")
    XCTAssertEqual(model.keyedCard?.publishableKey, "pk_test_51Habc")
    XCTAssertEqual(model.cardService(labeled: "Enter card manually")?.kind, .keyed)
  }

  func testEnterCardManuallyIsOfferedEvenWhenTheContextHasNoKey() async {
    // The server hands the key back with the intent, so a missing (or unread) context never hides the tender.
    let model = await register(key: "", entry: FakeCardForm(.canceled(paymentIntentID: intent)))
    XCTAssertEqual(model.keyedCard?.label, "Enter card manually")
    XCTAssertEqual(model.keyedCard?.publishableKey, "")
  }

  func testEnterCardManuallyIsNotOfferedWhereTheAppHasNoCardForm() async {
    let model = await register(key: "pk_test_51Habc", entry: nil)
    XCTAssertNil(model.keyedCard, "the Mac register and the Aglyn app carry no Stripe card SDK")
    XCTAssertNil(model.cardService(labeled: "Enter card manually"))
  }
}
