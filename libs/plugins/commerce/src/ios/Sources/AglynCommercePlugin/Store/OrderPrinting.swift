// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynHardware
import Foundation

/*
 * WHAT THE ORDER DIALOG PRINTS (AGL-3841): the packing slip and the invoice,
 * each the console's own page (`commerce/order-print` runs the console's two
 * builders over the stored order), and a shipment's label, the carrier's own
 * PDF. All three go to the device's print sheet, as the console's go to the
 * browser's print dialog.
 */

/// A page the order dialog prints.
enum OrderPrintKind: String, CaseIterable, Identifiable {
  case packingSlip = "packing-slip"
  case invoice

  var id: String { rawValue }

  var title: String {
    switch self {
    case .packingSlip: "Packing slip"
    case .invoice: "Invoice"
    }
  }

  var systemImage: String {
    switch self {
    case .packingSlip: "shippingbox"
    case .invoice: "doc.text"
    }
  }
}

/// The page and its title, from the console's route.
func orderPrintPage(api: ConsoleAPIClient, hostID: String, orderID: String, kind: OrderPrintKind) async throws -> (
  title: String, html: String
) {
  let answer = try await api.request(
    "/api/commerce/order-print", query: [("hostId", hostID), ("orderId", orderID), ("kind", kind.rawValue)])
  guard let html = answer?["html"]?.stringValue else { throw OrderPrintFailure(message: "The page did not come back. Try again.") }
  return (answer?["title"]?.stringValue ?? kind.title, html)
}

struct OrderPrintFailure: LocalizedError {
  let message: String
  var errorDescription: String? { message }
}

/// Prints the order's packing slip or invoice. Returns what to tell the person, or nil when it printed or they closed
/// the sheet.
@MainActor
func printOrderPage(api: ConsoleAPIClient, hostID: String, orderID: String, kind: OrderPrintKind) async -> String? {
  do {
    let page = try await orderPrintPage(api: api, hostID: hostID, orderID: orderID, kind: kind)
    if case .failed(let message) = await SystemPrinter.printDocument(.html(page.html), jobName: page.title) { return message }
    return nil
  } catch let error as ConsoleAPIError where error.status > 0 {
    return error.message.isEmpty ? "The \(kind.title.lowercased()) could not be made." : error.message
  } catch {
    return "The \(kind.title.lowercased()) could not be loaded. Check the connection and try again."
  }
}

/// Whether bytes are a PDF (`%PDF`).
func isPDF(_ data: Data) -> Bool { data.prefix(4) == Data("%PDF".utf8) }

/// What became of a shipping label sent to the print sheet.
enum LabelPrintOutcome: Equatable {
  case done
  /// The carrier's file is not a PDF: it opens where the console's link opens it, in the browser.
  case openInstead
  case failed(String)
}

/// Prints a shipment's label: the carrier's PDF, fetched from the link the console opens.
@MainActor
func printShippingLabel(_ link: String, number: String, session: URLSession = .shared) async -> LabelPrintOutcome {
  guard let url = URL(string: link), url.scheme == "https" || url.scheme == "http" else { return .failed("This label has no address.") }
  do {
    let (data, response) = try await session.data(from: url)
    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
      return .failed("The carrier did not hand over the label (\(http.statusCode)).")
    }
    guard isPDF(data) else { return .openInstead }
    if case .failed(let message) = await SystemPrinter.printDocument(.pdf(data), jobName: "Shipping label \(number)") {
      return .failed(message)
    }
    return .done
  } catch {
    return .failed("The label could not be downloaded. Check the connection and try again.")
  }
}
