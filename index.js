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
var team = 0;

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
            // TODO: Locate team spawns and store the coordinates to each in a list for each team.
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
    conn.bullets = 7;
    conn.challenge = Math.floor(Math.random() * 1000);
    conn.direction = {x: 0, y: 0};
    conn.id = Uuid.v4();
    conn.last = Date.now();
    conn.name = "Unknown";
    conn.team = "unassigned";
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
                                            conn.direction = msg.direction;

                                            // Test collision
                                            let has_collided = false;
                                            for(let check_x = Math.floor(msg.x); check_x <= Math.floor(msg.x + 0.95); check_x++) {
                                                for(let check_y = -Math.ceil(msg.y); check_y <= -Math.ceil(msg.y - 0.95); check_y++) {
                                                    switch(maps["maps/bigmap.csv"][check_x][check_y]) {
                                                    case 1:
                                                    case 2:
                                                        has_collided = true;
                                                        break;
                                                    case 3:
                                                        let dist = Math.sqrt((Math.pow(check_x - msg.x, 2) + Math.pow(-check_y - msg.y, 2)));
                                                        // Check if close enough to hole to collide
                                                        if (dist <= 0.975) {
                                                            has_collided = true;
                                                        }
                                                        break;
                                                    }
                                                }
                                            }

                                            // TODO: Sanity check the coords to be within
                                            // bounds
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
                            conn.bullets = 7;
                            conn.x = 4;
                            conn.y = -2;
                            if(team >= 0) {
                                conn.team = "red";
                                team--;
                            } else {
                                conn.team = "green";
                                team++;
                            }
                            
                            conn.alive = true;
                            console.log(team);
                        }
                        break;
                    case 5:
                        if(typeof msg.rot === "number") {
                            if(conn.bullets > 0) {
                                conn.bullets--;
                                const id = Uuid.v4();
                                let x = conn.x + Math.cos(msg.rot);
                                let y = conn.y - Math.sin(msg.rot);
                                bullets[id] = {
                                    created: Date.now(),
                                    owner: conn.id,
                                    ricochet: true,
                                    rot: msg.rot,
                                    x,
                                    y
                                };
                            }
                        }
                        break;
                }
            }
        } catch(error) {
            console.error(error);
        }
    });

    conn.on("close", () => {
        switch(conn.team) {
            case "green":
                team--;
                break;
            case "red":
                team++;
                break;
        }
        wss.clients.forEach(client => {
            client.send(JSON.stringify({type: 4, id: conn.id}));
        });
    });
    conn.send(JSON.stringify({type: 2, id: conn.id, map: "maps/bigmap.csv"}));
});

function destroyBullet(id) {
    wss.clients.forEach(client => {
        if(client.id == bullets[id].owner) {
            client.bullets = Math.min(client.bullets + 1, 7);
        }
        client.send(JSON.stringify({type: 6, id}));
    });
    delete bullets[id];
}

function gameTick() {
    let payload = {type: 0, tanks: {}, bullets: {}};
    let start = Date.now();
    wss.clients.forEach(client => {
        if(client.alive) {
            payload.tanks[client.id] = {
                base: client.base,
                cannon: client.cannon,
                name: client.name,
                x: client.x,
                y: client.y,
                direction: client.direction,
                team: client.team
            };
        }
    });
    for(let id in bullets) {
        payload.bullets[id] = {
            rot: bullets[id].rot,
            x: bullets[id].x,
            y: bullets[id].y
        };
    }
    wss.clients.forEach(client => {
        if(client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({challenge: client.challenge, clip: client.bullets, ...payload}));
        }
    });
    for(let id in bullets) {
        if(Date.now() - bullets[id].created > 10000) {
            destroyBullet(id);
        } else {
            for(let other in bullets) {
                if(id != other) {
                    let distance = Math.sqrt(Math.pow(bullets[id].x - bullets[other].x, 2) + Math.pow(bullets[id].y - bullets[other].y, 2));
                    if(distance < 0.3) {
                        destroyBullet(id);
                        destroyBullet(other);
                        break;
                    }
                }
            }
            if(bullets[id]) {
                wss.clients.forEach(tank => {
                    if(tank.alive && bullets[id]) {
                        let distance = Math.sqrt(Math.pow(bullets[id].x - tank.x, 2) + Math.pow(bullets[id].y - tank.y, 2));
                        if(distance < 0.6) {
                            destroyBullet(id);
                            switch(tank.team) {
                                case "green":
                                    team--;
                                    break;
                                case "red":
                                    team++;
                                    break;
                            }
                            
                            wss.clients.forEach(client => {
                                if(client.id == tank.id) {
                                    client.alive = false;
                                }
                                client.send(JSON.stringify({type: 4, id: tank.id}));
                            });
                        }
                    }
                });
                if(bullets[id]) {
                    let check_collision = (x, y) => {
                        for(let check_x = Math.floor(x - 0.01); check_x <= Math.floor(x + 0.01); check_x++) {
                            for(let check_y = -Math.ceil(y + 0.01); check_y <= -Math.ceil(y - 0.01); check_y++) {
                                switch(maps["maps/bigmap.csv"][check_x][check_y]) {
                                    case 1:
                                    case 2:
                                        return true;
                                }
                            }
                        }
                        return false;
                    };

                    let dx = Math.cos(bullets[id].rot);
                    let dy = Math.sin(bullets[id].rot);

                    // TODO: Sanity check on the coordinates
                    // Auto-delete if outside of map

                    let did_reflect = false;
                    if (check_collision(bullets[id].x + 0.5 + (dx * 0.0625), bullets[id].y - 0.5)) {
                        // Flip x
                        bullets[id].rot = Math.PI - bullets[id].rot;
                        dx = -dx;
                        did_reflect = true;
                    }
                    if (check_collision(bullets[id].x + 0.5, bullets[id].y - (dy * 0.0625) - 0.5)) {
                        bullets[id].rot = -bullets[id].rot;
                        dy = -dy;
                        did_reflect = true;
                    }

                    bullets[id].x += dx * 0.0625;
                    bullets[id].y -= dy * 0.0625;

                    if (did_reflect) {
                        if (!bullets[id].ricochet) {
                            destroyBullet(id);
                        } else {
                            bullets[id].ricochet = false;
                        }
                    }
                }
            }
        }
    }
    setTimeout(gameTick, 17 - (Date.now() - start));
}

setTimeout(gameTick, 0);

setInterval(() => {
    let now = Date.now();
    wss.clients.forEach(client => {
        if(client.readyState === WebSocket.OPEN) {
            if(now - client.last > 2000) {
                switch(client.team) {
                    case "green":
                        team--;
                        break;
                    case "red":
                        team++;
                        break;
                }
                
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
