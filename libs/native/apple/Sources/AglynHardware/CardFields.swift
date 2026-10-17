// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * THE REGISTER'S OWN CARD FIELDS (AGL-3848).
 *
 * A card typed in at the register goes into Aglyn POS's own native fields,
 * so it looks like every other form in the app on iPhone, iPad and Mac
 * (Stripe has no card SDK for native macOS). What the fields hold goes to ONE
 * place: Stripe's PaymentMethods API, called from the device with the site's
 * PUBLISHABLE key, exactly as Stripe's own SDKs do it. Stripe answers with a
 * PaymentMethod id (`pm_…`), and that id, never the card, is what the
 * register sends its server, which confirms the payment with the platform's
 * secret key.
 *
 * Card data is never logged, persisted, cached, put in a URL, or sent
 * anywhere else; the request carries no cookies and no cache; the fields are
 * cleared as soon as the form closes. Because the number now passes through
 * our own code on the way to Stripe, the app is in scope for PCI SAQ A-EP
 * rather than SAQ A (see docs/mobile/native-architecture.md).
 *
 * Everything here is pure (no UI, no SDK) and tested: brand detection, Luhn,
 * formatting as the cashier types, the checks behind each inline error, and
 * the exact request Stripe receives. The Kotlin kit keeps Stripe's own card
 * form, so it has no twin of this file.
 */

public enum CardBrand: String, CaseIterable, Sendable {
  case visa, mastercard, amex, discover, diners, jcb, unionpay, unknown

  public var name: String {
    switch self {
    case .visa: "Visa"
    case .mastercard: "Mastercard"
    case .amex: "American Express"
    case .discover: "Discover"
    case .diners: "Diners Club"
    case .jcb: "JCB"
    case .unionpay: "UnionPay"
    case .unknown: "Card"
    }
  }

  /// The lengths a complete number of this brand may have.
  public var lengths: [Int] {
    switch self {
    case .amex: [15]
    case .diners: [14, 16]
    case .visa: [13, 16, 19]
    case .discover, .jcb, .unionpay: [16, 17, 18, 19]
    case .mastercard: [16]
    case .unknown: [12, 13, 14, 15, 16, 17, 18, 19]
    }
  }

  public var maxLength: Int { lengths.max() ?? 19 }

  public var cvcLength: Int { self == .amex ? 4 : 3 }

  /// How the number is grouped on the card: 4-6-5 for Amex, 4-6-4 for a 14-digit Diners, else fours.
  func groups(for count: Int) -> [Int] {
    switch self {
    case .amex: [4, 6, 5]
    case .diners where count <= 14: [4, 6, 4]
    default: Array(repeating: 4, count: 5)
    }
  }
}

/// Only the digits of what was typed.
public func cardDigits(_ text: String) -> String { String(text.filter(\.isASCII).filter(\.isNumber)) }

/// The brand a number's first digits name; `.unknown` until they name one.
public func cardBrand(for number: String) -> CardBrand {
  let digits = cardDigits(number)
  func prefix(_ count: Int) -> Int? { digits.count >= count ? Int(digits.prefix(count)) : nil }
  if digits.hasPrefix("4") { return .visa }
  if digits.hasPrefix("34") || digits.hasPrefix("37") { return .amex }
  if let two = prefix(2), (51...55).contains(two) { return .mastercard }
  if let four = prefix(4), (2221...2720).contains(four) { return .mastercard }
  if digits.hasPrefix("6011") || digits.hasPrefix("65") { return .discover }
  if let three = prefix(3), (644...649).contains(three) { return .discover }
  if digits.hasPrefix("36") || digits.hasPrefix("38") || digits.hasPrefix("39") { return .diners }
  if let three = prefix(3), (300...305).contains(three) { return .diners }
  if let four = prefix(4), (3528...3589).contains(four) { return .jcb }
  if digits.hasPrefix("62") || digits.hasPrefix("81") { return .unionpay }
  return .unknown
}

/// The Luhn check every card number carries in its last digit.
public func luhnValid(_ number: String) -> Bool {
  let digits = cardDigits(number).compactMap(\.wholeNumberValue)
  guard digits.count >= 12 else { return false }
  var sum = 0
  for (index, digit) in digits.reversed().enumerated() {
    if index.isMultiple(of: 2) {
      sum += digit
    } else {
      let doubled = digit * 2
      sum += doubled > 9 ? doubled - 9 : doubled
    }
  }
  return sum.isMultiple(of: 10)
}

/// The number as the cashier types it, cut to the brand's longest length and grouped: `4242 4242 4242 4242`.
public func formatCardNumber(_ text: String) -> String {
  let brand = cardBrand(for: text)
  let digits = String(cardDigits(text).prefix(brand.maxLength))
  var out: [String] = []
  var rest = Substring(digits)
  for size in brand.groups(for: digits.count) where !rest.isEmpty {
    out.append(String(rest.prefix(size)))
    rest = rest.dropFirst(size)
  }
  if !rest.isEmpty { out.append(String(rest)) }
  return out.joined(separator: " ")
}

/// The expiry as the cashier types it: `MM / YY`, a lone first digit above 1 read as a month (`4` → `04 / `).
public func formatCardExpiry(_ text: String, deleting: Bool = false) -> String {
  var digits = String(cardDigits(text).prefix(4))
  if digits.count == 1, let first = digits.first?.wholeNumberValue, first > 1 { digits = "0" + digits }
  if digits.count >= 2 {
    let month = digits.prefix(2)
    let year = digits.dropFirst(2)
    if year.isEmpty { return deleting ? String(month) : "\(month) / " }
    return "\(month) / \(year)"
  }
  return digits
}

/// A month and a four-digit year from `MM / YY`, or nil.
public func parseCardExpiry(_ text: String) -> (month: Int, year: Int)? {
  let digits = cardDigits(text)
  guard digits.count == 4, let month = Int(digits.prefix(2)), let year = Int(digits.suffix(2)), (1...12).contains(month)
  else { return nil }
  return (month, 2000 + year)
}

/// The card's fields, as typed.
public struct CardFields: Equatable, Sendable {
  public enum Field: String, CaseIterable, Sendable { case number, expiry, cvc, postalCode }

  public var number = ""
  public var expiry = ""
  public var cvc = ""
  public var postalCode = ""

  public init(number: String = "", expiry: String = "", cvc: String = "", postalCode: String = "") {
    self.number = number
    self.expiry = expiry
    self.cvc = cvc
    self.postalCode = postalCode
  }

  public var brand: CardBrand { cardBrand(for: number) }

  /// What is wrong with one field, or nil. `typing` is true while the cashier
  /// is still in the field: an unfinished value is not an error yet, only a
  /// value that can never become right is.
  public func problem(_ field: Field, typing: Bool = false, now: Date = Date()) -> String? {
    switch field {
    case .number:
      let digits = cardDigits(number)
      if digits.isEmpty { return typing ? nil : "Enter the card number." }
      let brand = self.brand
      // While typing, a number is judged once it reaches a length it usually stops at (16, or the brand's own).
      if typing && digits.count < brand.maxLength && !Self.usualLength(brand, digits.count) { return nil }
      if !brand.lengths.contains(digits.count) { return "The card number is incomplete." }
      if !luhnValid(digits) { return "The card number is not valid. Check it and enter it again." }
      return nil
    case .expiry:
      let digits = cardDigits(expiry)
      if digits.isEmpty { return typing ? nil : "Enter the expiry date." }
      if digits.count >= 2, let month = Int(digits.prefix(2)), !(1...12).contains(month) {
        return "The month must be 01 to 12."
      }
      if digits.count < 4 { return typing ? nil : "Enter the expiry as MM / YY." }
      guard let (month, year) = parseCardExpiry(expiry) else { return "Enter the expiry as MM / YY." }
      let calendar = Calendar(identifier: .gregorian)
      let today = calendar.dateComponents([.year, .month], from: now)
      if year < today.year! || (year == today.year! && month < today.month!) { return "This card has expired." }
      if year > today.year! + 20 { return "Check the expiry year." }
      return nil
    case .cvc:
      let digits = cardDigits(cvc)
      if digits.isEmpty { return typing ? nil : "Enter the security code." }
      if digits.count < brand.cvcLength { return typing ? nil : "The security code is \(brand.cvcLength) digits." }
      if digits.count > brand.cvcLength { return "The security code is \(brand.cvcLength) digits." }
      return nil
    case .postalCode:
      let code = postalCode.trimmingCharacters(in: .whitespaces)
      if code.isEmpty { return typing ? nil : "Enter the billing postal code." }
      if code.range(of: "^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$", options: .regularExpression) == nil {
        return "Enter a valid postal code."
      }
      return nil
    }
  }

  /// A length a number of `brand` usually stops at: its only length, or 16 (Visa's 19 is rare).
  static func usualLength(_ brand: CardBrand, _ count: Int) -> Bool {
    brand.lengths.contains(count) && count >= min(16, brand.maxLength)
  }

  /// The number is whole and right: the cursor can move on.
  public var numberIsComplete: Bool {
    Self.usualLength(brand, cardDigits(number).count) && problem(.number) == nil
  }

  /// Every field's problem, for the Pay press.
  public func problems(now: Date = Date()) -> [Field: String] {
    var out: [Field: String] = [:]
    for field in Field.allCases {
      if let problem = problem(field, now: now) { out[field] = problem }
    }
    return out
  }

  /// The card as Stripe takes it, once every field is right.
  public func details(now: Date = Date()) -> CardDetails? {
    guard problems(now: now).isEmpty, let (month, year) = parseCardExpiry(expiry) else { return nil }
    return CardDetails(
      number: cardDigits(number), expMonth: month, expYear: year, cvc: cardDigits(cvc),
      postalCode: postalCode.trimmingCharacters(in: .whitespaces))
  }

  /// Empties every field.
  public mutating func clear() { self = CardFields() }
}

/// A complete card, held only for the one request to Stripe.
public struct CardDetails: Equatable, Sendable {
  public let number: String
  public let expMonth: Int
  public let expYear: Int
  public let cvc: String
  public let postalCode: String

  public init(number: String, expMonth: Int, expYear: Int, cvc: String, postalCode: String) {
    self.number = number
    self.expMonth = expMonth
    self.expYear = expYear
    self.cvc = cvc
    self.postalCode = postalCode
  }

  /// Never prints the card: `String(describing:)` on these details names only the brand and last four.
  public var masked: String { "\(cardBrand(for: number).name) •••• \(number.suffix(4))" }
}

extension CardDetails: CustomStringConvertible, CustomDebugStringConvertible {
  public var description: String { masked }
  public var debugDescription: String { masked }
}

/// Why Stripe would not make a PaymentMethod, in words for the cashier, with the field to fix when Stripe names one.
public struct CardTokenError: Error, Equatable, LocalizedError {
  public let message: String
  public let field: CardFields.Field?

  public init(message: String, field: CardFields.Field? = nil) {
    self.message = message
    self.field = field
  }

  public var errorDescription: String? { message }
}

/// The one Stripe call: card in, PaymentMethod id out.
public struct StripeCardTokenizer: Sendable {
  public typealias Send = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

  public static let endpoint = URL(string: "https://api.stripe.com/v1/payment_methods")!

  private let send: Send

  /// `send` defaults to an ephemeral session: no cookies, no cache, no stored credentials.
  public init(send: Send? = nil) {
    self.send =
      send ?? { request in
        let session = URLSession(configuration: .ephemeral)
        defer { session.finishTasksAndInvalidate() }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
      }
  }

  /// The request Stripe receives: a form body (never a URL query) under the publishable key.
  public static func request(_ card: CardDetails, publishableKey: String) -> URLRequest {
    var request = URLRequest(url: endpoint, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 30)
    request.httpMethod = "POST"
    request.httpShouldHandleCookies = false
    request.setValue("Bearer \(publishableKey)", forHTTPHeaderField: "Authorization")
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    let fields: [(String, String)] = [
      ("type", "card"),
      ("card[number]", card.number),
      ("card[exp_month]", String(card.expMonth)),
      ("card[exp_year]", String(card.expYear)),
      ("card[cvc]", card.cvc),
      ("billing_details[address][postal_code]", card.postalCode),
    ]
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "-._~")
    request.httpBody = fields.map { key, value in
      "\(key.addingPercentEncoding(withAllowedCharacters: allowed) ?? key)=\(value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")"
    }
    .joined(separator: "&").data(using: .utf8)
    return request
  }

  /// Makes the PaymentMethod and returns its id (`pm_…`). Throws `CardTokenError` with Stripe's words.
  public func createPaymentMethod(_ card: CardDetails, publishableKey: String) async throws -> String {
    guard publishableKey.hasPrefix("pk_") else { throw CardTokenError(message: "Card entry is not set up for this site.") }
    let data: Data
    let response: HTTPURLResponse
    do {
      (data, response) = try await send(Self.request(card, publishableKey: publishableKey))
    } catch {
      throw CardTokenError(message: "The card could not be checked. Check the connection and try again.")
    }
    let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    if (200..<300).contains(response.statusCode), let id = body?["id"] as? String, id.hasPrefix("pm_") { return id }
    let error = body?["error"] as? [String: Any]
    throw Self.tokenError(code: error?["code"] as? String, message: error?["message"] as? String)
  }

  /// Stripe's card error codes, as the field to fix and the words to show.
  static func tokenError(code: String?, message: String?) -> CardTokenError {
    switch code {
    case "incorrect_number", "invalid_number":
      CardTokenError(message: "The card number is not valid. Check it and enter it again.", field: .number)
    case "invalid_expiry_month", "invalid_expiry_year":
      CardTokenError(message: "Check the expiry date.", field: .expiry)
    case "expired_card": CardTokenError(message: "This card has expired.", field: .expiry)
    case "invalid_cvc", "incorrect_cvc": CardTokenError(message: "Check the security code.", field: .cvc)
    case "incorrect_zip": CardTokenError(message: "Check the billing postal code.", field: .postalCode)
    case "api_key_expired", "invalid_api_key", "secret_key_required":
      CardTokenError(message: "Card entry is not set up for this site.")
    default:
      // The platform's Stripe account has not switched on card entry from a device
      // (Dashboard → Settings → Integration); the cashier can only use another way to pay.
      (message ?? "").localizedCaseInsensitiveContains("publishable key tokenization")
        ? CardTokenError(message: "Card entry is not switched on for this store yet. Use Card (QR) or a card reader.") :
      CardTokenError(message: (message?.isEmpty == false ? message : nil) ?? "The card was not accepted. Check it and try again.")
    }
  }
}
