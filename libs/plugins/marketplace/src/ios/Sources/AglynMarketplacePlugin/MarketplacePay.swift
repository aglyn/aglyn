// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import Observation

/*
 * BUYING A PAID LISTING (AGL-4049), as the console's listing page buys it:
 * `use-marketplace-pay.tsx` and `marketplace-pay-panel.component.tsx`. The
 * same door (`/api/marketplace/pay`: quote, then pay with one key per press,
 * then settle after the bank's step), the same total before Pay, the same
 * prerequisites and refusals, in place under the Buy button.
 *
 * Two steps the console takes with Stripe.js happen on Stripe's own pages
 * here, in the system's secure browser, as the app's Billing already takes
 * them: a card is added on Stripe's billing portal (`payment_method_update`,
 * Billing details' "Add a payment method on Stripe"), and a bank that wants
 * to confirm a payment does so on the invoice's own page
 * (`hostedInvoiceUrl`, Billing's plan change). Back here the purchase is
 * asked about again. The Kotlin plugin's MarketplacePay.kt.
 */

/// The card a quote names, as far as this person may see it (`PayQuoteCard`).
struct PayQuoteCard: Equatable {
  var type: String?
  var brand: String?
  var last4: String?
  var email: String?

  init(type: String? = nil, brand: String? = nil, last4: String? = nil, email: String? = nil) {
    self.type = type
    self.brand = brand
    self.last4 = last4
    self.email = email
  }

  init?(_ value: JSONValue?) {
    guard case .object(let card)? = value else { return nil }
    type = card["type"]?.stringValue
    brand = card["brand"]?.stringValue
    last4 = card["last4"]?.stringValue
    email = card["email"]?.stringValue
  }
}

/// What the door answers a `quote` with: what will be charged, before it is (`PayQuote`).
struct PayQuote: Equatable {
  let listingName: String
  let amountCents: Int
  let taxCents: Int
  let totalCents: Int
  /// `nil` for someone who may buy but may not see billing.
  let card: PayQuoteCard?
  /// Whether this person holds `billing.manage`, which paying takes.
  let canPay: Bool

  init(listingName: String, amountCents: Int, taxCents: Int, totalCents: Int, card: PayQuoteCard?, canPay: Bool) {
    self.listingName = listingName
    self.amountCents = amountCents
    self.taxCents = taxCents
    self.totalCents = totalCents
    self.card = card
    self.canPay = canPay
  }

  init?(_ value: JSONValue?) {
    guard case .object(let quote)? = value else { return nil }
    func cents(_ key: String) -> Int {
      if case .number(let number)? = quote[key] { return Int(number.rounded()) }
      return 0
    }
    listingName = quote["listingName"]?.stringValue ?? ""
    amountCents = cents("amountCents")
    taxCents = cents("taxCents")
    totalCents = cents("totalCents")
    card = PayQuoteCard(quote["card"])
    canPay = quote["canPay"]?.boolValue == true
  }
}

/// The two things a workspace needs before it can be charged (`PayPrerequisite`).
enum PayPrerequisite: String, Equatable {
  case cardRequired = "card_required"
  case billingAddressRequired = "billing_address_required"
}

/// The prerequisite a refusal names, or `nil` when it names none (`payPrerequisiteOf`).
func payPrerequisite(status: Int, body: JSONValue?) -> PayPrerequisite? {
  guard status == 412, let code = body?["code"]?.stringValue else { return nil }
  return PayPrerequisite(rawValue: code)
}

/// Dollars and cents, for a line a buyer is about to agree to (`formatPayCents`: en-US currency, grouped).
func formatPayCents(_ cents: Int) -> String {
  let sign = cents < 0 ? "-" : ""
  let magnitude = abs(cents)
  let whole = String(magnitude / 100)
  var grouped = ""
  for (index, digit) in whole.enumerated() {
    if index > 0, (whole.count - index) % 3 == 0 { grouped.append(",") }
    grouped.append(digit)
  }
  let fraction = magnitude % 100
  return "\(sign)$\(grouped).\(fraction < 10 ? "0" : "")\(fraction)"
}

/// The saved method in words, wallets included: they carry an email, not a number (`payCardLabel`).
func payCardLabel(_ card: PayQuoteCard?) -> String {
  if let last4 = card?.last4, !last4.isEmpty { return "\((card?.brand ?? card?.type ?? "card").uppercased()) •••• \(last4)" }
  if let email = card?.email, !email.isEmpty { return "\(card?.type ?? "wallet") · \(email)" }
  return "the card on file"
}

/// A feature lockdown's refusal in one line (`parseLockdownRefusal` + `lockdownRefusalText`): the title is led only when
/// the message does not already open with it.
func lockdownRefusalLine(status: Int, body: JSONValue?) -> String? {
  guard status == 423 else { return nil }
  let title = body?["title"]?.stringValue?.trimmingCharacters(in: .whitespaces).nonEmpty ?? "Temporarily unavailable"
  let message = body?["message"]?.stringValue?.trimmingCharacters(in: .whitespaces).nonEmpty ?? "This is paused for a moment. Try again later."
  return message.lowercased().hasPrefix(title.lowercased()) ? message : "\(title) — \(message)"
}

/// What a refused answer says to the buyer (`refusalText`).
func payRefusalText(status: Int, body: JSONValue?) -> String {
  if let locked = lockdownRefusalLine(status: status, body: body) { return locked }
  if status == 501 { return "Purchases are not set up on this deployment." }
  if let stated = body?["error"]?.stringValue, !stated.isEmpty { return stated }
  return "The payment did not go through."
}

/// Which part of paying for a listing is on screen (`PayStep`).
enum PayStep: Equatable {
  case confirm(PayQuote)
  /// A card is needed, and this person can add one: on Stripe's page.
  case card
  case address
  /// Something is needed that this person cannot add.
  case askBilling(PayPrerequisite, amountCents: Int?)
  /// The bank is confirming the payment on the invoice's Stripe page.
  case bank
}

/// How one purchase ended (`MarketplacePayOutcome`).
enum PayOutcome: Equatable {
  /// Paid, and the purchase is on record: the workspace owns it now.
  case paid
  /// The workspace owns it already: nothing was charged.
  case owned
  /// Stripe accepted the payment and it has not cleared yet.
  case pending
  /// Closed before paying, or it could not open: the error says which.
  case stopped(error: String?, locked: Bool)
}

/// What the listing says once a purchase ends, and its tone (the console's `buy` snackbars); nil says nothing.
func payOutcomeNotice(_ outcome: PayOutcome, name: String) -> (text: String, tone: PayNoticeTone)? {
  switch outcome {
  case .paid: return ("Bought \"\(name)\". It is yours to install.", .success)
  case .owned: return ("This organization already owns \"\(name)\".", .info)
  case .pending: return ("Your payment for \"\(name)\" is going through. It is yours as soon as it clears.", .info)
  case .stopped(let error?, let locked): return (error, locked ? .warning : .error)
  case .stopped(nil, _): return nil
  }
}

/// A notice's tone, without the UI kit: the screen maps it onto `AglynTone`.
enum PayNoticeTone: Equatable { case success, info, warning, error }

/// The address fields the console's Billing address form hands back (`BillingAddressValue`).
struct PayBillingAddress: Equatable {
  var name = ""
  var line1 = ""
  var line2 = ""
  var city = ""
  var state = ""
  var postalCode = ""
  var country = ""

  /// The two the route requires: a street line and a two-letter country (`set-billing-address`).
  var complete: Bool {
    !line1.trimmingCharacters(in: .whitespaces).isEmpty && country.trimmingCharacters(in: .whitespaces).count == 2
  }
}

// MARK: Who must buy (the listing page's own reads)

/// Whether one purchase still licenses this workspace (`purchaseEntitlesOrg`): a purchase naming a workspace licenses that
/// one; one naming none (before AGL-2331) licenses its buyer, wherever they install.
func purchaseEntitles(_ licence: LicenceRow, orgID: String?, uid: String) -> Bool {
  if let buyerOrgID = licence.buyerOrgID { return orgID.map { !$0.isEmpty && $0 == buyerOrgID } ?? false }
  return !uid.isEmpty && licence.buyerUID == uid
}

/// Whether these live purchases license this workspace for `listingID` (`hasOrgLicenceOf`).
func hasOrgLicence(_ purchases: [LicenceRow], listingID: String, orgID: String?, uid: String) -> Bool {
  !listingID.isEmpty && purchases.contains { $0.listingID == listingID && purchaseEntitles($0, orgID: orgID, uid: uid) }
}

/// The buyer holds a licence for `listingID` in another workspace, and none here (`licensedElsewhere`).
func licensedElsewhere(_ purchases: [LicenceRow], listingID: String, orgID: String?, uid: String) -> Bool {
  !hasOrgLicence(purchases, listingID: listingID, orgID: orgID, uid: uid)
    && purchases.contains { $0.listingID == listingID && $0.buyerOrgID != nil && $0.buyerOrgID != orgID }
}

/// Whether this listing has to be bought before it installs here (`mustBuy`): paid, not licensed here, not the publisher's
/// own workspace, and not installed already.
func mustBuy(priceUSD: Double, purchased: Bool, ownWorkspace: Bool, installed: Bool) -> Bool {
  priceUSD > 0 && !purchased && !ownWorkspace && !installed
}

/// The Buy button's words (`Buy for $X`, or `Buy for this workspace — $X` beside a licence held elsewhere).
func buyLabel(priceUSD: Double, licensedElsewhere: Bool) -> String {
  let price = "$" + jsNumberString(priceUSD)
  return licensedElsewhere ? "Buy for this workspace — \(price)" : "Buy for \(price)"
}

/// Why Buy is off for a member of the publishing workspace, in one sentence (`publisherMemberBuyReason`).
func publisherMemberBuyReason(_ publisherName: String?) -> String {
  let name = publisherName?.trimmingCharacters(in: .whitespaces) ?? ""
  return "Someone in this workspace who isn't in \(name.isEmpty ? "the publishing workspace" : name) needs to buy it."
}

/// The permission a buyer's Buy asks for, as the pay door asks it: a site starter is bought to create a site with.
func buyPermissionKey(_ artifactType: String) -> String { artifactType == "siteStarter" ? "hosts.create" : installPluginsKey }

/// The live purchases the listing page reads to decide Buy (`PURCHASE_LOOKUP_CEILING`): the person's own, every workspace.
let purchaseLookupCeiling = 200

func listingPurchasesQuery(uid: String) -> FirestoreQuery { boughtByYouQuery(uid: uid, licensedTo: nil, limit: purchaseLookupCeiling) }

// MARK: The door

/// What the pay door answered a `pay` or a `settle`.
enum PayAnswer: Equatable {
  case paid
  case submitted
  /// The bank wants the buyer: the invoice, and its Stripe page when the door named one.
  case requiresAction(invoiceID: String, page: URL?)
  case unknown

  init(_ body: JSONValue?) {
    if body?["paid"]?.boolValue == true {
      self = .paid
    } else if body?["submitted"]?.boolValue == true {
      self = .submitted
    } else if body?["requiresAction"]?.boolValue == true, let invoiceID = body?["invoiceId"]?.stringValue {
      let page = body?["hostedInvoiceUrl"]?.stringValue.flatMap(URL.init(string:)).flatMap { $0.scheme == "https" ? $0 : nil }
      self = .requiresAction(invoiceID: invoiceID, page: page)
    } else {
      self = .unknown
    }
  }
}

/// `/api/marketplace/pay` and the two Billing routes its prerequisites use.
struct MarketplacePayAPI {
  let api: ConsoleAPIClient
  let orgID: String
  let hostID: String?

  private func door(_ listingID: String, _ fields: [String: Any?], key: String? = nil) async throws -> JSONValue? {
    var body: [String: Any?] = ["listingId": listingID, "orgId": orgID]
    if let hostID { body["hostId"] = hostID }
    for (name, value) in fields { body[name] = value }
    return try await api.request("/api/marketplace/pay", method: .post, body: JSONValue.from(body), idempotencyKey: key)
  }

  func quote(listingID: String) async throws -> PayQuote? { PayQuote(try await door(listingID, ["action": "quote"])?["quote"]) }

  /// One press of Pay: the same `key` replays this attempt rather than charging twice (AGL-1697).
  func pay(listingID: String, expectedTotalCents: Int, key: String) async throws -> PayAnswer {
    PayAnswer(try await door(listingID, ["expectedTotalCents": expectedTotalCents], key: key))
  }

  func settle(listingID: String, invoiceID: String) async throws -> PayAnswer {
    PayAnswer(try await door(listingID, ["action": "settle", "invoiceId": invoiceID]))
  }

  private func billing(_ fields: [String: Any?]) async throws -> JSONValue? {
    var body: [String: Any?] = ["orgId": orgID]
    for (name, value) in fields { body[name] = value }
    return try await api.request("/api/billing/profile", method: .post, body: JSONValue.from(body))
  }

  func setBillingAddress(_ address: PayBillingAddress) async throws {
    try await billing([
      "action": "set-billing-address", "name": address.name, "line1": address.line1, "line2": address.line2, "city": address.city,
      "state": address.state, "postalCode": address.postalCode, "country": address.country.uppercased(),
    ])
  }

  /// Stripe's add-a-payment-method page for the workspace (Billing details' "Add a payment method on Stripe"). A workspace
  /// with no Stripe customer yet gets one first, the way the console's card form gets one (`create-setup-intent`).
  func cardPage() async throws -> URL? {
    func portal() async throws -> URL? {
      let answer = try await api.request(
        "/api/billing/subscription", method: .post,
        body: JSONValue.from(["orgId": orgID, "action": "portal", "flow": "payment_method_update"] as [String: Any?]))
      return answer?["url"]?.stringValue.flatMap(URL.init(string:))
    }
    do {
      return try await portal()
    } catch let error as ConsoleAPIError where error.status == 409 {
      try await billing(["action": "create-setup-intent"])
      return try await portal()
    }
  }
}

// MARK: One purchase at a time

/// Buying one listing (`useMarketplacePay`): asks the door what it would charge before it shows anything, so the total,
/// the prerequisite or the refusal is the first thing the buyer sees; one key per press of Pay.
@MainActor
@Observable
final class MarketplacePay {
  private(set) var step: PayStep?
  private(set) var busy = false
  var error: String?
  /// The listing being bought, and its name as the page shows it.
  private(set) var listing: (id: String, name: String)?
  /// Opens one of Stripe's pages and returns once the person is back (the secure browser).
  var openPage: (URL) async -> Void = { _ in }
  /// Hands the outcome to the page that asked.
  var onFinish: (PayOutcome) -> Void = { _ in }

  @ObservationIgnored private var attemptKeys: [String: String] = [:]
  @ObservationIgnored private var lastQuote: PayQuote?
  @ObservationIgnored private let api: MarketplacePayAPI
  @ObservationIgnored private let newKey: () -> String

  init(api: MarketplacePayAPI, newKey: @escaping () -> String = { UUID().uuidString.lowercased() }) {
    self.api = api
    self.newKey = newKey
  }

  var open: Bool { step != nil }

  private func finish(_ outcome: PayOutcome) {
    step = nil
    listing = nil
    busy = false
    error = nil
    lastQuote = nil
    onFinish(outcome)
  }

  /// Opens payment for a listing.
  func buy(listingID: String, name: String) async {
    guard !listingID.isEmpty, step == nil, !busy else { return }
    listing = (listingID, name)
    error = nil
    busy = true
    do {
      if let ended = try await quote() { return finish(ended) }
      busy = false
    } catch {
      finish(.stopped(error: "The payment could not open. Check your connection and try again.", locked: false))
    }
  }

  /// Asks what it would cost now and shows what that needs: the outcome when the purchase ends here, nil when a step is up.
  private func quote() async throws -> PayOutcome? {
    guard let listing else { return .stopped(error: nil, locked: false) }
    do {
      if let quote = try await api.quote(listingID: listing.id) {
        lastQuote = quote
        step = .confirm(quote)
        return nil
      }
      return .stopped(error: "The payment did not go through.", locked: false)
    } catch let refused as ConsoleAPIError where refused.status != 0 {
      if refused.status == 409, refused.body?["code"]?.stringValue == "already_purchased" { return .owned }
      if let need = payPrerequisite(status: refused.status, body: refused.body) {
        meet(need, refused.body)
        return nil
      }
      return .stopped(error: payRefusalText(status: refused.status, body: refused.body), locked: refused.status == 423)
    }
  }

  /// Moves to the step a prerequisite needs: a form or Stripe's page here, or who can meet it.
  private func meet(_ need: PayPrerequisite, _ body: JSONValue?) {
    guard body?["canManageBilling"]?.boolValue == true else {
      var amount: Int?
      if case .number(let cents)? = body?["amountCents"] { amount = Int(cents.rounded()) }
      step = .askBilling(need, amountCents: amount)
      return
    }
    step = need == .billingAddressRequired ? .address : .card
  }

  /// Goes back to the total once a card or an address is on file.
  private func returnToQuote() async {
    busy = true
    defer { busy = false }
    do {
      let ended = try await quote()
      if ended == .owned { return finish(.owned) }
      if case .stopped(let message, _)? = ended { error = message }
    } catch {
      self.error = "The payment could not open. Check your connection and try again."
    }
  }

  /// Adds a card on Stripe's page, then asks for the total again.
  func addCard() async {
    guard step == .card, !busy else { return }
    busy = true
    error = nil
    let page: URL?
    do {
      page = try await api.cardPage()
    } catch {
      busy = false
      self.error = (error as? ConsoleAPIError).flatMap { $0.status == 0 ? nil : $0.message } ?? "The card form could not open."
      return
    }
    busy = false
    guard let page else {
      error = "The card form could not open."
      return
    }
    await openPage(page)
    await returnToQuote()
  }

  func saveAddress(_ address: PayBillingAddress) async {
    guard step == .address, !busy else { return }
    busy = true
    error = nil
    do {
      try await api.setBillingAddress(address)
    } catch {
      busy = false
      self.error = (error as? ConsoleAPIError).flatMap { $0.status == 0 ? nil : $0.message } ?? "Billing could not be reached."
      return
    }
    await returnToQuote()
  }

  /// One press of Pay.
  func pay() async {
    guard let listing, case .confirm(let quote) = step, !busy else { return }
    let key = attemptKeys[listing.id] ?? newKey()
    attemptKeys[listing.id] = key
    busy = true
    error = nil
    defer { busy = false }
    do {
      let answer = try await api.pay(listingID: listing.id, expectedTotalCents: quote.totalCents, key: key)
      attemptKeys[listing.id] = nil
      switch answer {
      case .paid: return finish(.paid)
      case .submitted: return finish(.pending)
      case .requiresAction(let invoiceID, let page): return await confirmWithBank(invoiceID: invoiceID, page: page)
      case .unknown: error = "The payment did not go through."
      }
    } catch let refused as ConsoleAPIError where refused.status != 0 {
      // An answer ends this attempt: the next press of Pay is a new one.
      attemptKeys[listing.id] = nil
      if refused.status == 409, refused.body?["code"]?.stringValue == "already_purchased" { return finish(.owned) }
      if refused.status == 409, refused.body?["code"]?.stringValue == "total_changed" {
        await returnToQuote()
        error = payRefusalText(status: refused.status, body: refused.body)
        return
      }
      if let need = payPrerequisite(status: refused.status, body: refused.body) { return meet(need, refused.body) }
      error = payRefusalText(status: refused.status, body: refused.body)
    } catch {
      // No answer came back, so this attempt may still be running: the key stays, and a second press replays it.
      self.error = "The payment could not be confirmed. Check your connection and try again."
    }
  }

  /// The bank's step on the invoice's Stripe page; back here, the server decides: it records a payment that landed and
  /// voids one that did not.
  private func confirmWithBank(invoiceID: String, page: URL?) async {
    guard let listing else { return }
    step = .bank
    if let page { await openPage(page) }
    do {
      switch try await api.settle(listingID: listing.id, invoiceID: invoiceID) {
      case .paid: return finish(.paid)
      case .submitted: return finish(.pending)
      default: error = "The payment did not go through."
      }
    } catch let refused as ConsoleAPIError where refused.status != 0 {
      error =
        page == nil
        ? "Your bank needs to confirm this payment, but it cannot be finished here. Nothing has changed and nothing has been charged."
        : payRefusalText(status: refused.status, body: refused.body)
    } catch {
      self.error = "The payment could not be confirmed. Check your connection and try again."
    }
    if let lastQuote { step = .confirm(lastQuote) }
  }

  func cancel() {
    guard !busy || step == .bank else { return }
    finish(.stopped(error: nil, locked: false))
  }
}

extension String {
  fileprivate var nonEmpty: String? { isEmpty ? nil : self }
}
