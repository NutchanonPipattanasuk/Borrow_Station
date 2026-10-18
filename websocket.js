
const ws = new WebSocket("ws://172.20.10.4:81");

ws.onopen = () => {
  console.log("Connected to ESP32");
  ws.send("PING");
};

ws.onmessage = (event) => {
  try {
    const data = JSON.parse(event.data);

    if (data.type === "nfc_detected") {
      console.log("NFC UID:", data.uid);
    } else {
      console.log("ESP32:", data);
    }
  } catch {
    console.log("ESP32:", event.data);
  }
};

ws.onerror = () => {
  console.log("WebSocket connection error");
};
