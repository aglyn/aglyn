// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynHardware
import AglynUI
import Observation
import SwiftUI

#if canImport(UIKit)
  import UIKit
#elseif canImport(AppKit)
  import AppKit
#endif

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
    message = nil
    guard let finish = onClose else { return }
    onClose = nil
    finish(outcome)
  }
}

/// The card fields, as a sheet over the checkout.
struct CardFieldsSheet: View {
  @Bindable var session: CardFormSession
  /// The field the cursor is in (the platform fields report and follow it).
  @State private var focus: CardFields.Field?
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
      .onChange(of: session.busy) { _, busy in if busy { focus = nil } }
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
        CardTextField(
          kind: which, placeholder: prompt, accessibilityLabel: title, identifier: identifier(which),
          text: { text(which) },
          edit: { next in
            session.edit(which, next)
            if session.isComplete(which) { focus = following(which) }
          },
          focused: Binding(
            get: { focus == which },
            set: { now in
              if now {
                focus = which
              } else if focus == which {
                focus = nil
              }
            }),
          onSubmit: {
            if which == .postalCode { Task { await session.pay() } } else { focus = following(which) }
          }
        )
        .frame(minHeight: 30)
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

/*
 * One card field, on the platform's own text field. Each keystroke is
 * formatted in the field's delegate, before the field changes, so fast
 * typing, a hardware keyboard or a paste never loses a digit to a re-render
 * (a SwiftUI TextField whose binding rewrites the text drops keystrokes that
 * arrive in between). No autocorrection, no suggestions, no autofill, no
 * smart punctuation: nothing the system keeps or offers back.
 */
#if os(iOS)
  struct CardTextField: UIViewRepresentable {
    let kind: CardFields.Field
    let placeholder: String
    let accessibilityLabel: String
    let identifier: String
    let text: () -> String
    let edit: (String) -> Void
    @Binding var focused: Bool
    let onSubmit: () -> Void

    func makeUIView(context: Context) -> UITextField {
      let field = UITextField()
      field.delegate = context.coordinator
      field.placeholder = placeholder
      field.accessibilityLabel = accessibilityLabel
      field.accessibilityIdentifier = identifier
      field.font = UIFont.monospacedDigitSystemFont(ofSize: UIFont.preferredFont(forTextStyle: .body).pointSize, weight: .regular)
      field.adjustsFontForContentSizeCategory = true
      field.autocorrectionType = .no
      field.spellCheckingType = .no
      field.smartDashesType = .no
      field.smartQuotesType = .no
      field.smartInsertDeleteType = .no
      field.inlinePredictionType = .no
      field.textContentType = nil
      field.autocapitalizationType = kind == .postalCode ? .allCharacters : .none
      field.keyboardType = kind == .postalCode ? .numbersAndPunctuation : .numberPad
      field.returnKeyType = kind == .postalCode ? .done : .next
      field.setContentHuggingPriority(.defaultLow, for: .horizontal)
      field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
      return field
    }

    func updateUIView(_ field: UITextField, context: Context) {
      context.coordinator.parent = self
      if field.placeholder != placeholder { field.placeholder = placeholder }
      let current = text()
      if field.text != current { field.text = current }
      if focused, !field.isFirstResponder {
        DispatchQueue.main.async { field.becomeFirstResponder() }
      } else if !focused, field.isFirstResponder {
        DispatchQueue.main.async { field.resignFirstResponder() }
      }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UITextFieldDelegate {
      var parent: CardTextField

      init(_ parent: CardTextField) { self.parent = parent }

      func textField(_ field: UITextField, shouldChangeCharactersIn range: NSRange, replacementString string: String) -> Bool {
        let current = field.text ?? ""
        guard let swapped = Range(range, in: current) else { return false }
        var start = range.location
        var proposed = current.replacingCharacters(in: swapped, with: string)
        // Deleting a separator deletes the digit before it, or the cursor would stick.
        if string.isEmpty, range.length == 1, let removed = current[swapped].first, !removed.isLetter, !removed.isNumber,
          range.location > 0
        {
          let before = current.index(current.startIndex, offsetBy: range.location - 1)
          proposed = current.replacingCharacters(in: before..<swapped.upperBound, with: "")
          start -= 1
        }
        // Where the cursor goes: after as many letters and digits as precede the edit's end.
        let keep = proposed.prefix(start + string.count).filter { $0.isLetter || $0.isNumber }.count
        parent.edit(proposed)
        let formatted = parent.text()
        field.text = formatted
        var seen = 0
        var offset = formatted.count
        if keep < formatted.filter({ $0.isLetter || $0.isNumber }).count {
          for (index, character) in formatted.enumerated() where character.isLetter || character.isNumber {
            seen += 1
            if seen == keep { offset = index + 1; break }
          }
          if keep == 0 { offset = 0 }
        }
        if let position = field.position(from: field.beginningOfDocument, offset: offset) {
          field.selectedTextRange = field.textRange(from: position, to: position)
        }
        return false
      }

      func textFieldDidBeginEditing(_ field: UITextField) {
        if !parent.focused { parent.focused = true }
      }

      func textFieldDidEndEditing(_ field: UITextField) {
        if parent.focused { parent.focused = false }
      }

      func textFieldShouldReturn(_ field: UITextField) -> Bool {
        parent.onSubmit()
        return false
      }
    }
  }
#elseif os(macOS)
  struct CardTextField: NSViewRepresentable {
    let kind: CardFields.Field
    let placeholder: String
    let accessibilityLabel: String
    let identifier: String
    let text: () -> String
    let edit: (String) -> Void
    @Binding var focused: Bool
    let onSubmit: () -> Void

    func makeNSView(context: Context) -> NSTextField {
      let field = NSTextField()
      field.delegate = context.coordinator
      field.placeholderString = placeholder
      field.setAccessibilityLabel(accessibilityLabel)
      field.setAccessibilityIdentifier(identifier)
      field.font = .monospacedDigitSystemFont(ofSize: NSFont.systemFontSize, weight: .regular)
      field.isBordered = false
      field.drawsBackground = false
      field.focusRingType = .none
      field.isAutomaticTextCompletionEnabled = false
      field.contentType = nil
      field.lineBreakMode = .byClipping
      field.usesSingleLineMode = true
      field.setContentHuggingPriority(.defaultLow, for: .horizontal)
      return field
    }

    func updateNSView(_ field: NSTextField, context: Context) {
      context.coordinator.parent = self
      if field.placeholderString != placeholder { field.placeholderString = placeholder }
      let current = text()
      if field.stringValue != current { field.stringValue = current }
      let editing = field.currentEditor() != nil
      if focused, !editing {
        DispatchQueue.main.async { field.window?.makeFirstResponder(field) }
      }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, NSTextFieldDelegate {
      var parent: CardTextField

      init(_ parent: CardTextField) { self.parent = parent }

      func controlTextDidBeginEditing(_ notification: Notification) {
        if !parent.focused { parent.focused = true }
      }

      func controlTextDidChange(_ notification: Notification) {
        guard let field = notification.object as? NSTextField else { return }
        let typed = field.stringValue
        parent.edit(typed)
        let formatted = parent.text()
        if formatted != typed {
          field.stringValue = formatted
          field.currentEditor()?.selectedRange = NSRange(location: (formatted as NSString).length, length: 0)
        }
      }

      func controlTextDidEndEditing(_ notification: Notification) {
        if parent.focused { parent.focused = false }
      }

      func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        if selector == #selector(NSResponder.insertNewline(_:)) {
          parent.onSubmit()
          return true
        }
        return false
      }
    }
  }
#endif
