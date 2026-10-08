// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// Finds a product by its barcode or SKU: the camera on iPhone and iPad, a
/// typed code (or a USB scanner, which types) everywhere. A match opens the
/// product; the lookup is the register's (barcodes, then SKUs), at any status.
struct ScanScreen: View {
  let context: NativePluginContext
  @State private var code = ""
  @State private var looking = false
  @State private var problem: String?
  @State private var found: ProductRow?
  @FocusState private var focused: Bool

  var body: some View {
    Form {
      if AglynBarcodeScanner.isAvailable {
        Section {
          AglynBarcodeScanner { scanned in Task { await lookUp(scanned) } }
            .frame(height: 280)
            .listRowInsets(EdgeInsets())
        } footer: {
          Text("Point the camera at a barcode.")
        }
      }
      Section {
        HStack {
          TextField("Barcode or SKU", text: $code)
            .focused($focused)
            .onSubmit { Task { await lookUp(code) } }
            .autocorrectionDisabled()
            #if os(iOS)
              .textInputAutocapitalization(.never)
            #endif
            .accessibilityIdentifier("scan-code")
          Button("Find") { Task { await lookUp(code) } }
            .disabled(code.trimmingCharacters(in: .whitespaces).isEmpty || looking)
        }
      } footer: {
        Text(AglynBarcodeScanner.isAvailable ? "Or type the code." : "Type the code, or scan it with a USB scanner.")
      }
      if looking {
        Section { ProgressView("Looking it up") }
      }
      if let problem {
        Section { AglynNotice(problem, tone: .warning) }
      }
      if let found {
        Section("Found") {
          Button {
            context.navigate(commerceProductScreen, ["productId": found.id])
          } label: {
            ProductListRow(row: found)
          }
          .buttonStyle(.plain)
          .accessibilityIdentifier("scan-found")
        }
      }
    }
    .formStyle(.grouped)
    .aglynListBackground()
    .navigationTitle("Scan")
    .onAppear { if !AglynBarcodeScanner.isAvailable { focused = true } }
  }

  private func lookUp(_ raw: String) async {
    guard let hostID = context.hostID, let normalized = scannedProductCode(raw) else {
      problem = "That is not a code a product carries."
      return
    }
    looking = true
    problem = nil
    found = nil
    defer { looking = false }
    for field in ["barcodes", "skus"] {
      if let doc = await first(productCodeQuery(hostID, field: field, code: normalized)) {
        found = ProductRow(doc)
        code = ""
        return
      }
    }
    problem = "No product on this site has the code \(raw.trimmingCharacters(in: .whitespaces))."
  }

  /// The first document a query answers with, read once.
  private func first(_ query: FirestoreQuery) async -> FirestoreDocument? {
    await withCheckedContinuation { continuation in
      var listener: FirestoreListening?
      var answered = false
      listener = context.firestore.listen(query) { result in
        guard !answered else { return }
        answered = true
        listener?.remove()
        continuation.resume(returning: (try? result.get())?.first)
      }
      if answered { listener?.remove() }
    }
  }
}
