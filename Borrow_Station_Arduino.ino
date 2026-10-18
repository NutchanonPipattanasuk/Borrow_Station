
#include <WiFi.h>
#include <WebSocketsServer.h>

const char* WIFI_SSID = "Chordaetendineae";
const char* WIFI_PASSWORD = "44444444";

WebSocketsServer ws(81);

void onWebSocketEvent(
  uint8_t client,
  WStype_t type,
  uint8_t* payload,
  size_t length
) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("Laptop connected");
      ws.sendTXT(client, "{\"type\":\"device_ready\"}");
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

void setup() {
  Serial.begin(115200);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to WiFi");

  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(500);
  }

  Serial.println();
  Serial.print("ESP32 IP: ");
  Serial.println(WiFi.localIP());

  ws.begin();
  ws.onEvent(onWebSocketEvent);

  Serial.println("WebSocket ready on port 81");
}

void loop() {
  ws.loop();
}
