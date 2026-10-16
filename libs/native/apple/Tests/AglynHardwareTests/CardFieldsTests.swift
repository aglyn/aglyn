// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import XCTest

@testable import AglynHardware

/// The register's own card fields: brand, Luhn, formatting, the errors under each field, and the one request to Stripe.
/// The numbers are Stripe's published TEST cards, never real ones.
final class CardFieldsTests: XCTestCase {
  /// 2026-10-16, so expiry checks do not drift with the clock.
  private let now = Date(timeIntervalSince1970: 1_792_108_800)

  func testTheBrandIsReadFromTheFirstDigits() {
    XCTAssertEqual(cardBrand(for: "4242"), .visa)
    XCTAssertEqual(cardBrand(for: "5555 5555"), .mastercard)
    XCTAssertEqual(cardBrand(for: "2223003122003222"), .mastercard)
    XCTAssertEqual(cardBrand(for: "3782"), .amex)
    XCTAssertEqual(cardBrand(for: "6011"), .discover)
    XCTAssertEqual(cardBrand(for: "3056"), .diners)
    XCTAssertEqual(cardBrand(for: "3566"), .jcb)
    XCTAssertEqual(cardBrand(for: "6200"), .unionpay)
    XCTAssertEqual(cardBrand(for: "9"), .unknown)
  }

  func testLuhn() {
    XCTAssertTrue(luhnValid("4242 4242 4242 4242"))
    XCTAssertTrue(luhnValid("4000000000000002"))
    XCTAssertTrue(luhnValid("378282246310005"))
    XCTAssertFalse(luhnValid("4242424242424241"))
    XCTAssertFalse(luhnValid("4242"))
  }

  func testTheNumberIsGroupedAsTypedAndCutAtTheBrandsLength() {
    XCTAssertEqual(formatCardNumber("42424242"), "4242 4242")
    XCTAssertEqual(formatCardNumber("4242-4242-4242-4242-9999-1"), "4242 4242 4242 4242 999")
    XCTAssertEqual(formatCardNumber("378282246310005"), "3782 822463 10005")
    XCTAssertEqual(formatCardNumber("3782822463100059"), "3782 822463 10005", "Amex stops at 15")
    XCTAssertEqual(formatCardNumber("30569309025904"), "3056 930902 5904")
    XCTAssertEqual(formatCardNumber("a4b2"), "42")
  }

  func testTheExpiryIsFormattedAsTyped() {
    XCTAssertEqual(formatCardExpiry("1"), "1")
    XCTAssertEqual(formatCardExpiry("4"), "04 / ")
    XCTAssertEqual(formatCardExpiry("12"), "12 / ")
    XCTAssertEqual(formatCardExpiry("12 / ", deleting: true), "12")
    XCTAssertEqual(formatCardExpiry("1229"), "12 / 29")
    XCTAssertEqual(formatCardExpiry("12/2930"), "12 / 29")
    XCTAssertEqual(parseCardExpiry("12 / 29")?.month, 12)
    XCTAssertEqual(parseCardExpiry("12 / 29")?.year, 2029)
    XCTAssertNil(parseCardExpiry("13 / 29"))
  }

  func testAnUnfinishedFieldIsNotAnErrorWhileTyping() {
    let fields = CardFields(number: "4242 42", expiry: "1", cvc: "1", postalCode: "")
    for field in CardFields.Field.allCases {
      XCTAssertNil(fields.problem(field, typing: true, now: now), "\(field)")
    }
    XCTAssertEqual(fields.problem(.number, now: now), "The card number is incomplete.")
    XCTAssertEqual(fields.problem(.expiry, now: now), "Enter the expiry as MM / YY.")
    XCTAssertEqual(fields.problem(.cvc, now: now), "The security code is 3 digits.")
    XCTAssertEqual(fields.problem(.postalCode, now: now), "Enter the billing postal code.")
  }

  func testWhatCanNeverBeRightIsAnErrorAtOnce() {
    let fields = CardFields(number: "4242 4242 4242 4241 999", expiry: "13", cvc: "12345", postalCode: "!!")
    XCTAssertEqual(fields.problem(.number, typing: true, now: now), "The card number is not valid. Check it and enter it again.")
    XCTAssertEqual(fields.problem(.expiry, typing: true, now: now), "The month must be 01 to 12.")
    XCTAssertEqual(fields.problem(.cvc, typing: true, now: now), "The security code is 3 digits.")
    XCTAssertEqual(fields.problem(.postalCode, typing: true, now: now), "Enter a valid postal code.")
  }

  func testAnExpiredCardAndAnAmexCode() {
    XCTAssertEqual(CardFields(expiry: "09 / 26").problem(.expiry, now: now), "This card has expired.")
    XCTAssertNil(CardFields(expiry: "10 / 26").problem(.expiry, now: now), "a card is good through its expiry month")
    XCTAssertEqual(CardFields(number: "3782 822463 10005", cvc: "123").problem(.cvc, now: now), "The security code is 4 digits.")
    XCTAssertNil(CardFields(number: "3782 822463 10005", cvc: "1234").problem(.cvc, now: now))
  }

  func testACompleteCardBecomesTheDetailsStripeTakes() throws {
    var fields = CardFields(number: "4242 4242 4242 4242", expiry: "12 / 34", cvc: "123", postalCode: "78701 ")
    XCTAssertTrue(fields.problems(now: now).isEmpty)
    let details = try XCTUnwrap(fields.details(now: now))
    XCTAssertEqual(details, CardDetails(number: "4242424242424242", expMonth: 12, expYear: 2034, cvc: "123", postalCode: "78701"))
    XCTAssertEqual(String(describing: details), "Visa •••• 4242", "printing the details never shows the card")
    XCTAssertFalse(String(reflecting: details).contains("4242424242424242"))
    fields.clear()
    XCTAssertEqual(fields, CardFields())
  }

  func testTheRequestGoesToStripeAloneAsAFormBodyUnderThePublishableKey() throws {
    let details = CardDetails(number: "4242424242424242", expMonth: 12, expYear: 2034, cvc: "123", postalCode: "78701")
    let request = StripeCardTokenizer.request(details, publishableKey: "pk_test_51Habc")
    XCTAssertEqual(request.url, URL(string: "https://api.stripe.com/v1/payment_methods"))
    XCTAssertNil(request.url?.query, "the card is never in a URL")
    XCTAssertEqual(request.httpMethod, "POST")
    XCTAssertFalse(request.httpShouldHandleCookies)
    XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalAndRemoteCacheData)
    XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer pk_test_51Habc")
    let body = try XCTUnwrap(request.httpBody.flatMap { String(data: $0, encoding: .utf8) })
    XCTAssertEqual(
      body,
      "type=card&card%5Bnumber%5D=4242424242424242&card%5Bexp_month%5D=12&card%5Bexp_year%5D=2034&card%5Bcvc%5D=123"
        + "&billing_details%5Baddress%5D%5Bpostal_code%5D=78701")
  }

  func testStripesPaymentMethodIdIsReturned() async throws {
    let tokenizer = StripeCardTokenizer { request in
      (Data(#"{"id":"pm_1QabcDEFghi","object":"payment_method"}"#.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
    let details = CardDetails(number: "4242424242424242", expMonth: 12, expYear: 2034, cvc: "123", postalCode: "78701")
    let id = try await tokenizer.createPaymentMethod(details, publishableKey: "pk_test_51Habc")
    XCTAssertEqual(id, "pm_1QabcDEFghi")
  }

  func testStripesRefusalNamesTheFieldToFix() async {
    let tokenizer = StripeCardTokenizer { request in
      (
        Data(#"{"error":{"code":"incorrect_number","message":"Your card number is incorrect.","type":"card_error"}}"#.utf8),
        HTTPURLResponse(url: request.url!, statusCode: 402, httpVersion: nil, headerFields: nil)!
      )
    }
    let details = CardDetails(number: "4242424242424241", expMonth: 12, expYear: 2034, cvc: "123", postalCode: "78701")
    do {
      _ = try await tokenizer.createPaymentMethod(details, publishableKey: "pk_test_51Habc")
      XCTFail("refused")
    } catch let error as CardTokenError {
      XCTAssertEqual(error.field, .number)
      XCTAssertEqual(error.message, "The card number is not valid. Check it and enter it again.")
    } catch {
      XCTFail("\(error)")
    }
  }

  func testAStripeAccountWithoutDeviceCardEntrySaysSoInPlainWords() {
    // Stripe's answer when the platform account has not switched on card entry from a device.
    let error = StripeCardTokenizer.tokenError(
      code: nil,
      message: "This integration surface is unsupported for publishable key tokenization. To enable this surface, please go to your dashboard")
    XCTAssertEqual(error.message, "Card entry is not switched on for this store yet. Use Card (QR) or a card reader.")
    XCTAssertNil(error.field)
  }

  func testNoPublishableKeyNeverCallsStripe() async {
    let tokenizer = StripeCardTokenizer { _ in
      XCTFail("Stripe was called")
      throw URLError(.badURL)
    }
    let details = CardDetails(number: "4242424242424242", expMonth: 12, expYear: 2034, cvc: "123", postalCode: "78701")
    do {
      _ = try await tokenizer.createPaymentMethod(details, publishableKey: "sk_test_nope")
    } catch let error as CardTokenError {
      XCTAssertEqual(error.message, "Card entry is not set up for this site.")
    } catch {
      XCTFail("\(error)")
    }
  }

  func testALostConnectionSaysSo() async {
    let tokenizer = StripeCardTokenizer { _ in throw URLError(.notConnectedToInternet) }
    let details = CardDetails(number: "4242424242424242", expMonth: 12, expYear: 2034, cvc: "123", postalCode: "78701")
    do {
      _ = try await tokenizer.createPaymentMethod(details, publishableKey: "pk_test_51Habc")
    } catch let error as CardTokenError {
      XCTAssertEqual(error.message, "The card could not be checked. Check the connection and try again.")
    } catch {
      XCTFail("\(error)")
    }
  }
}
