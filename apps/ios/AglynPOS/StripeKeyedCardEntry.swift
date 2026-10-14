// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

#if os(iOS) && canImport(StripePaymentSheet)
  import AglynHardware
  import StripePaymentSheet
  import UIKit

  /*
   * STRIPE'S CARD FORM, ON THIS DEVICE.
   *
   * A card typed in at the register goes into Stripe's own PaymentSheet: the
   * number is entered in Stripe's fields and goes to Stripe, never through
   * code of ours, which keeps this app's PCI scope where it was. The server
   * has already made the PaymentIntent (`card-keyed`) and records the payment
   * from its own read of Stripe, so what this reports is only how the sheet
   * closed. Aglyn POS alone links this SDK, and only on iPhone and iPad (the
   * Stripe iOS SDK has no native macOS build, and this target is not Mac
   * Catalyst); the shared register sees only `KeyedCardEntry`.
   */
  @MainActor
  final class StripeKeyedCardEntry: KeyedCardEntry {
    func collect(_ request: KeyedCardRequest) async -> KeyedCardOutcome {
      if let problem = request.problem { return .failed(paymentIntentID: request.paymentIntentID, message: problem) }
      guard let presenter = Self.topViewController() else {
        return .failed(paymentIntentID: request.paymentIntentID, message: "The card form could not be shown. Try again.")
      }
      STPAPIClient.shared.publishableKey = request.publishableKey
      var configuration = PaymentSheet.Configuration()
      configuration.merchantDisplayName = request.merchantName
      configuration.allowsDelayedPaymentMethods = false
      // A card typed in for one sale: no Link account, no saved cards (no `customer`), no Apple Pay (no `applePay`).
      configuration.link = PaymentSheet.LinkConfiguration(display: .never)
      let sheet = PaymentSheet(paymentIntentClientSecret: request.clientSecret, configuration: configuration)
      return Self.outcome(of: await sheet.present(from: presenter), paymentIntentID: request.paymentIntentID)
    }

    /// How the sheet closed, in the register's three words.
    static func outcome(of result: PaymentSheetResult, paymentIntentID: String) -> KeyedCardOutcome {
      switch result {
      case .completed: .confirmed(paymentIntentID: paymentIntentID)
      case .canceled: .canceled(paymentIntentID: paymentIntentID)
      case .failed(let error):
        .failed(
          paymentIntentID: paymentIntentID,
          message: error.localizedDescription.isEmpty ? "The card was not accepted." : error.localizedDescription)
      }
    }

    /// The view controller the sheet presents over: whatever is on top in the key window.
    private static func topViewController() -> UIViewController? {
      let window = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        .flatMap(\.windows).first(where: \.isKeyWindow)
      var top = window?.rootViewController
      while let presented = top?.presentedViewController { top = presented }
      return top
    }
  }
#endif
