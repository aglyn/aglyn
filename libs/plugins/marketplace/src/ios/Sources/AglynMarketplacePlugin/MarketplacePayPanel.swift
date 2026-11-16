// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// Paying for a listing, in place under the Buy button (`MarketplacePayPanel`): the total before Pay, a card or an address
/// when one is missing, who can add it when this person cannot, and the bank's step. Nothing here is a sheet, as the
/// console's panel is no dialog. Figma: NrDk4KvvasUKUcramPMwU5, "Buying a paid listing".
struct MarketplacePayPanel: View {
  let context: NativePluginContext
  @Bindable var pay: MarketplacePay
  @State private var address = PayBillingAddress()

  private var listingName: String { pay.listing?.name ?? "this listing" }
  private var billingLabel: String { orgPermissionLabel(ContractValues.shared.orgRoleGrants, key: "billing.manage") }

  var body: some View {
    if let step = pay.step {
      VStack(alignment: .leading, spacing: AglynSpace.oneAndHalf) {
        content(step)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .accessibilityIdentifier("marketplace-pay")
    }
  }

  @ViewBuilder
  private func content(_ step: PayStep) -> some View {
    switch step {
    case .confirm(let quote):
      Text("Buy \(quote.listingName)").font(AglynFont.strongSubheadline).accessibilityAddTraits(.isHeader)
      VStack(spacing: AglynSpace.half) {
        line("Price", formatPayCents(quote.amountCents))
        line("Sales tax", formatPayCents(quote.taxCents))
        Divider()
        line("Total", formatPayCents(quote.totalCents), strong: true)
      }
      .accessibilityIdentifier("marketplace-pay-summary")
      if quote.canPay {
        Text("Charged to \(payCardLabel(quote.card)). The receipt lands in Billing.")
          .font(AglynFont.subheadline).foregroundStyle(.secondary)
        // A card that will not pay is changed in Billing: the way there is beside the reason.
        if let error = pay.error {
          AglynNotice(error, tone: .warning, actionTitle: "Open Billing") { context.navigate("core.billing.settings") }
            .accessibilityIdentifier("marketplace-pay-error")
        }
        HStack(spacing: AglynSpace.one) {
          Button(pay.busy ? "Paying…" : "Pay \(formatPayCents(quote.totalCents))") { Task { await pay.pay() } }
            .buttonStyle(.aglynProminent).disabled(pay.busy).accessibilityIdentifier("marketplace-pay-confirm")
          Button("Cancel") { pay.cancel() }.buttonStyle(.aglynSecondary).disabled(pay.busy)
        }
      } else {
        AglynNotice(
          "Buying this charges your workspace's card, which takes the \"\(billingLabel)\" permission. Ask someone who manages billing to buy it.",
          tone: .warning)
        Button("Close") { pay.cancel() }.buttonStyle(.aglynSecondary)
      }
    case .card:
      Text("Add a card to buy \(listingName)").font(AglynFont.strongSubheadline).accessibilityAddTraits(.isHeader)
      Text("It stays on file for this workspace, in Billing, where you can change or remove it.")
        .font(AglynFont.subheadline).foregroundStyle(.secondary)
      failure
      HStack(spacing: AglynSpace.one) {
        Button(pay.busy ? "Opening…" : "Add a card on Stripe") { Task { await pay.addCard() } }
          .buttonStyle(.aglynProminent).disabled(pay.busy).accessibilityIdentifier("marketplace-pay-add-card")
        Button("Cancel") { pay.cancel() }.buttonStyle(.aglynSecondary).disabled(pay.busy)
      }
    case .address:
      Text("Add a billing address").font(AglynFont.strongSubheadline).accessibilityAddTraits(.isHeader)
      Text("Sales tax is calculated from it. It stays on file for this workspace, in Billing.")
        .font(AglynFont.subheadline).foregroundStyle(.secondary)
      failure
      addressFields
      HStack(spacing: AglynSpace.one) {
        Button(pay.busy ? "Saving…" : "Save address") { Task { await pay.saveAddress(address) } }
          .buttonStyle(.aglynProminent).disabled(pay.busy || !address.complete).accessibilityIdentifier("marketplace-pay-save-address")
        Button("Cancel") { pay.cancel() }.buttonStyle(.aglynSecondary).disabled(pay.busy)
      }
    case .askBilling(let need, let amountCents):
      if let amountCents { line("Price", formatPayCents(amountCents)) }
      AglynNotice(
        (need == .cardRequired
          ? "This workspace needs a card on file to buy this."
          : "This workspace needs a billing address to buy this: sales tax is calculated from it.")
          + " Someone with the \"\(billingLabel)\" permission can add it in Billing.",
        tone: .warning)
      Button("Close") { pay.cancel() }.buttonStyle(.aglynSecondary)
    case .bank:
      Text("Your bank needs to confirm").font(AglynFont.strongSubheadline).accessibilityAddTraits(.isHeader)
      HStack(spacing: AglynSpace.one) {
        ProgressView().controlSize(.small)
        Text("Finish it on the invoice page we just opened; it is yours once it is paid.")
          .font(AglynFont.subheadline).foregroundStyle(.secondary)
      }
      .accessibilityIdentifier("marketplace-pay-bank")
    }
  }

  @ViewBuilder
  private var failure: some View {
    if let error = pay.error { AglynNotice(error, tone: .warning).accessibilityIdentifier("marketplace-pay-error") }
  }

  private func line(_ label: String, _ value: String, strong: Bool = false) -> some View {
    HStack {
      Text(label)
      Spacer()
      Text(value).monospacedDigit()
    }
    .font(strong ? AglynFont.strongSubheadline : AglynFont.subheadline)
    .accessibilityElement(children: .combine)
  }

  /// The console's Billing address form, as the app's Billing details draws it: Stripe's Address Element is web only.
  private var addressFields: some View {
    VStack(spacing: AglynSpace.one) {
      field("Name on invoices", \.name, content: .name)
      field("Address", \.line1, content: .streetAddressLine1)
      field("Address line 2", \.line2, content: .streetAddressLine2)
      field("City", \.city, content: .addressCity)
      field("State or region", \.state, content: .addressState)
      field("Postal code", \.postalCode, content: .postalCode)
      field("Country (2 letters)", \.country, content: .countryName, prompt: "US")
    }
    .textFieldStyle(.aglyn)
    .accessibilityIdentifier("marketplace-pay-address")
  }

  private func field(_ label: String, _ key: WritableKeyPath<PayBillingAddress, String>, content: TextContentKind, prompt: String? = nil)
    -> some View
  {
    TextField(label, text: Binding(get: { address[keyPath: key] }, set: { address[keyPath: key] = $0 }), prompt: prompt.map { Text($0) })
      .textContentKind(content)
      .accessibilityIdentifier("marketplace-pay-address-\(label)")
  }
}

/// `textContentType` on iOS; nothing on the Mac, whose fields autofill from the field's label.
enum TextContentKind {
  case name, streetAddressLine1, streetAddressLine2, addressCity, addressState, postalCode, countryName
}

extension View {
  @ViewBuilder
  fileprivate func textContentKind(_ kind: TextContentKind) -> some View {
    #if os(iOS)
      switch kind {
      case .name: textContentType(.name)
      case .streetAddressLine1: textContentType(.streetAddressLine1)
      case .streetAddressLine2: textContentType(.streetAddressLine2)
      case .addressCity: textContentType(.addressCity)
      case .addressState: textContentType(.addressState)
      case .postalCode: textContentType(.postalCode)
      case .countryName: textContentType(.countryName).textInputAutocapitalization(.characters)
      }
    #else
      self
    #endif
  }
}

extension PayNoticeTone {
  /// The kit's tone for a purchase's notice.
  var aglynTone: AglynTone {
    switch self {
    case .success: .success
    case .info: .info
    case .warning: .warning
    case .error: .error
    }
  }
}
