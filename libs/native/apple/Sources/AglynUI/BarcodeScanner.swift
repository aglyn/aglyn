// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

#if os(iOS)
  import VisionKit
#endif

/// The camera reading barcodes and QR codes (VisionKit's live scanner),
/// reporting each new code once. iPhone and iPad only; `isAvailable` is false
/// on a Mac, in the Simulator, or without camera access, and a screen offers
/// a typed code (or a USB scanner, which types) instead.
public struct AglynBarcodeScanner: View {
  let onCode: (String) -> Void

  public init(onCode: @escaping (String) -> Void) {
    self.onCode = onCode
  }

  @MainActor
  public static var isAvailable: Bool {
    #if os(iOS)
      DataScannerViewController.isSupported && DataScannerViewController.isAvailable
    #else
      false
    #endif
  }

  public var body: some View {
    #if os(iOS)
      ScannerView(onCode: onCode)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityLabel("Camera scanner")
    #else
      EmptyView()
    #endif
  }
}

#if os(iOS)
  private struct ScannerView: UIViewControllerRepresentable {
    let onCode: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
      let scanner = DataScannerViewController(
        recognizedDataTypes: [.barcode()], qualityLevel: .balanced, recognizesMultipleItems: false,
        isHighFrameRateTrackingEnabled: false, isHighlightingEnabled: true)
      scanner.delegate = context.coordinator
      try? scanner.startScanning()
      return scanner
    }

    func updateUIViewController(_ controller: DataScannerViewController, context: Context) {
      context.coordinator.onCode = onCode
    }

    static func dismantleUIViewController(_ controller: DataScannerViewController, coordinator: Coordinator) {
      controller.stopScanning()
    }

    func makeCoordinator() -> Coordinator { Coordinator(onCode: onCode) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
      var onCode: (String) -> Void
      private var last: String?

      init(onCode: @escaping (String) -> Void) { self.onCode = onCode }

      func dataScanner(
        _ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]
      ) {
        for item in addedItems {
          guard case .barcode(let barcode) = item, let code = barcode.payloadStringValue, code != last else { continue }
          last = code
          UINotificationFeedbackGenerator().notificationOccurred(.success)
          onCode(code)
        }
      }
    }
  }
#endif
