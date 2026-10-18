
#include <WiFi.h>
#include <WebSocketsServer.h>

#define NFC_INTERFACE_HSU
#include <PN532_HSU.h>
#include <PN532.h>

// Wi-Fi
const char* WIFI_SSID = "Chordaetendineae";
const char* WIFI_PASSWORD = "44444444";

// PN532 UART pins
constexpr int NFC_RX = 17;
constexpr int NFC_TX = 18;

// WebSocket Server
WebSocketsServer ws(81);

// PN532 Hardware UART
PN532_HSU pn532hsu(Serial1, NFC_RX, NFC_TX);
PN532 nfc(pn532hsu);

bool nfcReady = false;

// Prevent rapid duplicate messages
String lastUID = "";
unsigned long lastSentTime = 0;
const unsigned long SCAN_COOLDOWN_MS = 2000;

// Convert UID bytes to hexadecimal text
String uidToString(uint8_t* uid, uint8_t length) {
  String result = "";

  for (uint8_t i = 0; i < length; i++) {
    if (uid[i] < 0x10) result += "0";
    result += String(uid[i], HEX);
  }

  result.toUpperCase();
  return result;
}

// WebSocket events
void onWebSocketEvent(
  uint8_t client,
  WStype_t type,
  uint8_t* payload,
  size_t length
) {
  switch (type) {

    case WStype_CONNECTED:
      Serial.println("Laptop connected");

      ws.sendTXT(
        client,
        nfcReady
          ? "{\"type\":\"device_ready\",\"nfc\":true}"
          : "{\"type\":\"device_ready\",\"nfc\":false}"
      );
      break;

    case WStype_DISCONNECTED:
      Serial.println("Laptop disconnected");
      break;

    case WStype_TEXT:
      if (length == 4 &&
          memcmp(payload, "PING", 4) == 0) {
        ws.sendTXT(client, "PONG");
      }
      break;

    default:
      break;
  }
}

// Initialize NFC reader
void setupNFC() {
  nfc.begin();

  uint32_t version = nfc.getFirmwareVersion();

  if (!version) {
    Serial.println("PN532 not found");
    return;
  }

  if (!nfc.SAMConfig()) {
    Serial.println("PN532 configuration failed");
    return;
  }

  nfcReady = true;
  Serial.println("PN532 ready");
}

// Read NFC and send UID
void scanNFC() {
  if (!nfcReady) return;

  uint8_t uid[7];
  uint8_t uidLength = 0;

  bool found = nfc.readPassiveTargetID(
    PN532_MIFARE_ISO14443A,
    uid,
    &uidLength,
    150
  );

  if (!found || uidLength == 0) return;

  String uidText = uidToString(uid, uidLength);

  unsigned long now = millis();

  if (uidText == lastUID &&
      now - lastSentTime < SCAN_COOLDOWN_MS) {
    return;
  }

  lastUID = uidText;
  lastSentTime = now;

  String message =
    "{\"type\":\"nfc_detected\",\"uid\":\""
    + uidText + "\"}";

  ws.broadcastTXT(message);

  Serial.print("NFC UID: ");
  Serial.println(uidText);
}

void setup() {
  Serial.begin(115200);
  delay(500);

  // Connect Wi-Fi
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.print("ESP32 IP: ");
  Serial.println(WiFi.localIP());

  // Start NFC
  setupNFC();

  // Start WebSocket
  ws.begin();
  ws.onEvent(onWebSocketEvent);

  Serial.println("WebSocket Server ready");
}

void loop() {
  ws.loop();

  // Poll NFC reader
  scanNFC();

  delay(10);
}
