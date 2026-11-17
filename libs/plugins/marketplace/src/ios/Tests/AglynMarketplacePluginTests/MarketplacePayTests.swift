// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynMarketplacePlugin

/// Answers each call in turn, recording what it was sent.
private final class Door: HTTPTransport, @unchecked Sendable {
  private let lock = NSLock()
  private var queue: [(Int, String)]
  private(set) var requests: [URLRequest] = []

  init(_ answers: [(Int, String)]) { queue = answers }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    lock.lock()
    requests.append(request)
    let (status, body) = queue.isEmpty ? (200, "{}") : queue.removeFirst()
    lock.unlock()
    return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
  }

  func body(_ index: Int) -> [String: Any] {
    (try? JSONSerialization.jsonObject(with: requests[index].httpBody ?? Data()) as? [String: Any]) ?? [:]
  }

  var actions: [String] {
    requests.indices.map { (requests[$0].url?.path ?? "") + ":" + ((body($0)["action"] as? String) ?? "pay") }
  }
}

/// Buying a paid listing (AGL-4049): the console's `use-marketplace-pay.tsx` and `marketplace-pay-panel.spec.tsx`.
@MainActor
final class MarketplacePayTests: XCTestCase {
  private let quote =
    #"{"quote":{"listingName":"Hero","amountCents":1000,"taxCents":66,"totalCents":1066,"card":{"brand":"visa","last4":"4242"},"canPay":true}}"#

  private func model(_ door: Door, hostID: String? = "h1", keys: [String] = ["key-1", "key-2"]) -> MarketplacePay {
    let client = ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "t" }, transport: door, sleep: { _ in }, maxAttempts: 1)
    var remaining = keys
    return MarketplacePay(api: MarketplacePayAPI(api: client, orgID: "o1", hostID: hostID)) { remaining.removeFirst() }
  }

  func testTheTotalReadsAsTheConsoleWritesIt() {
    XCTAssertEqual(formatPayCents(1066), "$10.66")
    XCTAssertEqual(formatPayCents(123_456_705), "$1,234,567.05")
    XCTAssertEqual(formatPayCents(0), "$0.00")
    XCTAssertEqual(payCardLabel(PayQuoteCard(brand: "visa", last4: "4242")), "VISA •••• 4242")
    XCTAssertEqual(payCardLabel(PayQuoteCard(type: "link", email: "a@example.com")), "link · a@example.com")
    XCTAssertEqual(payCardLabel(nil), "the card on file")
  }

  func testRefusalsSayWhatTheConsoleSays() {
    let body: JSONValue = .object(["code": "card_required", "error": "Add a card in Billing first"])
    XCTAssertEqual(payPrerequisite(status: 412, body: body), .cardRequired)
    XCTAssertNil(payPrerequisite(status: 400, body: body))
    XCTAssertEqual(payRefusalText(status: 501, body: nil), "Purchases are not set up on this deployment.")
    XCTAssertEqual(payRefusalText(status: 502, body: nil), "The payment did not go through.")
    XCTAssertEqual(payRefusalText(status: 412, body: body), "Add a card in Billing first")
    XCTAssertEqual(
      payRefusalText(status: 423, body: .object(["title": "Checkout is paused", "message": "Try again soon."])), "Checkout is paused — Try again soon.")
    XCTAssertEqual(
      lockdownRefusalLine(status: 423, body: .object(["title": "Checkout is paused", "message": "Checkout is paused for now."])),
      "Checkout is paused for now.")
  }

  func testALicenceBelongsToTheWorkspaceItWasBoughtFor() {
    func row(_ id: String, _ org: String?, uid: String = "u1", listing: String = "l1") -> LicenceRow {
      var data: [String: Any] = ["listingId": listing, "buyerUid": uid]
      if let org { data["buyerOrgId"] = org }
      return LicenceRow(FirestoreDocument(id: id, data: data))
    }
    let here = row("p1", "o1")
    let there = row("p2", "o2")
    let legacy = row("p3", nil)
    XCTAssertTrue(hasOrgLicence([here], listingID: "l1", orgID: "o1", uid: "u1"))
    XCTAssertFalse(hasOrgLicence([there], listingID: "l1", orgID: "o1", uid: "u1"))
    XCTAssertTrue(licensedElsewhere([there], listingID: "l1", orgID: "o1", uid: "u1"))
    XCTAssertFalse(licensedElsewhere([here, there], listingID: "l1", orgID: "o1", uid: "u1"))
    // Before AGL-2331 a purchase named no workspace: it licenses its buyer wherever they install, and nobody else.
    XCTAssertTrue(hasOrgLicence([legacy], listingID: "l1", orgID: "o1", uid: "u1"))
    XCTAssertFalse(hasOrgLicence([legacy], listingID: "l1", orgID: "o1", uid: "u2"))
    XCTAssertFalse(hasOrgLicence([here], listingID: "l2", orgID: "o1", uid: "u1"))
    XCTAssertTrue(mustBuy(priceUSD: 10, purchased: false, ownWorkspace: false, installed: false))
    XCTAssertFalse(mustBuy(priceUSD: 10, purchased: true, ownWorkspace: false, installed: false))
    XCTAssertFalse(mustBuy(priceUSD: 10, purchased: false, ownWorkspace: true, installed: false))
    XCTAssertFalse(mustBuy(priceUSD: 10, purchased: false, ownWorkspace: false, installed: true))
    XCTAssertFalse(mustBuy(priceUSD: 0, purchased: false, ownWorkspace: false, installed: false))
    XCTAssertEqual(buyLabel(priceUSD: 12, licensedElsewhere: false), "Buy for $12")
    XCTAssertEqual(buyLabel(priceUSD: 12.5, licensedElsewhere: true), "Buy for this workspace — $12.5")
    XCTAssertEqual(publisherMemberBuyReason("Acme Builders"), "Someone in this workspace who isn't in Acme Builders needs to buy it.")
    XCTAssertEqual(publisherMemberBuyReason(" "), "Someone in this workspace who isn't in the publishing workspace needs to buy it.")
    XCTAssertEqual(buyPermissionKey("siteStarter"), "hosts.create")
    XCTAssertEqual(buyPermissionKey("plugin"), installPluginsKey)
    XCTAssertEqual(listingPurchasesQuery(uid: "u1").limit, purchaseLookupCeiling)
  }

  func testTheTotalComesFirstThenOnePressOfPayPays() async {
    let door = Door([(200, quote), (200, #"{"paid":true,"invoiceId":"in_1"}"#)])
    let pay = model(door)
    var ended: [PayOutcome] = []
    pay.onFinish = { ended.append($0) }
    await pay.buy(listingID: "l1", name: "Hero")
    XCTAssertEqual(pay.step, .confirm(PayQuote(listingName: "Hero", amountCents: 1000, taxCents: 66, totalCents: 1066, card: PayQuoteCard(brand: "visa", last4: "4242"), canPay: true)))
    await pay.pay()
    XCTAssertEqual(ended, [.paid])
    XCTAssertNil(pay.step)
    XCTAssertEqual(door.requests[1].url?.path, "/api/marketplace/pay")
    XCTAssertEqual(door.body(1)["expectedTotalCents"] as? Int, 1066)
    XCTAssertEqual(door.body(1)["orgId"] as? String, "o1")
    XCTAssertEqual(door.body(1)["hostId"] as? String, "h1")
    XCTAssertEqual(door.requests[1].value(forHTTPHeaderField: "Idempotency-Key"), "key-1")
    XCTAssertNil(door.requests[0].value(forHTTPHeaderField: "Idempotency-Key"))
    XCTAssertEqual(payOutcomeNotice(.paid, name: "Hero")?.text, "Bought \"Hero\". It is yours to install.")
  }

  func testAlreadyOwnedEndsBeforeAnythingIsCharged() async {
    let pay = model(Door([(409, #"{"code":"already_purchased","error":"Already owned"}"#)]))
    var ended: [PayOutcome] = []
    pay.onFinish = { ended.append($0) }
    await pay.buy(listingID: "l1", name: "Hero")
    XCTAssertEqual(ended, [.owned])
    XCTAssertEqual(payOutcomeNotice(.owned, name: "Hero")?.text, "This organization already owns \"Hero\".")
  }

  func testADeclineStaysOnTheTotalWithStripesReasonAndANewKeyNextTime() async {
    let door = Door([(200, quote), (402, #"{"error":"Your card was declined.","declined":true}"#), (200, #"{"paid":true}"#)])
    let pay = model(door, hostID: nil)
    await pay.buy(listingID: "l1", name: "Hero")
    await pay.pay()
    XCTAssertEqual(pay.error, "Your card was declined.")
    if case .confirm = pay.step {} else { XCTFail("stays on the total") }
    await pay.pay()
    XCTAssertEqual(door.requests.map { $0.value(forHTTPHeaderField: "Idempotency-Key") }, [nil, "key-1", "key-2"])
    XCTAssertNil(door.body(1)["hostId"])
  }

  func testAMissingCardIsAddedOnStripesPageThenTheTotalIsAskedAgain() async {
    let door = Door([
      (412, #"{"code":"card_required","canManageBilling":true,"amountCents":1000}"#),
      (409, #"{"error":"No billing account yet"}"#),
      (200, #"{"clientSecret":"seti_1_secret"}"#),
      (200, #"{"url":"https://billing.stripe.com/p/session/test_1"}"#),
      (200, quote),
    ])
    let pay = model(door)
    var opened: [URL] = []
    pay.openPage = { opened.append($0) }
    await pay.buy(listingID: "l1", name: "Hero")
    XCTAssertEqual(pay.step, .card)
    await pay.addCard()
    XCTAssertEqual(opened, [URL(string: "https://billing.stripe.com/p/session/test_1")!])
    if case .confirm = pay.step {} else { XCTFail("back to the total") }
    XCTAssertEqual(
      door.actions,
      [
        "/api/marketplace/pay:quote", "/api/billing/subscription:portal", "/api/billing/profile:create-setup-intent",
        "/api/billing/subscription:portal", "/api/marketplace/pay:quote",
      ])
    XCTAssertEqual(door.body(1)["flow"] as? String, "payment_method_update")
  }

  func testAnAddressIsSavedToBillingThenTheTotalIsAskedAgain() async {
    let door = Door([(412, #"{"code":"billing_address_required","canManageBilling":true}"#), (200, "{}"), (200, quote)])
    let pay = model(door)
    await pay.buy(listingID: "l1", name: "Hero")
    XCTAssertEqual(pay.step, .address)
    XCTAssertFalse(PayBillingAddress(line1: "1 Main St", country: "USA").complete)
    await pay.saveAddress(PayBillingAddress(line1: "1 Main St", city: "Austin", state: "TX", postalCode: "78701", country: "us"))
    if case .confirm = pay.step {} else { XCTFail("back to the total") }
    XCTAssertEqual(door.body(1)["action"] as? String, "set-billing-address")
    XCTAssertEqual(door.body(1)["country"] as? String, "US")
  }

  func testSomeoneWhoCannotManageBillingIsToldWhoCan() async {
    let pay = model(Door([(412, #"{"code":"card_required","canManageBilling":false,"amountCents":1000}"#)]))
    await pay.buy(listingID: "l1", name: "Hero")
    XCTAssertEqual(pay.step, .askBilling(.cardRequired, amountCents: 1000))
  }

  func testTheBankConfirmsOnTheInvoicePageAndTheServerSettlesIt() async {
    let door = Door([
      (200, quote),
      (200, #"{"requiresAction":true,"paymentClientSecret":"pi_secret","invoiceId":"in_1","hostedInvoiceUrl":"https://invoice.stripe.com/i/test_1"}"#),
      (200, #"{"paid":true,"invoiceId":"in_1"}"#),
    ])
    let pay = model(door)
    var opened: [URL] = []
    var ended: [PayOutcome] = []
    pay.openPage = { opened.append($0) }
    pay.onFinish = { ended.append($0) }
    await pay.buy(listingID: "l1", name: "Hero")
    await pay.pay()
    XCTAssertEqual(opened, [URL(string: "https://invoice.stripe.com/i/test_1")!])
    XCTAssertEqual(ended, [.paid])
    XCTAssertEqual(door.body(2)["action"] as? String, "settle")
    XCTAssertEqual(door.body(2)["invoiceId"] as? String, "in_1")
  }

  func testABankStepWithNoPageIsSettledAtOnceAndSaysItCannotBeFinishedHere() async {
    let door = Door([
      (200, quote),
      (200, #"{"requiresAction":true,"paymentClientSecret":"pi_secret","invoiceId":"in_1"}"#),
      (402, #"{"error":"That payment was not completed. Nothing has been charged.","declined":true}"#),
    ])
    let pay = model(door)
    await pay.buy(listingID: "l1", name: "Hero")
    await pay.pay()
    if case .confirm = pay.step {} else { XCTFail("back to the total") }
    XCTAssertEqual(
      pay.error,
      "Your bank needs to confirm this payment, but it cannot be finished here. Nothing has changed and nothing has been charged.")
  }

  func testATotalThatMovedIsShownAgainBeforeAnotherPress() async {
    let door = Door([
      (200, quote), (409, #"{"code":"total_changed","error":"The total changed. Check the new total and pay again."}"#),
      (200, quote.replacingOccurrences(of: "1066", with: "1100")),
    ])
    let pay = model(door)
    await pay.buy(listingID: "l1", name: "Hero")
    await pay.pay()
    if case .confirm(let moved) = pay.step { XCTAssertEqual(moved.totalCents, 1100) } else { XCTFail("the new total") }
    XCTAssertEqual(pay.error, "The total changed. Check the new total and pay again.")
  }
}
