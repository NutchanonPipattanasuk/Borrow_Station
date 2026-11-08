type NfcMessage =
  | { type: "device_ready"; nfc: boolean }
  | { type: "nfc_detected"; uid: string };

export type NfcConnection = {
  close: () => void;
};

export function connectNfcReader(
  url: string,
  onUid: (uid: string) => void,
  onStatus: (status: string) => void,
): NfcConnection {
  const socket = new WebSocket(url);

  socket.onopen = () => onStatus("Connected; checking PN532...");
  socket.onclose = () => onStatus("Disconnected");
  socket.onerror = () => onStatus("Connection failed");
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data) as NfcMessage;
      if (message.type === "device_ready") {
        onStatus(message.nfc ? "PN532 ready" : "PN532 unavailable");
      }
      if (message.type === "nfc_detected" && typeof message.uid === "string") {
        onUid(message.uid.toUpperCase());
      }
    } catch {
      // The ESP32 also sends plain-text PONG messages.
    }
  };

  return {
    close: () => {
      socket.onopen = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      socket.close();
    },
  };
}
