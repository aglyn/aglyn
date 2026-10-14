// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import CoreImage
import Foundation
import XCTest

@testable import AglynCommercePlugin

private func tenderPayment(
  _ id: String, _ method: String, _ status: String, amount: Int = 1080, tip: Int = 0, url: String? = nil, creditLabel: String? = nil,
  livemode: Bool? = nil, failure: String? = nil, brand: String? = nil, last4: String? = nil
) -> PosSalePayment {
  PosSalePayment(
    id: id, method: method, amountCents: amount, tipCents: tip, status: status, cardBrand: brand, last4: last4, changeCents: 0,
    readerID: nil, failureMessage: failure, checkoutURL: url, creditLabel: creditLabel, livemode: livemode)
}

private func tenderAnswer(due: Int, _ payments: [PosSalePayment], id: String? = nil, completed: Bool = false) -> PosPaymentAnswer {
  PosPaymentAnswer(
    sale: PosSale(
      orderID: "o1", status: due == 0 ? "paid" : "pending", totalCents: 1080, paidCents: 1080 - due, dueCents: due,
      tenderableCents: due, tipCents: 0, payments: payments),
    paymentID: id ?? payments.last?.id, completed: completed, clientSecret: nil, paymentIntentID: nil)
}

private let sale = PosOpenedSale(
  orderID: "o1", subtotalCents: 1000, discountCents: 0, taxCents: 80, totalCents: 1080, dueCents: 1080, stockWarnings: [])

private final class Recorder: HTTPTransport, @unchecked Sendable {
  private let lock = NSLock()
  private(set) var requests: [URLRequest] = []
  let body: String
  init(_ body: String) { self.body = body }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    lock.withLock { requests.append(request) }
    return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
  }

  var sent: [String: Any] { (try? JSONSerialization.jsonObject(with: requests.last?.httpBody ?? Data())) as? [String: Any] ?? [:] }
}

private func client(_ transport: HTTPTransport) -> ConsoleAPIClient {
  ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "token" }, transport: transport, sleep: { _ in }, maxAttempts: 1)
}

final class PosTenderRoutesTests: XCTestCase {
  func testTheNewStepsSpeakTheRoutesWords() {
    func body(_ step: SaleStep) -> [String: JSONValue] { step.body(hostID: "h1", orderID: "o1").objectValue }
    let credit = body(.credit(code: "REF-1234", providerID: nil, reference: nil, amountCents: nil))
    XCTAssertEqual(credit["action"], "credit")
    XCTAssertEqual(credit["code"], "REF-1234")
    XCTAssertNil(credit["providerId"])
    let account = body(.credit(code: nil, providerID: "rewards", reference: "acct_1", amountCents: 300))
    XCTAssertEqual(account["providerId"], "rewards")
    XCTAssertEqual(account["reference"], "acct_1")
    XCTAssertEqual(account["amountCents"], .number(300))
    let folio = body(.folio(reservationID: "res_1", amountCents: nil))
    XCTAssertEqual(folio["action"], "folio")
    XCTAssertEqual(folio["reservationId"], "res_1")
    XCTAssertNil(folio["amountCents"], "no amount means the whole balance")
    let link = body(.cardLink(amountCents: 1080, tipCents: 200))
    XCTAssertEqual(link["action"], "card-link")
    XCTAssertEqual(link["tipCents"], .number(200))
    XCTAssertEqual(body(.retry(paymentID: "pay1"))["paymentId"], "pay1")
    XCTAssertEqual(body(.simulate(paymentID: "pay1"))["action"], "simulate")
    for step in [
      SaleStep.credit(code: "C", providerID: nil, reference: nil, amountCents: nil), .folio(reservationID: "r", amountCents: nil),
      .cardLink(amountCents: 1, tipCents: 0),
    ] {
      XCTAssertTrue(step.startsPayment, "\(step.action) takes money, so it needs its attempt key")
    }
    for step in [SaleStep.retry(paymentID: "p"), .simulate(paymentID: "p")] {
      XCTAssertFalse(step.startsPayment)
    }
  }

  func testTheContextCarriesTheStoreCreditsThisSiteTakes() {
    let context = readPosContext(
      .object([
        "settings": .object([:]),
        "terminal": .object(["available": .bool(true), "testMode": .bool(true)]),
        "credits": .array([
          .object(["providerId": "rewards", "label": "Rewards", "lookup": .bool(true)]),
          .object(["providerId": "referral", "label": "Referral credit", "lookup": .bool(false)]),
          .object(["label": "no id"]),
        ]),
      ]))
    XCTAssertEqual(
      context.credits,
      [
        PosCreditProvider(providerID: "rewards", label: "Rewards", lookup: true),
        PosCreditProvider(providerID: "referral", label: "Referral credit", lookup: false),
      ])
  }

  func testAPaymentCarriesItsQRPageItsCreditNameAndWhetherItWasATest() {
    let answer = readPaymentAnswer(
      .object([
        "sale": .object([
          "orderId": "o1", "status": "pending", "totalCents": .number(1080), "paidCents": .number(0), "dueCents": .number(1080),
          "tenderableCents": .number(0), "tipCents": .number(0),
          "payments": .array([
            .object([
              "id": "p1", "method": "card_link", "amountCents": .number(1080), "status": "pending",
              "checkoutUrl": "https://pay.test/c/abc", "livemode": .bool(false),
            ]),
            .object(["id": "p2", "method": "credit", "amountCents": .number(100), "status": "succeeded", "creditLabel": "Rewards"]),
          ]),
        ]),
        "paymentId": "p1",
      ]))
    XCTAssertEqual(answer.payment?.checkoutURL, "https://pay.test/c/abc")
    XCTAssertEqual(answer.payment?.livemode, false)
    XCTAssertEqual(answer.sale.payments[1].creditLabel, "Rewards")
    XCTAssertNil(answer.sale.payments[1].livemode, "a payment that does not say is not called a test")
  }

  func testTheCreditLookupAsksTheProviderAndReadsTheAccounts() async throws {
    let transport = Recorder(
      #"{"providerId":"rewards","accounts":[{"reference":"acct_1","label":"Rewards","last4":"4821","availableCents":750,"detail":"Gold member"},{"label":"no reference"}]}"#)
    let accounts = try await ConsolePosSaleAPI(api: client(transport), hostID: "h1").creditLookup(providerID: "rewards", query: "ana@shop.co")
    XCTAssertEqual(transport.requests.last?.url?.path, "/api/commerce/pos-payment")
    XCTAssertEqual(transport.sent["action"] as? String, "credit-lookup")
    XCTAssertEqual(transport.sent["providerId"] as? String, "rewards")
    XCTAssertEqual(transport.sent["query"] as? String, "ana@shop.co")
    XCTAssertEqual(accounts, [PosCreditAccount(reference: "acct_1", label: "Rewards", last4: "4821", availableCents: 750, detail: "Gold member")])
  }

  func testAPaymentIsDescribedTheWayTheConsoleLedgerDescribesIt() {
    func money(_ cents: Int) -> String { String(format: "$%.2f", Double(cents) / 100) }
    XCTAssertEqual(describePayment(tenderPayment("p", "cash", "succeeded", amount: 500), money: money), "Cash $5.00")
    XCTAssertEqual(
      describePayment(tenderPayment("p", "card_present", "succeeded", amount: 1000, tip: 200, brand: "visa", last4: "4242"), money: money),
      "Card reader (visa •••• 4242) $10.00 + $2.00 tip")
    XCTAssertEqual(describePayment(tenderPayment("p", "credit", "succeeded", creditLabel: "Rewards"), money: money), "Rewards $10.80")
    XCTAssertEqual(describePayment(tenderPayment("p", "credit", "succeeded"), money: money), "Store credit $10.80")
    XCTAssertEqual(describePayment(tenderPayment("p", "folio", "succeeded"), money: money), "Charged to room $10.80")
    XCTAssertEqual(describePayment(tenderPayment("p", "card_link", "pending"), money: money), "Card (QR) $10.80")
    XCTAssertEqual(paymentStatusLabel("pending"), "Waiting")
    XCTAssertEqual(paymentStatusLabel("failed"), "Declined")
  }

  func testTheStaysQueryAsksByStatus() {
    let query = staysQuery("h1")
    XCTAssertEqual(query.collection, ["hosts", "h1", "reservations"])
    XCTAssertEqual(query.equals.map(\.field), ["status"])
    XCTAssertEqual(query.equals.first?.value as? String, "checked_in")
    XCTAssertEqual(query.limit, 100)
  }
}

@MainActor
final class CheckoutTenderTests: XCTestCase {
  private func checkout(_ api: ScriptedSaleAPI, settings: PosRegisterSettings = PosRegisterSettings()) -> Checkout {
    Checkout(api: api, opened: sale, settings: settings, sleep: { _ in })
  }

  func testStoreCreditByCodeSettlesWhatTheAccountCanGive() async {
    let api = ScriptedSaleAPI()
    api.answers = [.success(tenderAnswer(due: 780, [tenderPayment("p1", "credit", "succeeded", amount: 300, creditLabel: "Rewards")]))]
    let checkout = checkout(api)
    await checkout.payCredit(providerID: "rewards", code: " ref-1234 ")
    XCTAssertEqual(api.steps.first?.0, .credit(code: "ref-1234", providerID: nil, reference: nil, amountCents: nil))
    XCTAssertNotNil(api.steps.first?.1, "a payment carries its attempt key")
    XCTAssertEqual(checkout.step, .tender)
    XCTAssertEqual(checkout.dueCents, 780)
    XCTAssertEqual(checkout.notice?.tone, .success)
  }

  func testAnEmptyCreditCodeIsRefusedBeforeAnyCall() async {
    let api = ScriptedSaleAPI()
    let checkout = checkout(api)
    await checkout.payCredit(providerID: "rewards", code: "  ")
    XCTAssertEqual(checkout.notice?.message, "Enter the code.")
    XCTAssertTrue(api.steps.isEmpty)
  }

  func testStoreCreditFromAFoundAccountNamesTheProviderAndAccountAndKeepsASplit() async {
    let api = ScriptedSaleAPI()
    api.answers = [.success(tenderAnswer(due: 0, [tenderPayment("p1", "credit", "succeeded", creditLabel: "Rewards")], completed: true))]
    let checkout = checkout(api)
    checkout.setPart(500)
    let account = PosCreditAccount(reference: "acct_1", label: "Rewards", last4: "4821", availableCents: 750, detail: nil)
    await checkout.payCredit(providerID: "rewards", account: account)
    XCTAssertEqual(api.steps.first?.0, .credit(code: nil, providerID: "rewards", reference: "acct_1", amountCents: 500))
    XCTAssertEqual(checkout.step, .receipt(changeCents: 0))
  }

  func testACreditThatTheServerRefusesShowsItsWords() async {
    let api = ScriptedSaleAPI()
    api.answers = [.failure(ConsoleAPIError(status: 409, message: "This rewards account has nothing to spend."))]
    let checkout = checkout(api)
    await checkout.payCredit(providerID: "rewards", code: "ABC")
    XCTAssertEqual(checkout.notice?.message, "This rewards account has nothing to spend.")
    XCTAssertEqual(checkout.step, .tender)
  }

  func testTheCreditLookupKeepsWhatItFoundAndSaysWhenNothingMatched() async {
    let api = ScriptedSaleAPI()
    let found = PosCreditAccount(reference: "acct_1", label: "Rewards", last4: "", availableCents: 750, detail: nil)
    api.creditAccounts = .success([found])
    let checkout = checkout(api)
    await checkout.lookUpCredit(providerID: "rewards", query: " ana@shop.co ")
    XCTAssertEqual(checkout.creditAccounts, [found])
    XCTAssertEqual(api.lookups, ["rewards:ana@shop.co"])
    api.creditAccounts = .success([])
    await checkout.lookUpCredit(providerID: "rewards", query: "nobody")
    XCTAssertEqual(checkout.creditAccounts, [])
    api.creditAccounts = .failure(ConsoleAPIError(status: 429, message: "Too many lookups. Wait a moment."))
    await checkout.lookUpCredit(providerID: "rewards", query: "again")
    XCTAssertNil(checkout.creditAccounts)
    XCTAssertEqual(checkout.notice?.message, "Too many lookups. Wait a moment.")
    checkout.clearCreditLookup()
    XCTAssertNil(checkout.creditAccounts)
  }

  func testARoomChargeGoesOnTheStaysFolio() async {
    let api = ScriptedSaleAPI()
    api.answers = [.success(tenderAnswer(due: 0, [tenderPayment("p1", "folio", "succeeded")], completed: true))]
    let checkout = checkout(api)
    await checkout.payFolio(reservationID: "res_1")
    XCTAssertEqual(api.steps.first?.0, .folio(reservationID: "res_1", amountCents: nil))
    XCTAssertEqual(checkout.step, .receipt(changeCents: 0))
  }

  func testTheQRPaymentShowsItsPageThenSettlesWhenTheCustomerPays() async {
    let api = ScriptedSaleAPI()
    let waiting = tenderPayment("p1", "card_link", "pending", url: "https://pay.test/c/abc")
    api.answers = [
      .success(tenderAnswer(due: 1080, [waiting])),
      .success(tenderAnswer(due: 1080, [waiting])),
      .success(tenderAnswer(due: 0, [tenderPayment("p1", "card_link", "succeeded")], completed: true)),
    ]
    let checkout = checkout(api)
    await checkout.payLink()
    XCTAssertEqual(checkout.step, .qr(paymentID: "p1", url: "https://pay.test/c/abc", amountCents: 1080))
    XCTAssertEqual(api.steps.first?.0, .cardLink(amountCents: 1080, tipCents: 0))
    XCTAssertFalse(checkout.busy)
    await checkout.pollLink()
    XCTAssertEqual(checkout.step, .qr(paymentID: "p1", url: "https://pay.test/c/abc", amountCents: 1080), "still waiting")
    await checkout.pollLink()
    XCTAssertEqual(checkout.step, .receipt(changeCents: 0))
    XCTAssertEqual(api.steps.map { $0.0.action }, ["card-link", "status", "status"])
  }

  func testClosingTheQRPageReleasesTheAmountForAnotherTender() async {
    let api = ScriptedSaleAPI()
    let waiting = tenderPayment("p1", "card_link", "pending", url: "https://pay.test/c/abc")
    api.answers = [
      .success(tenderAnswer(due: 1080, [waiting])),
      .success(tenderAnswer(due: 1080, [tenderPayment("p1", "card_link", "canceled")])),
    ]
    let checkout = checkout(api)
    await checkout.payLink()
    await checkout.cancelLink()
    XCTAssertEqual(checkout.step, .tender)
    XCTAssertEqual(api.steps.map { $0.0.action }, ["card-link", "cancel"])
    XCTAssertEqual(checkout.dueCents, 1080)
  }

  func testAQRPaymentTheServerCouldNotMakeSaysSo() async {
    let api = ScriptedSaleAPI()
    api.answers = [.failure(ConsoleAPIError(status: 409, message: "Card payments are not set up for this store."))]
    let checkout = checkout(api)
    await checkout.payLink()
    XCTAssertEqual(checkout.step, .tender)
    XCTAssertEqual(checkout.notice?.message, "Card payments are not set up for this store.")
  }

  func testAPendingQRPaymentCanBeShownAgainButNotAnythingElse() async {
    let api = ScriptedSaleAPI()
    let checkout = checkout(api)
    checkout.showLink(tenderPayment("p1", "card_link", "succeeded", url: "https://pay.test/c/abc"))
    XCTAssertEqual(checkout.step, .tender)
    checkout.showLink(tenderPayment("p1", "cash", "pending"))
    XCTAssertEqual(checkout.step, .tender)
    checkout.showLink(tenderPayment("p1", "card_link", "pending", url: "https://pay.test/c/abc"))
    XCTAssertEqual(checkout.step, .qr(paymentID: "p1", url: "https://pay.test/c/abc", amountCents: 1080))
  }

  func testATestTapOnTheReaderIsFollowedByReadingTheSaleAgain() async {
    let api = ScriptedSaleAPI()
    let reader = tenderPayment("p1", "card_present", "pending", livemode: false)
    api.answers = [
      .success(tenderAnswer(due: 1080, [reader])),
      .success(tenderAnswer(due: 0, [tenderPayment("p1", "card_present", "succeeded", livemode: false)], completed: true)),
      .success(tenderAnswer(due: 0, [tenderPayment("p1", "card_present", "succeeded", livemode: false)], completed: true)),
    ]
    let checkout = checkout(api)
    await checkout.simulateTap("p1")
    XCTAssertEqual(api.steps.first?.0, .simulate(paymentID: "p1"))
    XCTAssertEqual(checkout.step, .receipt(changeCents: 0))
  }

  func testADeclinedReaderPaymentIsRetriedOnTheSamePayment() async {
    let api = ScriptedSaleAPI()
    api.answers = [.success(tenderAnswer(due: 1080, [tenderPayment("p1", "card_present", "pending")]))]
    let checkout = checkout(api)
    await checkout.retryReaderPayment("p1")
    XCTAssertEqual(api.steps.first?.0, .retry(paymentID: "p1"))
    XCTAssertEqual(checkout.inFlight.map(\.id), ["p1"])
    api.answers = [.failure(ConsoleAPIError(status: 409, message: "That reader is offline."))]
    await checkout.retryReaderPayment("p1")
    XCTAssertEqual(checkout.notice?.message, "That reader is offline.")
  }
}

@MainActor
final class ReceiptPrintTests: XCTestCase {
  func testTheReceiptGoesToTheRegistersPrinterUnderTheSalesOwnKey() async {
    let api = ScriptedSaleAPI()
    api.answers = [.success(tenderAnswer(due: 0, [tenderPayment("p1", "cash", "succeeded")], completed: true))]
    let checkout = Checkout(api: api, opened: sale, settings: PosRegisterSettings(), sleep: { _ in })
    let sent = await checkout.printToCloud()
    XCTAssertTrue(sent)
    XCTAssertTrue(checkout.printed)
    XCTAssertEqual(api.steps.first?.0, .receipt(channel: "print", to: nil))
    XCTAssertNil(api.steps.first?.1, "a receipt is not a payment, so it needs no attempt key")
    XCTAssertEqual(checkout.notice?.message, "Sent to the receipt printer.")
  }

  func testAPrinterThatCannotBeReachedSaysSoAndTheReceiptIsNotCalledPrinted() async {
    let api = ScriptedSaleAPI()
    api.answers = [.failure(ConsoleAPIError(status: 502, message: "The receipt printer did not answer."))]
    let checkout = Checkout(api: api, opened: sale, settings: PosRegisterSettings(), sleep: { _ in })
    let sent = await checkout.printToCloud()
    XCTAssertFalse(sent)
    XCTAssertFalse(checkout.printed)
    XCTAssertEqual(checkout.notice?.message, "The receipt printer did not answer.")
    XCTAssertEqual(checkout.notice?.tone, .error)
  }
}

final class QRCodeTests: XCTestCase {
  func testTheCodeDecodesBackToTheTextItWasMadeFrom() throws {
    let url = "https://checkout.example.com/c/pay/cs_live_a1B2c3D4e5F6g7H8i9J0#fidkdWxOYHwnPyd1blpxYHZxWjA0"
    let image = try XCTUnwrap(aglynQRCodeImage(url))
    XCTAssertEqual(image.width, image.height, "a QR code is square")
    let detector = try XCTUnwrap(CIDetector(ofType: CIDetectorTypeQRCode, context: nil, options: [CIDetectorAccuracy: CIDetectorAccuracyHigh]))
    // A scanner needs the white border the view draws around it.
    let padded = CIImage(cgImage: image).composited(
      over: CIImage(color: .white).cropped(to: CGRect(x: -80, y: -80, width: image.width + 160, height: image.height + 160)))
    let found = detector.features(in: padded).compactMap { ($0 as? CIQRCodeFeature)?.messageString }
    XCTAssertEqual(found, [url])
  }

  func testNothingIsDrawnForNothing() {
    XCTAssertNil(aglynQRCodeImage(""))
  }
}
