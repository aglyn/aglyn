// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import Foundation
import SwiftUI

/*
 * The quote editor (AGL-4093), as the console's QuoteEditorDialog has it: who the quote is for, its lines (products
 * with their options and add-ons, typed items, things included at no charge), discount, shipping, the two addresses,
 * notes and terms, with the totals worked out as it is edited. The server prices and saves it
 * (`POST /api/commerce/quote` create or update); the totals here are the same functions over the same inputs. A saved
 * quote left as it is shows what its customer's page shows. Sending, the pay link and proofs are not here yet.
 */

let quoteEditPermission = "commerce.quotes"

/// Dollars typed into a field, as whole cents; 0 for nothing, nil when it is not an amount (the console's `centsOf`).
func quoteCentsOf(_ text: String) -> Int? {
  let trimmed = text.trimmingCharacters(in: .whitespaces)
  if trimmed.isEmpty { return 0 }
  guard trimmed.range(of: #"^\d+(\.\d{0,2})?$"#, options: .regularExpression) != nil, let value = Double(trimmed) else {
    return nil
  }
  return Int((value * 100 + 0.5).rounded(.down))
}

/// Cents as the field shows them: `12.5`, `40`, or nothing for none (the console's `dollarsOf`).
func quoteDollarsOf(_ cents: Double?) -> String {
  guard let cents, cents != 0 else { return "" }
  let text = String(format: "%.2f", cents / 100)
  return text.hasSuffix(".00") ? String(text.dropLast(3)) : text
}

struct QuoteAddressDraft: Equatable {
  var name = "", line1 = "", line2 = "", city = "", state = "", postalCode = "", country = ""

  init(_ address: OrderAddress? = nil) {
    name = address?.name ?? ""
    line1 = address?.line1 ?? ""
    line2 = address?.line2 ?? ""
    city = address?.city ?? ""
    state = address?.state ?? ""
    postalCode = address?.postalCode ?? ""
    country = address?.country ?? ""
  }

  /// What the server is sent: the filled fields, trimmed, or null when none is (`addressBody`).
  var body: JSONValue {
    let fields: [(String, String)] = [
      ("name", name), ("line1", line1), ("line2", line2), ("city", city), ("state", state),
      ("postalCode", postalCode), ("country", country),
    ]
    let filled = fields.compactMap { key, value -> (String, JSONValue)? in
      let trimmed = value.trimmingCharacters(in: .whitespaces)
      return trimmed.isEmpty ? nil : (key, .string(trimmed))
    }
    return filled.isEmpty ? .null : .object(Dictionary(uniqueKeysWithValues: filled))
  }
}

/// One line as the form edits it (the console's `LineForm`).
struct QuoteLineDraft: Identifiable, Equatable {
  enum Kind { case catalog, custom }
  let id = UUID()
  var kind: Kind
  var productID = ""
  var variantID = ""
  var modifiers: [ModifierSelection] = []
  var name = ""
  var sku = ""
  var price = ""
  var ships = true
  var quantity = "1"
  var description = ""
  var included = false

  static func from(_ line: OrderLineItem) -> QuoteLineDraft {
    switch quoteLineRequestFromLine(line) {
    case .custom(let name, let description, let sku, let cents, let quantity, let ships, let included):
      var draft = QuoteLineDraft(kind: .custom)
      draft.name = name
      draft.description = description ?? ""
      draft.sku = sku ?? ""
      draft.price = quoteDollarsOf(cents)
      draft.quantity = String(Int(quantity))
      draft.ships = ships
      draft.included = included
      return draft
    case .catalog(let productID, let variantID, let quantity, let modifiers, let included, let description):
      var draft = QuoteLineDraft(kind: .catalog)
      draft.productID = productID
      draft.variantID = variantID ?? ""
      draft.quantity = String(Int(quantity))
      draft.modifiers = modifiers
      draft.description = description ?? ""
      draft.included = included
      return draft
    }
  }

  private var quantityNumber: Double { Double(quantity) ?? .nan }
  private var trimmedDescription: String? {
    let text = description.trimmingCharacters(in: .whitespacesAndNewlines)
    return text.isEmpty ? nil : text
  }

  /// What the server is sent for the line: its choices, never what a product costs (`lineRequest`).
  var body: JSONValue {
    var fields: [String: JSONValue] = ["kind": .string(kind == .catalog ? "catalog" : "custom")]
    fields["quantity"] = .number(quantityNumber.isNaN ? 0 : quantityNumber)
    if let trimmedDescription { fields["description"] = .string(trimmedDescription) }
    if included { fields["included"] = .bool(true) }
    switch kind {
    case .catalog:
      fields["productId"] = .string(productID)
      if !variantID.isEmpty { fields["variantId"] = .string(variantID) }
      if !modifiers.isEmpty {
        fields["modifiers"] = .array(
          modifiers.map { .object(["groupId": .string($0.groupId), "optionId": .string($0.optionId)]) })
      }
    case .custom:
      fields["name"] = .string(name.trimmingCharacters(in: .whitespaces))
      let sku = sku.trimmingCharacters(in: .whitespaces)
      if !sku.isEmpty { fields["sku"] = .string(sku) }
      fields["unitAmountCents"] = .number(included ? 0 : Double(quoteCentsOf(price) ?? -1))
      fields["ships"] = .bool(ships)
    }
    return .object(fields)
  }

  /// The line priced as the server will price it, or why it can't be (the editor's `priced`).
  func priced(_ products: [String: HostProduct]) -> PricedQuoteLine {
    switch kind {
    case .custom:
      if name.trimmingCharacters(in: .whitespaces).isEmpty { return .refused("Name the item.") }
      let cents = included ? 0 : quoteCentsOf(price)
      guard let cents else { return .refused("Enter a price.") }
      guard quantityNumber >= 1 else { return .refused("Enter a quantity.") }
      return .ok(
        priceQuoteCustomLine(
          name: name.trimmingCharacters(in: .whitespaces), description: trimmedDescription,
          sku: sku.trimmingCharacters(in: .whitespaces), unitAmountCents: Double(cents), quantity: quantityNumber,
          ships: ships, included: included))
    case .catalog:
      if productID.isEmpty { return .refused("Choose a product.") }
      guard quantityNumber >= 1 else { return .refused("Enter a quantity.") }
      return priceQuoteCatalogLine(
        products[productID], productID: productID, variantID: variantID.isEmpty ? nil : variantID,
        quantity: quantityNumber, modifiers: modifiers, included: included, description: trimmedDescription)
    }
  }
}

enum QuoteDiscountChoice: String, CaseIterable { case none, amount, percent }

/// Everything the editor changes (the console's `QuoteForm`).
struct QuoteDraft: Equatable {
  var lines: [QuoteLineDraft] = []
  var record: QuoteCustomerRecord?
  var name = "", company = "", email = "", phone = ""
  var shipTo = QuoteAddressDraft()
  var billTo = QuoteAddressDraft()
  var discountKind = QuoteDiscountChoice.none
  var discountValue = ""
  var shipping = ""
  var notes = ""
  var terms = ""
  var requireProofApproval = false
  var requireProofSignIn = false

  init() {}

  init(_ order: HostOrder) {
    let quote = order.quote
    lines = (order.lineItems ?? []).map(QuoteLineDraft.from)
    record = quote?.customer.record
    name = quote?.customer.name ?? ""
    company = quote?.customer.company ?? ""
    email = quote?.customer.email ?? ""
    phone = quote?.customer.phone ?? ""
    shipTo = QuoteAddressDraft(quote?.shipTo)
    billTo = QuoteAddressDraft(quote?.billTo)
    switch quote?.discount?.kind {
    case .amount:
      discountKind = .amount
      discountValue = quoteDollarsOf(quote?.discount?.amountCents)
    case .percent:
      discountKind = .percent
      discountValue = quote?.discount?.pct.map { jsNumber($0) } ?? ""
    default: break
    }
    shipping = quoteDollarsOf(quote?.shipping?.amountCents)
    notes = quote?.notes ?? ""
    terms = quote?.terms ?? ""
    requireProofApproval = quote?.requireProofApproval == true
    requireProofSignIn = quote?.requireProofSignIn == true
  }

  /// The discount as the totals read it, or nil (the editor's `discount`).
  var discount: QuoteDiscount? {
    switch discountKind {
    case .amount:
      guard let cents = quoteCentsOf(discountValue), cents > 0 else { return nil }
      return QuoteDiscount(amountCents: Double(cents), kind: .amount)
    case .percent:
      guard let pct = Double(discountValue), pct > 0 else { return nil }
      return QuoteDiscount(kind: .percent, pct: min(100, pct))
    case .none: return nil
    }
  }

  /// What the server is sent (`quoteBody`): choices, never what a product costs.
  func body(requireProofApproval: Bool, requireProofSignIn: Bool) -> JSONValue {
    let priced = !lines.isEmpty
    var customer: [String: JSONValue] = [
      "name": .string(name), "company": .string(company), "email": .string(email), "phone": .string(phone),
    ]
    if let record { customer["record"] = .object(["kind": .string(record.kind), "id": .string(record.id)]) }
    var discountBody = JSONValue.null
    if priced {
      switch discountKind {
      case .amount: discountBody = .object(["kind": .string("amount"), "amountCents": .number(Double(quoteCentsOf(discountValue) ?? -1))])
      case .percent: discountBody = .object(["kind": .string("percent"), "pct": .number(Double(discountValue) ?? 0)])
      case .none: break
      }
    }
    let shippingBody: JSONValue =
      priced && !shipping.trimmingCharacters(in: .whitespaces).isEmpty
      ? .object(["amountCents": .number(Double(quoteCentsOf(shipping) ?? -1))]) : .null
    return .object([
      "lines": .array(lines.map(\.body)),
      "customer": .object(customer),
      "shipTo": shipTo.body,
      "billTo": billTo.body,
      "discount": discountBody,
      "shipping": shippingBody,
      "notes": .string(notes),
      "terms": .string(terms),
      "requireProofApproval": .bool(requireProofApproval),
      "requireProofSignIn": .bool(requireProofSignIn),
    ])
  }
}

private func jsNumber(_ value: Double) -> String {
  value == value.rounded() && abs(value) < 1e15 ? String(Int(value)) : String(value)
}

/// One person the workspace keeps, as `search-customers` answers.
struct FoundQuoteCustomer: Identifiable, Equatable {
  let record: QuoteCustomerRecord
  let name: String
  let company: String
  let email: String
  let phone: String
  var id: String { "\(record.kind):\(record.id)" }
}

/// The quote's totals, as the customer reads them: Items, Discount, Shipping, the tax line and the total.
struct QuoteTotalsRows: View {
  let itemsCents: Int
  let discountCents: Int
  let shippingCents: Int
  let taxCents: Int
  let totalCents: Int
  let taxLabel: String
  /// Stripe Tax works the tax out when the customer pays, so there is no figure yet.
  let taxAtPayment: Bool

  var body: some View {
    AglynAmountRow("Items", amount: formatOrderMoney(itemsCents))
    if discountCents != 0 { AglynAmountRow("Discount", amount: "−\(formatOrderMoney(discountCents))") }
    if shippingCents != 0 { AglynAmountRow("Shipping", amount: formatOrderMoney(shippingCents)) }
    if taxAtPayment {
      Text(taxLabel).foregroundStyle(.secondary)
    } else {
      AglynAmountRow(taxLabel, amount: formatOrderMoney(taxCents))
    }
    AglynAmountRow(taxAtPayment ? "Total before tax" : "Total", amount: formatOrderMoney(totalCents), emphasized: true)
  }
}

/// A field whose label stays in view once it is filled: the label leading, what is typed trailing.
struct QuoteLabeledField: View {
  let label: String
  @Binding var text: String
  var prompt: String? = nil

  var body: some View {
    LabeledContent(label) {
      TextField(label, text: $text, prompt: Text(prompt ?? "")).multilineTextAlignment(.trailing)
    }
  }
}

/// The editor: a new quote, or a saved one (`quoteID`) with the version it was opened on.
struct QuoteEditorSheet: View {
  let context: NativePluginContext
  let quoteID: String?
  let order: HostOrder?
  let products: [String: HostProduct]
  let productList: [(id: String, product: HostProduct)]
  let storeData: [String: Any]?
  /// "{Quote #n} saved", or "{Quote #n} deleted", for the screen it returns to.
  var onDone: (String, Bool) -> Void

  @State private var draft: QuoteDraft
  @State private var edited = false
  @State private var approvalSet = false
  @State private var signInSet = false
  @State private var attemptKey: String?
  @State private var confirmingDelete = false
  @State private var deleting = false
  @State private var deleteError: String?
  @State private var search = ""
  @State private var found: [FoundQuoteCustomer] = []
  @State private var searchAvailable = true
  @Environment(\.dismiss) private var dismiss

  private let baseUpdatedAtMs: Double?

  init(
    context: NativePluginContext, quoteID: String?, order: HostOrder?, productList: [(id: String, product: HostProduct)],
    storeData: [String: Any]?, onDone: @escaping (String, Bool) -> Void
  ) {
    self.context = context
    self.quoteID = quoteID
    self.order = order
    self.productList = productList
    self.products = Dictionary(productList.map { ($0.id, $0.product) }, uniquingKeysWith: { first, _ in first })
    self.storeData = storeData
    self.onDone = onDone
    baseUpdatedAtMs = order?.quote?.updatedAtMs
    _draft = State(initialValue: order.map(QuoteDraft.init) ?? QuoteDraft())
  }

  private var hostID: String { context.hostID ?? "" }
  private var quotesSettings: [String: Any]? { storeData?["quotes"] as? [String: Any] }
  private var paid: Bool { order.map { !isUnpaidQuote($0) } ?? false }
  private var title: String { order.map { formatQuoteNumber($0, docId: quoteID) } ?? "New quote" }
  private var deletable: Bool {
    guard let order else { return false }
    return !paid && (order.quote?.stage ?? .draft) == .draft
  }
  /// No lines, with a proof on the current revision (AGL-4184): it goes out before it has a price.
  private var proofOnly: Bool {
    guard draft.lines.isEmpty, let quote = order?.quote else { return false }
    return (quote.proofs ?? []).contains { $0.revision == quote.revision }
  }
  private var requireProofApproval: Bool {
    order != nil || approvalSet ? draft.requireProofApproval : quoteRequiresProofApprovalByDefault(quotesSettings)
  }
  private var requireProofSignIn: Bool {
    order != nil || signInSet ? draft.requireProofSignIn : quoteRequiresProofSignInByDefault(quotesSettings)
  }

  var body: some View {
    let priced = draft.lines.map { $0.priced(products) }
    let problems = priced.contains { if case .refused = $0 { true } else { false } }
    AglynFormSheet(
      title, confirm: order != nil ? "Save" : proofOnly ? "Create proof" : "Create quote",
      canConfirm: !paid && context.can(quoteEditPermission) && (!draft.lines.isEmpty || proofOnly) && !problems,
      save: save
    ) {
      if paid {
        Section {
          AglynNotice(
            order?.quote?.paidAtMs.map {
              "Paid \(Date(timeIntervalSince1970: $0 / 1000).formatted(date: .numeric, time: .omitted)). It is an order now and can no longer be changed."
            } ?? "This quote has been paid, so it is an order now and can no longer be changed.", tone: .success)
        }
      }
      if !context.can(quoteEditPermission) {
        Section { AglynNotice(context.refusal(quoteEditPermission), tone: .info) }
      }
      customerSection
      itemsSections(priced)
      if !proofOnly { discountSection }
      addressSection("Ship to", $draft.shipTo, helper: "Where the order goes. Store tax rates use its state and country.")
      addressSection("Bill to", $draft.billTo, helper: nil)
      textSection
      if !proofOnly { totalsSection(priced) }
      if deletable {
        Section {
          if let deleteError { AglynNotice(deleteError, tone: .error) }
          Button("Delete", role: .destructive) { confirmingDelete = true }
            .disabled(deleting || !context.can(quoteEditPermission))
            .accessibilityIdentifier("quote-delete")
        }
      }
    }
    .onChange(of: draft) { _, _ in
      edited = true
      attemptKey = nil
    }
    .confirmationDialog("Delete \(title)?", isPresented: $confirmingDelete, titleVisibility: .visible) {
      Button("Delete", role: .destructive) { Task { await remove() } }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("The quote and everything on it is removed. This can’t be undone.")
    }
    .task(id: search) { await findCustomers() }
  }

  // MARK: Customer

  @ViewBuilder private var customerSection: some View {
    Section("Customer") {
      if draft.record != nil {
        HStack {
          VStack(alignment: .leading) {
            Text(draft.name.isEmpty ? (draft.email.isEmpty ? "Contact" : draft.email) : draft.name)
            Text("From your contacts").font(AglynFont.caption).foregroundStyle(.secondary)
          }
          Spacer()
          Button("Remove", role: .destructive) { draft.record = nil }.buttonStyle(.borderless)
        }
      } else if searchAvailable {
        QuoteLabeledField(label: "Find a contact", text: $search, prompt: "Name, email or phone")
          .autocorrectionDisabled()
          .accessibilityIdentifier("quote-find-contact")
        ForEach(found) { person in
          Button {
            draft.record = person.record
            draft.name = person.name
            draft.company = person.company
            draft.email = person.email
            draft.phone = person.phone
            search = ""
            found = []
          } label: {
            VStack(alignment: .leading) {
              Text(person.name.isEmpty ? (person.email.isEmpty ? "Contact" : person.email) : person.name)
              let more = [person.company, person.email, person.phone].filter { !$0.isEmpty }.joined(separator: " · ")
              if !more.isEmpty { Text(more).font(AglynFont.caption).foregroundStyle(.secondary) }
            }
          }
        }
      }
      TextField("Name", text: $draft.name).accessibilityIdentifier("quote-customer-name")
      TextField("Company", text: $draft.company)
      TextField("Email", text: $draft.email)
        .autocorrectionDisabled()
        #if os(iOS)
          .keyboardType(.emailAddress).textInputAutocapitalization(.never)
        #endif
      TextField("Phone", text: $draft.phone)
        #if os(iOS)
          .keyboardType(.phonePad)
        #endif
    }
  }

  /// Asks the server who matches what was typed, a moment after typing stops (the console's 250 ms).
  private func findCustomers() async {
    let typed = search.trimmingCharacters(in: .whitespaces)
    guard typed.count >= 2, !hostID.isEmpty else {
      if !found.isEmpty { found = [] }
      return
    }
    try? await Task.sleep(nanoseconds: 250_000_000)
    guard !Task.isCancelled else { return }
    guard
      let answer = try? await context.api.request(
        "/api/commerce/quote", method: .post,
        body: .object(["action": .string("search-customers"), "hostId": .string(hostID), "text": .string(typed)]))
    else { return }
    guard !Task.isCancelled else { return }
    searchAvailable = answer["available"]?.boolValue != false
    found = (answer["customers"]?.arrayValue ?? []).compactMap { person in
      guard let kind = person["record"]?["kind"]?.stringValue, let id = person["record"]?["id"]?.stringValue else {
        return nil
      }
      return FoundQuoteCustomer(
        record: QuoteCustomerRecord(id: id, kind: kind), name: person["name"]?.stringValue ?? "",
        company: person["company"]?.stringValue ?? "", email: person["email"]?.stringValue ?? "",
        phone: person["phone"]?.stringValue ?? "")
    }
  }

  // MARK: Items

  @ViewBuilder private func itemsSections(_ priced: [PricedQuoteLine]) -> some View {
    if draft.lines.isEmpty {
      Section("Items") {
        Text("Add products from your catalog, or type an item that is made to order.").foregroundStyle(.secondary)
      }
    }
    ForEach(Array(draft.lines.enumerated()), id: \.element.id) { index, line in
      lineSection(index: index, lineID: line.id, priced: priced[index])
    }
    Section {
      Button("Add product") { draft.lines.append(QuoteLineDraft(kind: .catalog)) }
        .disabled(productList.isEmpty)
        .accessibilityIdentifier("quote-add-product")
      Button("Add custom item") { draft.lines.append(QuoteLineDraft(kind: .custom)) }
        .accessibilityIdentifier("quote-add-custom")
    }
  }

  /// A binding to one line by its id, so an edit never reaches through a moving index.
  private func lineBinding(_ id: UUID) -> Binding<QuoteLineDraft> {
    Binding(
      get: { draft.lines.first { $0.id == id } ?? QuoteLineDraft(kind: .custom) },
      set: { value in
        if let index = draft.lines.firstIndex(where: { $0.id == id }) { draft.lines[index] = value }
      })
  }

  @ViewBuilder private func lineSection(index: Int, lineID: UUID, priced: PricedQuoteLine) -> some View {
    let line = lineBinding(lineID)
    let product = products[line.wrappedValue.productID].map(liftLegacyProduct)
    Section {
      if line.wrappedValue.kind == .catalog {
        Picker("Product", selection: line.productID) {
          Text("Choose a product").tag("")
          ForEach(productList, id: \.id) { entry in Text(entry.product.name ?? entry.id).tag(entry.id) }
        }
        .onChange(of: line.wrappedValue.productID) { _, _ in
          line.wrappedValue.variantID = ""
          line.wrappedValue.modifiers = []
        }
        if let variants = product?.variants, variants.count > 1 {
          Picker(
            "Option",
            selection: Binding(
              get: { line.wrappedValue.variantID.isEmpty ? (variants.first?.id ?? "") : line.wrappedValue.variantID },
              set: { line.wrappedValue.variantID = $0 })
          ) {
            ForEach(variants, id: \.id) { variant in
              let options = variant.options ?? [:]
              let label = options.keys.sorted().compactMap { options[$0] }.joined(separator: " / ")
              Text(label.isEmpty ? "Default" : label).tag(variant.id ?? "")
            }
          }
        }
        ForEach(productModifierGroups(product), id: \.id) { group in
          modifierPicker(group, line: line)
        }
      } else {
        TextField("Item", text: line.name).accessibilityIdentifier("quote-line-name-\(index)")
        TextField("SKU (optional)", text: line.sku).autocorrectionDisabled()
      }
      TextField("Description (optional)", text: line.description, axis: .vertical).lineLimit(1...4)
      QuoteLabeledField(
        label: "Quantity",
        text: Binding(
          get: { line.wrappedValue.quantity },
          set: { line.wrappedValue.quantity = $0.filter(\.isNumber) })
      )
      #if os(iOS)
        .keyboardType(.numberPad)
      #endif
      if line.wrappedValue.kind == .custom {
        QuoteLabeledField(label: "Unit price ($)", text: line.wrappedValue.included ? .constant("") : line.price)
          .disabled(line.wrappedValue.included)
          #if os(iOS)
            .keyboardType(.decimalPad)
          #endif
          .accessibilityIdentifier("quote-line-price-\(index)")
        Toggle("Ships", isOn: line.ships)
      }
      Toggle("Included at no charge", isOn: line.included)
      lineTotal(priced, included: line.wrappedValue.included)
      Button("Remove", role: .destructive) { draft.lines.removeAll { $0.id == lineID } }
        .buttonStyle(.borderless)
    } footer: {
      if case .refused(let error) = priced { Text(error).foregroundStyle(AglynColor.error) }
    }
  }

  @ViewBuilder private func lineTotal(_ priced: PricedQuoteLine, included: Bool) -> some View {
    // The line's charge, trailing, as the console prints it beside the line: "Included", or the amount and "$x each".
    if included {
      HStack {
        Spacer()
        Text("Included").font(AglynFont.strongSubheadline)
      }
    } else if case .ok(let line) = priced {
      let cents = Int(quoteLineCents(quoteTotalsLine(line)))
      HStack {
        Spacer()
        VStack(alignment: .trailing) {
          Text(formatOrderMoney(cents)).font(AglynFont.strongSubheadline).monospacedDigit()
          if line.quantity > 1 {
            Text("\(formatOrderMoney(Int(line.unitAmountCents))) each").font(AglynFont.caption).foregroundStyle(.secondary)
          }
        }
      }
    }
  }

  /// One add-on group: a single choice with None, or several to tick.
  @ViewBuilder private func modifierPicker(_ group: ProductModifierGroup, line: Binding<QuoteLineDraft>) -> some View {
    let label = modifierGroupRequired(group) ? group.name : "\(group.name) (optional)"
    let variantID = line.wrappedValue.variantID.isEmpty ? nil : line.wrappedValue.variantID
    let chosen = line.wrappedValue.modifiers.filter { $0.groupId == group.id }.map(\.optionId)
    if group.max > 1 {
      VStack(alignment: .leading) {
        Text(label).font(AglynFont.caption).foregroundStyle(.secondary)
        ForEach(group.options, id: \.id) { option in
          Toggle(
            quoteModifierOptionLabel(option, variantID: variantID),
            isOn: Binding(
              get: { chosen.contains(option.id) },
              set: { on in
                line.wrappedValue.modifiers.removeAll { $0.groupId == group.id && $0.optionId == option.id }
                if on { line.wrappedValue.modifiers.append(ModifierSelection(groupId: group.id, optionId: option.id)) }
              }))
        }
      }
    } else {
      Picker(
        label,
        selection: Binding(
          get: { chosen.first ?? "" },
          set: { picked in
            line.wrappedValue.modifiers.removeAll { $0.groupId == group.id }
            if !picked.isEmpty {
              line.wrappedValue.modifiers.append(ModifierSelection(groupId: group.id, optionId: picked))
            }
          })
      ) {
        Text("None").tag("")
        ForEach(group.options, id: \.id) { option in
          Text(quoteModifierOptionLabel(option, variantID: variantID)).tag(option.id)
        }
      }
    }
  }

  // MARK: Discount, addresses, text

  @ViewBuilder private var discountSection: some View {
    Section {
      Picker("Discount", selection: $draft.discountKind) {
        Text("None").tag(QuoteDiscountChoice.none)
        Text("Amount off").tag(QuoteDiscountChoice.amount)
        Text("Percent off").tag(QuoteDiscountChoice.percent)
      }
      if draft.discountKind != .none {
        QuoteLabeledField(label: draft.discountKind == .amount ? "Amount ($)" : "Percent (%)", text: $draft.discountValue)
        #if os(iOS)
          .keyboardType(.decimalPad)
        #endif
      }
      QuoteLabeledField(label: "Shipping ($)", text: $draft.shipping)
        #if os(iOS)
          .keyboardType(.decimalPad)
        #endif
    } footer: {
      Text("Leave empty when nothing ships.")
    }
  }

  @ViewBuilder private func addressSection(_ label: String, _ address: Binding<QuoteAddressDraft>, helper: String?)
    -> some View
  {
    Section {
      TextField("Name", text: address.name)
      TextField("Address", text: address.line1)
      TextField("Apartment, suite, unit", text: address.line2)
      TextField("City", text: address.city)
      TextField("State or region", text: address.state)
      TextField("Postal code", text: address.postalCode)
      QuoteLabeledField(
        label: "Country code",
        text: Binding(get: { address.wrappedValue.country }, set: { address.wrappedValue.country = String($0.prefix(2)) }),
        prompt: "US"
      )
      .autocorrectionDisabled()
    } header: {
      Text(label)
    } footer: {
      if let helper { Text(helper) }
    }
  }

  @ViewBuilder private var textSection: some View {
    Section {
      TextField("Notes for the customer", text: $draft.notes, axis: .vertical).lineLimit(2...6)
      TextField("Terms", text: $draft.terms, axis: .vertical).lineLimit(2...6)
      if !proofOnly {
        Toggle(
          "Customers approve the proof before they can pay",
          isOn: Binding(
            get: { requireProofApproval },
            set: {
              approvalSet = true
              draft.requireProofApproval = $0
            }))
      }
      Toggle(
        "Customers sign in to see and approve proofs",
        isOn: Binding(
          get: { requireProofSignIn },
          set: {
            signInSet = true
            draft.requireProofSignIn = $0
          }))
    } footer: {
      Text("For a customer with an account on your site. A customer without one keeps using the private link.")
    }
  }

  // MARK: Totals

  @ViewBuilder private func totalsSection(_ priced: [PricedQuoteLine]) -> some View {
    Section {
      if let order, !edited {
        // A saved quote left as it is shows what its customer's page shows, until a save re-prices it.
        let unpaid = isUnpaidQuote(order)
        let payTax = quotePayTax(order.quote, store: payLinkStoreOf(storeData?["tax"] as? [String: Any]))
        let atPayment = unpaid && payTax.basis.kind == .atPayment
        let cents = { (value: Double?) in Int((value ?? 0).rounded()) }
        QuoteTotalsRows(
          itemsCents: cents(order.totals?.itemsCents), discountCents: cents(order.totals?.discountCents),
          shippingCents: cents(order.totals?.shippingCents), taxCents: cents(order.totals?.taxCents),
          totalCents: cents(order.totals?.totalCents),
          taxLabel: unpaid || payTax.basis.kind != .atPayment ? describeQuoteTax(payTax.basis) : "Tax",
          taxAtPayment: atPayment)
      } else {
        let lines = priced.compactMap { entry -> QuoteTotalsLine? in
          if case .ok(let line) = entry { return quoteTotalsLine(line) }
          return nil
        }
        let basis = quoteTaxBasisFromSettings(
          storeTaxSettingsOf(storeData?["tax"] as? [String: Any]),
          shipToCountry: draft.shipTo.country.trimmingCharacters(in: .whitespaces).uppercased(),
          shipToState: draft.shipTo.state.trimmingCharacters(in: .whitespaces))
        let totals = computeQuoteTotals(
          lines, discount: draft.discount, shippingCents: Double(quoteCentsOf(draft.shipping) ?? 0), tax: basis)
        QuoteTotalsRows(
          itemsCents: Int(totals.itemsCents), discountCents: Int(totals.discountCents),
          shippingCents: Int(totals.shippingCents), taxCents: Int(totals.taxCents), totalCents: Int(totals.totalCents),
          taxLabel: describeQuoteTax(basis), taxAtPayment: totals.taxAtPayment)
      }
    }
  }

  // MARK: Save and delete

  private func save() async throws {
    let key = attemptKey ?? UUID().uuidString
    attemptKey = key
    var body: [String: JSONValue] = [
      "action": .string(quoteID == nil ? "create" : "update"),
      "hostId": .string(hostID),
      "quote": draft.body(requireProofApproval: requireProofApproval, requireProofSignIn: requireProofSignIn),
    ]
    if let quoteID {
      body["quoteId"] = .string(quoteID)
      if let baseUpdatedAtMs { body["baseUpdatedAtMs"] = .number(baseUpdatedAtMs) }
    }
    let answer: JSONValue?
    do {
      answer = try await context.api.request(
        "/api/commerce/quote", method: .post, body: .object(body), idempotencyKey: key)
    } catch let error as ConsoleAPIError {
      throw ConsoleAPIError(status: error.status, message: error.body?["error"]?.stringValue ?? "The quote could not be saved")
    }
    let saved = formatQuoteNumber(number: answer?["number"]?.numberValue, docId: answer?["quoteId"]?.stringValue)
    onDone("\(saved) saved", false)
  }

  private func remove() async {
    guard let quoteID else { return }
    deleting = true
    deleteError = nil
    defer { deleting = false }
    do {
      _ = try await context.api.request(
        "/api/commerce/quote", method: .post,
        body: .object(["action": .string("delete"), "hostId": .string(hostID), "quoteId": .string(quoteID)]))
      onDone("\(title) deleted", true)
      dismiss()
    } catch let error as ConsoleAPIError {
      deleteError = error.body?["error"]?.stringValue ?? "The quote could not be deleted"
    } catch {
      deleteError = "The quote could not be deleted"
    }
  }
}
