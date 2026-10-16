// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynHardware
import AglynUI
import Observation
import SwiftUI

/*
 * "ENTER CARD MANUALLY": THE REGISTER'S OWN CARD FIELDS.
 *
 * Native fields, styled like every other form in Aglyn POS on iPhone, iPad
 * and Mac: the number (formatted as typed, its brand named, Luhn-checked),
 * expiry, security code and billing postal code, each with its error under
 * it. Pay sends the card to Stripe alone (`StripeCardTokenizer`, the site's
 * publishable key) and hands the PaymentMethod id to the register; the card
 * itself goes nowhere else. Nothing here logs, stores or caches it, the
 * fields are emptied when the form closes, and the form is covered whenever
 * the app is not in front, so the app switcher's snapshot never shows it.
 */

/// The form for the charge in progress; the checkout presents it while one is open.
@MainActor
@Observable
final class CardFieldsPresenter: KeyedCardEntry {
  private(set) var session: CardFormSession?
  @ObservationIgnored private let tokenizer: StripeCardTokenizer
  @ObservationIgnored private let now: () -> Date

  init(tokenizer: StripeCardTokenizer = StripeCardTokenizer(), now: @escaping () -> Date = Date.init) {
    self.tokenizer = tokenizer
    self.now = now
  }

  func collect(
    _ request: KeyedCardRequest, submit: @escaping @MainActor (String) async -> KeyedCardVerdict
  ) async -> KeyedCardOutcome {
    session?.close(.canceled)
    return await withCheckedContinuation { continuation in
      let opened = CardFormSession(request: request, tokenizer: tokenizer, now: now, submit: submit)
      opened.onClose = { [weak self, weak opened] outcome in
        if let self, self.session === opened { self.session = nil }
        continuation.resume(returning: outcome)
      }
      session = opened
    }
  }

  func dismiss() { session?.close(.canceled) }
}

/// One charge's card fields: what was typed, which errors show, and the Pay press.
@MainActor
@Observable
final class CardFormSession: Identifiable {
  let id = UUID()
  let request: KeyedCardRequest
  var fields = CardFields()
  /// Fields the cashier has left: their errors show even when unfinished.
  private(set) var left: Set<CardFields.Field> = []
  /// Errors from the Pay press or from Stripe, until the field is edited.
  private(set) var raised: [CardFields.Field: String] = [:]
  /// The bank's or Stripe's words about the last card, above the fields.
  private(set) var message: String?
  private(set) var busy = false
  @ObservationIgnored private let tokenizer: StripeCardTokenizer
  @ObservationIgnored private let now: () -> Date
  @ObservationIgnored private let submit: @MainActor (String) async -> KeyedCardVerdict
  @ObservationIgnored var onClose: ((KeyedCardOutcome) -> Void)?

  init(
    request: KeyedCardRequest, tokenizer: StripeCardTokenizer, now: @escaping () -> Date = Date.init,
    submit: @escaping @MainActor (String) async -> KeyedCardVerdict
  ) {
    self.request = request
    self.tokenizer = tokenizer
    self.now = now
    self.submit = submit
  }

  /// The words under `field`, or nil. `editing` is the field the cursor is in.
  func error(_ field: CardFields.Field, editing: CardFields.Field?) -> String? {
    if let raised = raised[field] { return raised }
    return fields.problem(field, typing: editing == field || !left.contains(field), now: now())
  }

  /// The cashier changed `field`: its old error goes, and the field is reformatted.
  func edit(_ field: CardFields.Field, _ text: String) {
    raised[field] = nil
    switch field {
    case .number: fields.number = formatCardNumber(text)
    case .expiry: fields.expiry = formatCardExpiry(text, deleting: text.count < fields.expiry.count)
    case .cvc: fields.cvc = String(cardDigits(text).prefix(4))
    case .postalCode: fields.postalCode = String(text.prefix(10)).uppercased()
    }
  }

  func leave(_ field: CardFields.Field) { left.insert(field) }

  /// The field complete enough to move on from, so the cursor can go to the next one.
  func isComplete(_ field: CardFields.Field) -> Bool {
    switch field {
    case .number: return fields.numberIsComplete
    case .expiry: return cardDigits(fields.expiry).count == 4 && fields.problem(.expiry, now: now()) == nil
    case .cvc: return cardDigits(fields.cvc).count == fields.brand.cvcLength
    case .postalCode: return false
    }
  }

  var canPay: Bool { !busy }

  /// Checks every field, sends the card to Stripe, and hands the PaymentMethod to the register.
  func pay() async {
    guard !busy else { return }
    left = Set(CardFields.Field.allCases)
    message = nil
    let problems = fields.problems(now: now())
    raised = problems
    guard problems.isEmpty, let card = fields.details(now: now()) else { return }
    busy = true
    let paymentMethod: String
    do {
      paymentMethod = try await tokenizer.createPaymentMethod(card, publishableKey: request.publishableKey)
    } catch {
      let failure = (error as? CardTokenError) ?? CardTokenError(message: "The card was not accepted. Check it and try again.")
      if let field = failure.field { raised[field] = failure.message } else { message = failure.message }
      busy = false
      return
    }
    let verdict = await submit(paymentMethod)
    busy = false
    switch verdict {
    case .paid: close(.paid)
    case .lost(let words): close(.lost(words))
    case .declined(let words):
      message = words
      // The next try is a new card or the same one again; the security code is always asked for again.
      fields.cvc = ""
      left.remove(.cvc)
    }
  }

  func cancel() {
    guard !busy else { return }
    close(.canceled)
  }

  /// Empties the fields and ends the form.
  func close(_ outcome: KeyedCardOutcome) {
    fields.clear()
    raised = [:]
    left = []
    guard let finish = onClose else { return }
    onClose = nil
    finish(outcome)
  }
}

/// The card fields, as a sheet over the checkout.
struct CardFieldsSheet: View {
  @Bindable var session: CardFormSession
  @FocusState private var focus: CardFields.Field?
  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    NavigationStack {
      Form {
        Section {
          VStack(alignment: .leading, spacing: AglynSpace.half) {
            Text(session.request.amountText).font(AglynFont.figure).monospacedDigit()
            Text(session.request.merchantName).font(AglynFont.subheadline).foregroundStyle(.secondary)
          }
          .accessibilityElement(children: .combine)
        }
        if let message = session.message {
          Section { AglynNotice(message, tone: .error).accessibilityIdentifier("card-message") }
        }
        Section {
          field(.number, "Card number", prompt: "1234 1234 1234 1234") {
            Text(session.fields.brand == .unknown ? "" : session.fields.brand.name)
              .font(AglynFont.caption).foregroundStyle(.secondary)
              .accessibilityIdentifier("card-brand")
          }
          HStack(alignment: .top, spacing: AglynSpace.two) {
            field(.expiry, "Expiry", prompt: "MM / YY")
            field(.cvc, "Security code", prompt: session.fields.brand.cvcLength == 4 ? "1234" : "123")
          }
          field(.postalCode, "Billing postal code", prompt: "ZIP or postal code")
        } header: {
          Text("Card")
        } footer: {
          Text("The card goes straight to Stripe to take this payment. Aglyn POS does not keep it.")
        }
      }
      .formStyle(.grouped)
      .disabled(session.busy)
      .navigationTitle(keyedCardLabel)
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { session.cancel() }
            .disabled(session.busy)
            .accessibilityIdentifier("card-cancel")
        }
        ToolbarItem(placement: .confirmationAction) {
          if session.busy {
            ProgressView()
          } else {
            Button("Pay \(session.request.amountText)") { Task { await session.pay() } }
              .keyboardShortcut(.defaultAction)
              .accessibilityIdentifier("card-pay")
          }
        }
      }
      .onAppear { focus = .number }
      .onChange(of: focus) { previous, _ in if let previous { session.leave(previous) } }
    }
    .interactiveDismissDisabled()
    // Covered whenever the app is not in front, so the app switcher's snapshot never shows the card.
    .overlay {
      if scenePhase != .active {
        AglynColor.page.ignoresSafeArea().overlay {
          Label(keyedCardLabel, systemImage: "creditcard").font(AglynFont.headline).foregroundStyle(.secondary)
        }
      }
    }
    #if os(macOS)
      .frame(minWidth: 420, minHeight: 460)
    #endif
  }

  private func field(
    _ which: CardFields.Field, _ title: String, prompt: String,
    @ViewBuilder trailing: () -> some View = { EmptyView() }
  ) -> some View {
    let error = session.error(which, editing: focus)
    return VStack(alignment: .leading, spacing: AglynSpace.half) {
      HStack {
        TextField(
          title,
          text: Binding(
            get: { text(which) },
            set: { next in
              session.edit(which, next)
              if session.isComplete(which) { focus = following(which) }
            }),
          prompt: Text(prompt)
        )
        .focused($focus, equals: which)
        .autocorrectionDisabled()
        #if os(iOS)
          .textInputAutocapitalization(which == .postalCode ? .characters : .never)
          .keyboardType(which == .postalCode ? .numbersAndPunctuation : .numberPad)
        #endif
        .monospacedDigit()
        .privacySensitive()
        .submitLabel(which == .postalCode ? .done : .next)
        .onSubmit {
          if which == .postalCode { Task { await session.pay() } } else { focus = following(which) }
        }
        .accessibilityIdentifier(identifier(which))
        trailing()
      }
      if let error {
        Text(error).font(AglynFont.caption).foregroundStyle(AglynColor.error)
          .accessibilityIdentifier("\(identifier(which))-error")
      }
    }
  }

  private func text(_ which: CardFields.Field) -> String {
    switch which {
    case .number: session.fields.number
    case .expiry: session.fields.expiry
    case .cvc: session.fields.cvc
    case .postalCode: session.fields.postalCode
    }
  }

  private func following(_ which: CardFields.Field) -> CardFields.Field? {
    switch which {
    case .number: .expiry
    case .expiry: .cvc
    case .cvc: .postalCode
    case .postalCode: nil
    }
  }

  private func identifier(_ which: CardFields.Field) -> String {
    switch which {
    case .number: "card-number"
    case .expiry: "card-expiry"
    case .cvc: "card-cvc"
    case .postalCode: "card-postal"
    }
  }
}
