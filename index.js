const Express = require("express");
const Uuid = require("uuid");
const WebSocket = require("ws");

const app = Express();

app.get("/", (req, res) => {
    res.sendFile(__dirname + "/public/index.htm");
});

app.use(Express.static(__dirname + "/public"));

const wss = new WebSocket.Server({server: app.listen(3000)});

/* Message types:
Type 0 - Server tick
Type 1 - Client update
Type 2 - Server identification
*/
wss.on("connection", conn => {
    conn.challenge = Math.floor(Math.random() * 1000);
    conn.id = Uuid.v4();
    conn.last = Date.now();
    conn.on("message", data => {
        try {
            let msg = JSON.parse(data);
            if(typeof msg.type === "number") {
                switch(msg.type) {
                    case 1:
                        if(msg.challenge === conn.challenge) {
                            conn.last = Date.now();
                            // ...
                        }
                        break;
                }
            }
        } catch(error) {
            console.error(error);
        }
    });
    conn.send(JSON.stringify({type: 2, id: conn.id, map: "maps/bigmap.csv"}));
});

setInterval(() => {
    let now = Date.now();
    wss.clients.forEach(client => {
        if(client.readyState === WebSocket.OPEN) {
            if(now - client.last > 2000) {
                client.terminate();
            } else {
                let challenge = Math.floor(Math.random() * 1000);
                client.challenge = challenge;
                client.send(JSON.stringify({type: 0, challenge}));
            }
        }
    });
}, 1000);