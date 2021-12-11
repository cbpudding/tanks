const Express = require("express");
const Filesystem = require("fs");
const Uuid = require("uuid");
const WebSocket = require("ws");

const app = Express();

app.get("/", (_req, res) => {
    res.sendFile(__dirname + "/public/index.htm");
});

app.use(Express.static(__dirname + "/public"));

const bullets = {};

// Load in the maps for server-side collision checks
let available_maps = ["maps/bigmap.csv"];
let maps = {};

for (let map of available_maps) {
    maps[map] = [];
    let read_map = Filesystem.readFileSync("public/" + map, {encoding:'utf8', flag:'r'})
        .trim()
        .split(/\r?\n/)
        .map(x => x.split(","));
    // Map borders
    maps[map].push(Array(read_map[0].length + 2).fill(2));
    for (let row of read_map) {
        let temp = [2];
        for (let tile of row) {
            let id = parseInt(tile, 10) || 0;
            if (id < 0) {
                id = 0
            }
            temp.push(id);
        }
        let padding = (read_map[0].length + 2) - temp.length;
        temp = temp.concat(Array(padding).fill(2));
        maps[map].push(temp);
    }
    maps[map].push(Array(read_map[0].length + 2).fill(2));
}

console.log("Loaded maps: " + Object.keys(maps).join(", "));

const wss = new WebSocket.Server({server: app.listen(3000)});

/* Message types:
Type 0 - Server tick
Type 1 - Client update
Type 2 - Server identification
Type 3 - Spawn tank
Type 4 - Destroy tank
Type 5 - Shoot bullet
Type 6 - Destroy bullet
*/
wss.on("connection", conn => {
    conn.alive = false;
    conn.base = 0;
    conn.challenge = Math.floor(Math.random() * 1000);
    conn.id = Uuid.v4();
    conn.last = Date.now();
    conn.name = "Unknown";
    conn.x = 4;
    conn.y = -2;
    conn.direction = {x: 0, y: 0};

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
                                            conn.direction = msg.direction;

                                            // Test collision
                                            let has_collided = false;
                                            for(let check_x = Math.floor(msg.x); check_x <= Math.floor(msg.x + 0.95); check_x++) {
                                                for(let check_y = -Math.ceil(msg.y); check_y <= -Math.ceil(msg.y - 0.95); check_y++) {
                                                    switch(maps["maps/bigmap.csv"][check_x][check_y]) {
                                                    case 1:
                                                    case 2:
                                                    case 3:
                                                        has_collided = true;
                                                    }
                                                }
                                            }

                                            if (!has_collided) {
                                                if(Math.abs(conn.x - msg.x) <= 3 && Math.abs(conn.y - msg.y) <= 3) {
                                                    conn.x = msg.x;
                                                    conn.y = msg.y;
                                                }
                                            }
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
                    case 5:
                        if(typeof msg.rot === "number") {
                            const id = Uuid.v4();
                            let x = conn.x + Math.cos(msg.rot);
                            let y = conn.y - Math.sin(msg.rot);
                            bullets[id] = {
                                owner: conn.id,
                                rot: msg.rot,
                                x,
                                y
                            };
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
    let payload = {type: 0, tanks: {}, bullets};
    let start = Date.now();
    wss.clients.forEach(client => {
        if(client.alive) {
            payload.tanks[client.id] = {
                base: client.base,
                cannon: client.cannon,
                name: client.name,
                x: client.x,
                y: client.y,
                direction: client.direction
            };
        }
    });
    wss.clients.forEach(client => {
        if(client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({challenge: client.challenge, ...payload}));
        }
    });
    // TODO: Update bullets
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
