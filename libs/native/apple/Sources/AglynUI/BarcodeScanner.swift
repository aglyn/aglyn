// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

#if os(iOS)
  import AVFoundation
  import VisionKit
#endif

/// The camera reading barcodes and QR codes (VisionKit's live scanner).
/// iPhone and iPad only; `isAvailable` is false on a Mac, in the Simulator, or
/// without camera access, and a screen offers a typed code (or a USB scanner,
/// which types) instead.
///
/// By default each new code is reported once. With `accept`, every code that
/// comes into view is handed to it and reported when it answers a code (a
/// `CameraScanFilter`, so a second of the same item can be scanned).
public struct AglynBarcodeScanner: View {
  let accept: (@MainActor (String) -> String?)?
  let onCode: (String) -> Void

  public init(onCode: @escaping (String) -> Void) {
    accept = nil
    self.onCode = onCode
  }

  public init(accept: @escaping @MainActor (String) -> String?, onCode: @escaping (String) -> Void) {
    self.accept = accept
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

  /// This device has a camera that can read barcodes, whether or not the
  /// person has allowed it yet: where a screen shows its camera button (as
  /// Android's register shows it wherever the app carries a camera scanner).
  @MainActor
  public static var isSupported: Bool {
    #if os(iOS)
      DataScannerViewController.isSupported
    #else
      false
    #endif
  }

  public var body: some View {
    #if os(iOS)
      ScannerView(accept: accept, onCode: onCode)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityLabel("Camera scanner")
    #else
      EmptyView()
    #endif
  }
}

/// Scans barcodes with the camera into `onCode`, one after another, until the
/// cashier is done (Android's `BarcodeScanSheet`, same words). `accept` filters
/// the camera's repeated reads (a `CameraScanFilter`); each accepted code buzzes,
/// and `status` is the line the caller shows for the last one ("Added Cold
/// brew", "No product has the code …"). Asks for the camera when it opens.
public struct AglynBarcodeScanSheet: View {
  let title: String
  let status: String?
  let accept: @MainActor (String) -> String?
  let onCode: (String) -> Void
  let onDone: () -> Void
  @State private var torch = false
  @State private var access = AglynCameraAccess.current

  public init(
    title: String = "Scan barcodes", status: String?, accept: @escaping @MainActor (String) -> String? = { $0 },
    onCode: @escaping (String) -> Void, onDone: @escaping () -> Void
  ) {
    self.title = title
    self.status = status
    self.accept = accept
    self.onCode = onCode
    self.onDone = onDone
  }

  public var body: some View {
    NavigationStack {
      VStack(spacing: AglynSpace.two) {
        ZStack {
          Color.black
          if access == .granted {
            AglynBarcodeScanner(accept: accept, onCode: onCode)
              .onChange(of: torch, initial: true) { _, on in AglynCameraAccess.setTorch(on) }
          } else {
            permission
          }
          if access == .granted {
            // The aiming frame: where the barcode reads best.
            GeometryReader { box in
              RoundedRectangle(cornerRadius: AglynTokens.radius, style: .continuous)
                .stroke(Color.white.opacity(0.85), lineWidth: 2)
                .frame(width: box.size.width * 0.72, height: box.size.width * 0.72 / 2.4)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .allowsHitTesting(false)
          }
        }
        .aspectRatio(4 / 3, contentMode: .fit)
        .frame(maxWidth: 560)
        .clipShape(RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous))
        .accessibilityIdentifier("camera-viewfinder")
        Text(status ?? "Point the camera at a barcode. Scanned items are added one after another.")
          .font(status == nil ? AglynFont.body : AglynFont.headline)
          .foregroundStyle(status == nil ? AnyShapeStyle(.secondary) : AnyShapeStyle(AglynColor.tint))
          .multilineTextAlignment(.center)
          .frame(maxWidth: .infinity)
          .accessibilityIdentifier("barcode-scan-last")
          .accessibilityAddTraits(.updatesFrequently)
        Spacer(minLength: 0)
      }
      .padding(AglynSpace.three)
      .navigationTitle(title)
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Toggle(isOn: $torch) {
            Label(torch ? "Turn the light off" : "Turn the light on", systemImage: torch ? "flashlight.on.fill" : "flashlight.off.fill")
          }
          .toggleStyle(.button)
          .disabled(access != .granted)
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Done", action: onDone).accessibilityIdentifier("barcode-scan-done")
        }
      }
    }
    .accessibilityIdentifier("barcode-scan-sheet")
    .task {
      if access == .undecided { access = await AglynCameraAccess.ask() }
    }
    .onDisappear { AglynCameraAccess.setTorch(false) }
  }

  /// Before the camera is allowed: why it is asked for, and the way to allow it.
  private var permission: some View {
    VStack(spacing: AglynSpace.two) {
      Text(access == .refused ? "Allow the camera in Settings to scan barcodes." : "Aglyn POS uses the camera to read barcodes.")
        .foregroundStyle(Color.white)
        .multilineTextAlignment(.center)
      Button("Allow camera") {
        Task {
          if access == .refused { AglynCameraAccess.openSettings() } else { access = await AglynCameraAccess.ask() }
        }
      }
      .buttonStyle(.aglynProminent)
      .accessibilityIdentifier("camera-allow")
    }
    .padding(AglynSpace.three)
    .accessibilityIdentifier("camera-permission")
  }
}

/// The camera permission, as the scan sheet needs it.
enum AglynCameraAccess: Equatable {
  case undecided, granted, refused

  @MainActor static var current: AglynCameraAccess {
    #if os(iOS)
      switch AVCaptureDevice.authorizationStatus(for: .video) {
      case .authorized: .granted
      case .notDetermined: .undecided
      default: .refused
      }
    #else
      .refused
    #endif
  }

  @MainActor static func ask() async -> AglynCameraAccess {
    #if os(iOS)
      return await AVCaptureDevice.requestAccess(for: .video) ? .granted : .refused
    #else
      return .refused
    #endif
  }

  /// Once refused, iOS asks no more: the person turns the camera on in Settings.
  @MainActor static func openSettings() {
    #if os(iOS)
      if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
    #endif
  }

  /// The light, on the camera the scanner reads with.
  @MainActor static func setTorch(_ on: Bool) {
    #if os(iOS)
      guard let device = AVCaptureDevice.default(for: .video), device.hasTorch, (try? device.lockForConfiguration()) != nil
      else { return }
      device.torchMode = on ? .on : .off
      device.unlockForConfiguration()
    #endif
  }
}

#if os(iOS)
  private struct ScannerView: UIViewControllerRepresentable {
    let accept: (@MainActor (String) -> String?)?
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
      context.coordinator.accept = accept
      context.coordinator.onCode = onCode
    }

    static func dismantleUIViewController(_ controller: DataScannerViewController, coordinator: Coordinator) {
      controller.stopScanning()
    }

    func makeCoordinator() -> Coordinator { Coordinator(accept: accept, onCode: onCode) }

    @MainActor
    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
      var accept: (@MainActor (String) -> String?)?
      var onCode: (String) -> Void
      private var last: String?

      init(accept: (@MainActor (String) -> String?)?, onCode: @escaping (String) -> Void) {
        self.accept = accept
        self.onCode = onCode
      }

      func dataScanner(
        _ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]
      ) {
        read(addedItems)
      }

      // The same barcode still in view is read again here: with a filter, it counts once until it has left the view.
      func dataScanner(
        _ dataScanner: DataScannerViewController, didUpdate updatedItems: [RecognizedItem], allItems: [RecognizedItem]
      ) {
        if accept != nil { read(updatedItems) }
      }

      private func read(_ items: [RecognizedItem]) {
        for item in items {
          guard case .barcode(let barcode) = item, let raw = barcode.payloadStringValue else { continue }
          let code: String
          if let accept {
            guard let accepted = accept(raw) else { continue }
            code = accepted
          } else {
            guard raw != last else { continue }
            last = raw
            code = raw
          }
          UINotificationFeedbackGenerator().notificationOccurred(.success)
          onCode(code)
        }
      }
    }
  }
#endif
