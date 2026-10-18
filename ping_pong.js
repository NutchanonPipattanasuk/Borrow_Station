
const ws = new WebSocket("ws://172.20.10.4:81");

ws.onopen = () => {
  console.log("Connected");
  ws.send("PING");
};

ws.onmessage = (event) => {
  console.log("Received:", event.data);
};

ws.onerror = () => {
  console.log("WebSocket error");
};
