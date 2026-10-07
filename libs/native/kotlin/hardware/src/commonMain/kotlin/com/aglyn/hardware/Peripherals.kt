package com.aglyn.hardware

/** How a direct printer is reached. */
enum class PrinterTransport { NETWORK, USB, SERIAL }

/** A receipt printer the register sends ESC/POS bytes to. */
interface ReceiptPrinter {
  val name: String
  val transport: PrinterTransport

  /** Sends one job; throws [PrinterUnavailable] with words a cashier can act on. */
  suspend fun print(bytes: ByteArray)
}

class PrinterUnavailable(message: String) : Exception(message)

/**
 * A USB printer. The JVM has no portable USB stack (desktop needs libusb or a
 * vendor driver; Android needs `UsbManager` permission per device), so this is
 * a declared seam: until a platform binds one, it refuses with words, and a
 * USB printer installed as an OS printer is reached through the system print
 * queue instead.
 */
class UsbReceiptPrinter(override val name: String, val vendorId: Int, val productId: Int) : ReceiptPrinter {
  override val transport = PrinterTransport.USB

  override suspend fun print(bytes: ByteArray) {
    throw PrinterUnavailable("$name is a USB printer, which this register cannot print to directly yet. Connect it to the network or use a cloud printer.")
  }
}

/**
 * A serial (RS-232, or USB-serial) printer. Like [UsbReceiptPrinter], a seam
 * until a platform binds a serial port library; it refuses with words.
 */
class SerialReceiptPrinter(override val name: String, val port: String, val baudRate: Int = 9600) : ReceiptPrinter {
  override val transport = PrinterTransport.SERIAL

  override suspend fun print(bytes: ByteArray) {
    throw PrinterUnavailable("$name is a serial printer, which this register cannot print to directly yet. Connect it to the network or use a cloud printer.")
  }
}

/**
 * The peripherals a register has. A platform entry point binds the real
 * ones; a plugin reads them through its context and never names a platform.
 */
interface Peripherals {
  val printers: List<ReceiptPrinter>

  /** This device's own card reader (Tap to Pay or Bluetooth); null where there is none. */
  val cardCollector: CardCollector? get() = null

  /** A keyboard-wedge (HID) barcode scanner's input, where the device has a keyboard. */
  val hidScanner: HidBurstDetector? get() = null
}

object NoPeripherals : Peripherals {
  override val printers: List<ReceiptPrinter> = emptyList()
}

/** A fixed set, as an entry point builds it. */
class StaticPeripherals(
  override val printers: List<ReceiptPrinter> = emptyList(),
  override val cardCollector: CardCollector? = null,
  override val hidScanner: HidBurstDetector? = null,
) : Peripherals
