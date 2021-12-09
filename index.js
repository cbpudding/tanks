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
Type 3 - Spawn tank
Type 4 - Destroy tank
*/
wss.on("connection", conn => {
    conn.alive = false;
    conn.base = 0;
    conn.challenge = Math.floor(Math.random() * 1000);
    conn.id = Uuid.v4();
    conn.last = Date.now();
    conn.name = "Unknown";
    conn.x = 0;
    conn.y = 0;

    conn.on("message", data => {
        try {
            let msg = JSON.parse(data);
            if(typeof msg.type === "number") {
                switch(msg.type) {
                    case 1:
                        if(msg.challenge === conn.challenge) {
                            conn.challenge = Math.floor(Math.random() * 1000);
                            conn.last = Date.now();
                            if(typeof msg.x === "number") {
                                if(typeof msg.y === "number") {
                                    if(typeof msg.base === "number") {
                                        if(typeof msg.cannon === "number") {
                                            conn.base = msg.base;
                                            conn.cannon = msg.cannon;
                                            conn.x = msg.x;
                                            conn.y = msg.y;
                                        }
                                    }
                                }
                            }
                        }
                        break;
                    case 3:
                        if(typeof msg.name === "string") {
                            conn.name = msg.name;
                            conn.alive = true;
                        }
                        break;
                }
            }
        } catch(error) {
            console.error(error);
        }
    });

    conn.on("close", () => {
        wss.clients.forEach(client => {
            client.send(JSON.stringify({type: 4, id: conn.id}));
        });
    });
    conn.send(JSON.stringify({type: 2, id: conn.id, map: "maps/bigmap.csv"}));
});

function gameTick() {
    let payload = {type: 0, tanks: {}};
    let start = Date.now();
    wss.clients.forEach(client => {
        if(client.alive) {
            payload.tanks[client.id] = {
                base: client.base,
                cannon: client.cannon,
                name: client.name,
                x: client.x,
                y: client.y
            };
        }
    });
    wss.clients.forEach(client => {
        if(client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({challenge: client.challenge, ...payload}));
        }
    });
    setTimeout(gameTick, 17 - (Date.now() - start));
}

setTimeout(gameTick, 0);

setInterval(() => {
    let now = Date.now();
    wss.clients.forEach(client => {
        if(client.readyState === WebSocket.OPEN) {
            if(now - client.last > 2000) {
                wss.clients.forEach(player => {
                    if(player.readyState === WebSocket.OPEN) {
                        player.send(JSON.stringify({type: 4, id: client.id}));
                    }
                });
                client.terminate();
            }
        }
    });
}, 1000);