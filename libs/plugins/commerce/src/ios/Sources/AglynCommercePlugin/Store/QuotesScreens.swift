// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import Foundation
import Observation
import SwiftUI

/*
 * Quotes (AGL-4093), as the console's Quotes card on the Orders page has them (host-quotes-card.component.tsx): prices
 * put to a customer before they buy. A quote is an unpaid order on the `quote` channel, so this reads
 * `hosts/{hostId}/orders` for that channel alone; the Orders list never shows one until it is paid. A quote opens
 * read-only here, with the console's "Customers can't pay this quote online yet." notice (AGL-4162). New quote and
 * Edit open the editor (QuoteEditor.swift, AGL-4093); sending a quote stays in the console for now.
 */

public let commerceQuotesScreen = "commerce.quotes"
public let commerceQuoteScreen = "commerce.quote"

/// How many quotes the list reads (the console's `QUOTE_CEILING`); a store past it is told the list stops short.
let quoteCeiling = 500

private func tone(_ color: String) -> AglynTone {
  switch color {
  case "info": .info
  case "warning": .warning
  case "success": .success
  case "error": .error
  default: .neutral
  }
}

/// One quote as its row draws it (the console's `quoteListRow`), under the store's sales tax choice.
struct QuoteListRow: Identifiable, Equatable {
  let id: String
  let number: String
  let line: String
  let customer: String
  let proofOnly: Bool
  let totalCents: Int
  /// Unpaid, with tax still to be added at payment: the pay page's own answer.
  let taxAtPayment: Bool
  let status: QuoteDisplayStatus
  let updatedAtMs: Double

  init(id: String, order: HostOrder, store: PayLinkStore?) {
    self.id = id
    number = formatQuoteNumber(order, docId: id)
    let items = order.lineItems ?? []
    proofOnly = quoteIsProofOnly(order)
    let first = items.first?.name ?? ""
    line = proofOnly ? "Proof only" : items.count > 1 ? "\(first) and more" : first
    let person = order.quote?.customer
    customer = [person?.name, person?.company, person?.email].compactMap { $0 }.first { !$0.isEmpty } ?? ""
    totalCents = Int((order.totals?.totalCents ?? 0).rounded())
    taxAtPayment = isUnpaidQuote(order) && quotePayTax(order.quote, store: store).basis.kind == .atPayment
    status = quoteDisplayStatus(order)
    // The customer's latest answer counts as an update, so a quote they just answered sorts to the top.
    updatedAtMs = max(order.quote?.updatedAtMs ?? 0, latestQuoteResponse(order.quote)?.atMs ?? 0)
  }

  /// What the list's search matches: the number, the first item and the customer.
  func matches(_ text: String) -> Bool {
    let needle = text.trimmingCharacters(in: .whitespaces).lowercased()
    return needle.isEmpty || [number, line, customer].contains { $0.lowercased().contains(needle) }
  }
}

private func storeOf(_ doc: LiveValue<FirestoreDocument?>) -> PayLinkStore? {
  switch doc {
  case .loading: nil
  case .failed: nil
  case .ready(let doc): payLinkStoreOf(doc?.data["tax"] as? [String: Any])
  }
}

/// How many products the editor's picker offers (the console's `PRODUCT_WINDOW`).
let quoteProductWindow = 200

/// The store's products the editor's picker offers, by id, leaving out deleted ones.
func quoteProducts(_ state: LiveValue<[FirestoreDocument]>) -> [(id: String, product: HostProduct)] {
  guard case .ready(let docs) = state else { return [] }
  return docs.prefix(quoteProductWindow).compactMap { doc in
    // The console leaves out a product whose `deletedAt` is set; a stored null is not set.
    let deleted = doc.data["deletedAt"].map { !($0 is NSNull) && ($0 as? Bool) != false } ?? false
    guard !deleted, let product = try? decodeJSONFields(HostProduct.self, doc.jsonFields) else { return nil }
    return (doc.id, product)
  }
}

/// The store settings document's fields, or nil.
func quoteStoreData(_ state: LiveValue<FirestoreDocument?>) -> [String: Any]? {
  if case .ready(let doc?) = state { return doc.data }
  return nil
}

/// The Quotes list: number and first item, customer, total, status and when it last changed, newest first.
struct QuotesScreen: View {
  let context: NativePluginContext
  @State private var quotes = LiveQuery()
  @State private var store = LiveDocument()
  @State private var products = LiveQuery()
  @State private var search = ""
  @State private var creating = false
  @State private var notice: (text: String, tone: AglynTone)?

  private var hostID: String { context.hostID ?? "" }

  var body: some View {
    Group {
      switch quotes.state {
      case .loading:
        List { SkeletonRows(count: 5) }.aglynListBackground()
      case .failed(let message):
        AglynEmptyState("Could not load quotes", systemImage: "exclamationmark.triangle", message: message)
      case .ready(let docs):
        content(docs)
      }
    }
    .safeAreaInset(edge: .top) {
      if let notice { AglynNotice(notice.text, tone: notice.tone) { self.notice = nil }.aglynContentEdges() }
    }
    .navigationTitle("Quotes")
    .aglynScreenTitle("Quotes")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button("New quote") {
          if context.can(quoteEditPermission) {
            creating = true
          } else {
            notice = (context.refusal(quoteEditPermission), .info)
          }
        }
        .accessibilityIdentifier("quotes-new")
      }
    }
    .sheet(isPresented: $creating) {
      QuoteEditorSheet(
        context: context, quoteID: nil, order: nil, productList: quoteProducts(products.state),
        storeData: quoteStoreData(store.state)
      ) { message, _ in notice = (message, .success) }
    }
    .task(id: hostID) {
      guard !hostID.isEmpty else { return }
      quotes.start(
        context.firestore,
        FirestoreQuery(["hosts", hostID, "orders"], equals: [("channel", "quote")], limit: quoteCeiling + 1))
      store.start(context.firestore, ["hosts", hostID, "settings", "store"])
      products.start(context.firestore, FirestoreQuery(["hosts", hostID, "products"], limit: quoteProductWindow + 1))
    }
    .onDisappear {
      quotes.stop()
      store.stop()
      products.stop()
    }
  }

  @ViewBuilder private func content(_ docs: [FirestoreDocument]) -> some View {
    let payStore = storeOf(store.state)
    let rows = docs.prefix(quoteCeiling).map { QuoteListRow(id: $0.id, order: decodeOrder($0), store: payStore) }
      .sorted { $0.updatedAtMs > $1.updatedAtMs }
    if rows.isEmpty {
      AglynEmptyState(
        "No quotes yet", systemImage: "doc.text",
        message: "No quotes yet. A quote prices a customer’s order before they buy: your products, items typed for the job, and anything you include at no charge.")
    } else {
      let shown = rows.filter { $0.matches(search) }
      List {
        Section {
          if shown.isEmpty {
            Text("No quotes match").foregroundStyle(.secondary)
          }
          ForEach(shown) { row in
            Button {
              context.navigate(commerceQuoteScreen, ["quote": row.id])
            } label: {
              QuoteRowView(row: row)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("quote-row-\(row.id)")
          }
        } header: {
          Text("Prices for a customer’s order before they buy")
        } footer: {
          if docs.count > quoteCeiling { Text("This store has more quotes than the list shows at once.") }
        }
      }
      .aglynListBackground()
      .searchable(text: $search, prompt: "Search quotes")
    }
  }
}

private struct QuoteRowView: View {
  let row: QuoteListRow

  var body: some View {
    HStack(alignment: .top, spacing: AglynSpace.two) {
      VStack(alignment: .leading, spacing: 2) {
        Text(row.number).font(AglynFont.body)
        if !row.line.isEmpty { Text(row.line).font(AglynFont.caption).foregroundStyle(.secondary).lineLimit(1) }
        Text(row.customer.isEmpty ? "—" : row.customer).font(AglynFont.caption).foregroundStyle(.secondary).lineLimit(1)
      }
      Spacer(minLength: AglynSpace.one)
      VStack(alignment: .trailing, spacing: 2) {
        Text(row.proofOnly ? "—" : formatOrderMoney(row.totalCents)).font(AglynFont.body).monospacedDigit()
        if row.taxAtPayment { Text("plus tax at payment").font(AglynFont.caption).foregroundStyle(.secondary) }
        StatusChip(row.status.label, tone: tone(quoteStatusColor(row.status.key)))
        Text(row.updatedAtMs > 0 ? Date(timeIntervalSince1970: row.updatedAtMs / 1000).formatted(date: .numeric, time: .omitted) : "—")
          .font(AglynFont.caption)
          .foregroundStyle(.secondary)
      }
    }
    .contentShape(Rectangle())
  }
}

/// One quote, read-only: its customer, items and totals, notes and terms, and what stands between its link and a payment.
struct QuoteScreen: View {
  let context: NativePluginContext
  let quoteID: String
  @State private var quote = LiveDocument()
  @State private var store = LiveDocument()
  @State private var products = LiveQuery()
  /// The quote as it was when Edit was pressed: the editor's starting point and the version its save names.
  @State private var editing: HostOrder?
  @State private var notice: (text: String, tone: AglynTone)?
  @Environment(\.dismiss) private var dismiss
  /// The workspace's card payments, as the quote route answers it: nil until it answers, or when it could not.
  @State private var paymentsState: String?

  private var hostID: String { context.hostID ?? "" }

  var body: some View {
    Group {
      switch quote.state {
      case .loading:
        List { SkeletonRows(count: 6) }.aglynListBackground()
      case .failed(let message):
        AglynEmptyState("Could not load this quote", systemImage: "exclamationmark.triangle", message: message)
      case .ready(nil):
        AglynEmptyState("This quote is not here", systemImage: "doc.text", message: "It may have been deleted.")
      case .ready(let doc?):
        content(decodeOrder(doc))
      }
    }
    .safeAreaInset(edge: .top) {
      if let notice { AglynNotice(notice.text, tone: notice.tone) { self.notice = nil }.aglynContentEdges() }
    }
    .navigationTitle("Quote")
    .aglynScreenTitle("Quote")
    .toolbar {
      // A paid quote is an order now and can no longer be changed.
      if case .ready(let doc?) = quote.state, isUnpaidQuote(decodeOrder(doc)) {
        ToolbarItem(placement: .primaryAction) {
          Button("Edit") {
            if context.can(quoteEditPermission) {
              editing = decodeOrder(doc)
            } else {
              notice = (context.refusal(quoteEditPermission), .info)
            }
          }
          .accessibilityIdentifier("quote-edit")
        }
      }
    }
    .sheet(isPresented: Binding(get: { editing != nil }, set: { if !$0 { editing = nil } })) {
      if let editing {
        QuoteEditorSheet(
          context: context, quoteID: quoteID, order: editing, productList: quoteProducts(products.state),
          storeData: quoteStoreData(store.state)
        ) { message, deleted in
          if deleted { dismiss() } else { notice = (message, .success) }
        }
      }
    }
    .task(id: "\(hostID):\(quoteID)") {
      guard !hostID.isEmpty, !quoteID.isEmpty else { return }
      quote.start(context.firestore, ["hosts", hostID, "orders", quoteID])
      store.start(context.firestore, ["hosts", hostID, "settings", "store"])
      products.start(context.firestore, FirestoreQuery(["hosts", hostID, "products"], limit: quoteProductWindow + 1))
    }
    // Asked again each time the quote shows, so coming back from Payments reads the new answer.
    .task(id: hostID) {
      guard !hostID.isEmpty else { return }
      paymentsState = await quotePaymentsReadiness(api: context.api, hostID: hostID)
    }
    .onDisappear {
      quote.stop()
      store.stop()
      products.stop()
    }
  }

  @ViewBuilder private func content(_ order: HostOrder) -> some View {
    let payStore = storeOf(store.state)
    let unpaid = isUnpaidQuote(order)
    let proofOnly = quoteIsProofOnly(order)
    let payTax = quotePayTax(order.quote, store: payStore)
    let status = quoteDisplayStatus(order)
    let state = paymentsState
    let gaps = unpaid ? payLinkGaps(order, paymentsReady: state.map { $0 == "ready" }, store: payStore) ?? [] : []
    List {
      Section {
        HStack {
          Text(formatQuoteNumber(order, docId: quoteID)).font(AglynFont.title2).accessibilityAddTraits(.isHeader)
          Spacer()
          if proofOnly { StatusChip("Proof only") }
          StatusChip(status.label, tone: tone(quoteStatusColor(status.key)))
        }
      }
      if !gaps.isEmpty {
        Section {
          VStack(alignment: .leading, spacing: AglynSpace.one) {
            // The look of `AglynNotice`'s warning: its icon, then the title.
            Label {
              Text(payLinkNoticeTitle("quote")).font(AglynFont.strongSubheadline)
            } icon: {
              Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(AglynTone.warning.color)
            }
            ForEach(gaps, id: \.rawValue) { gap in
              let line = payLinkGapLine(gap, paymentsReason: state.flatMap(merchantPaymentsBlockedReason), noun: "quote")
              HStack(alignment: .firstTextBaseline) {
                Text(line.text).font(AglynFont.subheadline)
                Spacer(minLength: AglynSpace.one)
                if let action = line.action {
                  Button(action) {
                    context.navigate(gap == .payments ? "commerce.payments" : "commerce.tax", [:])
                  }
                  .buttonStyle(.borderless)
                }
              }
            }
          }
          .padding(.vertical, AglynSpace.half)
          .listRowBackground(AglynTone.warning.color.opacity(0.12))
          .accessibilityIdentifier("quote-pay-link-notice")
        }
      }
      customerSection(order.quote)
      if !proofOnly {
        Section("Items") {
          ForEach(Array((order.lineItems ?? []).enumerated()), id: \.offset) { _, line in
            QuoteLineView(line: line)
          }
        }
        totalsSection(order, payTax: payTax, unpaid: unpaid)
      }
      if let notes = order.quote?.notes?.trimmingCharacters(in: .whitespacesAndNewlines), !notes.isEmpty {
        Section("Notes for the customer") { Text(notes) }
      }
      if let terms = order.quote?.terms?.trimmingCharacters(in: .whitespacesAndNewlines), !terms.isEmpty {
        Section("Terms") { Text(terms) }
      }
    }
    .aglynListBackground()
  }

  @ViewBuilder private func customerSection(_ quote: OrderQuote?) -> some View {
    let person = quote?.customer
    let lines = [person?.name, person?.company, person?.email, person?.phone].compactMap { $0 }.filter { !$0.isEmpty }
    Section("Customer") {
      if lines.isEmpty {
        Text("—").foregroundStyle(.secondary)
      } else {
        ForEach(lines, id: \.self) { Text($0) }
      }
    }
  }

  /// The console's `QuoteTotalsSummary`: items, discount, shipping, the tax line, then the total.
  @ViewBuilder private func totalsSection(_ order: HostOrder, payTax: QuotePayTax, unpaid: Bool) -> some View {
    let totals = order.totals
    let cents = { (value: Double?) in Int((value ?? 0).rounded()) }
    let atPayment = unpaid && payTax.basis.kind == .atPayment
    // Once paid, the tax is what was charged: Stripe's figure under Stripe Tax.
    let taxLabel = unpaid || payTax.basis.kind != .atPayment ? describeQuoteTax(payTax.basis) : "Tax"
    Section {
      AglynAmountRow("Items", amount: formatOrderMoney(cents(totals?.itemsCents)))
      if cents(totals?.discountCents) != 0 {
        AglynAmountRow("Discount", amount: "−\(formatOrderMoney(cents(totals?.discountCents)))")
      }
      if cents(totals?.shippingCents) != 0 {
        AglynAmountRow("Shipping", amount: formatOrderMoney(cents(totals?.shippingCents)))
      }
      if atPayment {
        Text(taxLabel).foregroundStyle(.secondary)
      } else {
        AglynAmountRow(taxLabel, amount: formatOrderMoney(cents(totals?.taxCents)))
      }
      AglynAmountRow(
        atPayment ? "Total before tax" : "Total", amount: formatOrderMoney(cents(totals?.totalCents)), emphasized: true)
    }
  }
}

/// One line: its name and description, quantity and unit price, and its total or "Included".
private struct QuoteLineView: View {
  let line: OrderLineItem

  var body: some View {
    let quantity = Int(line.quantity.rounded())
    let unit = Int(line.unitAmountCents.rounded())
    HStack(alignment: .top) {
      VStack(alignment: .leading, spacing: 2) {
        Text(line.name)
        if let description = line.description, !description.isEmpty {
          Text(description).font(AglynFont.caption).foregroundStyle(.secondary)
        }
        Text("\(quantity) × \(formatOrderMoney(unit))").font(AglynFont.caption).foregroundStyle(.secondary)
      }
      Spacer()
      Text(line.included == true ? "Included" : formatOrderMoney(unit * quantity)).monospacedDigit()
    }
  }
}

/// Whether the workspace can take card payments (ready, not-connected, charges-disabled, mode-unverified or
/// mode-mismatch), from the quote route, which knows the deployment's payment mode (AGL-4162). Nil when it could not
/// answer: like the console's `error`, that shows no notice.
func quotePaymentsReadiness(api: ConsoleAPIClient, hostID: String) async -> String? {
  let answer = try? await api.request(
    "/api/commerce/quote", method: .post,
    body: .object(["hostId": .string(hostID), "action": .string("payments-readiness")]))
  return answer?["state"]?.stringValue
}
