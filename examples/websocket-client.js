const ws = new WebSocket("wss://NOME-APP.fly.dev/presence");

ws.addEventListener("message", (event) => {
  try {
    const data = JSON.parse(event.data);

    if (data.type === "presence") {
      console.log("Online:", data.count, data.users);
      // renderOnlineUsers(data.users);
    }
  } catch (error) {
    console.error("Payload presence non valido", error);
  }
});
