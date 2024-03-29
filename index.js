const Express = require("express");
const Filesystem = require("fs");
const Https = require("https");
const Uuid = require("uuid");
const WebSocket = require("ws");

const app = Express();

app.get("/", (_req, res) => {
    res.sendFile(__dirname + "/public/index.htm");
});

app.use(Express.static(__dirname + "/public"));

const bullets = {};
const mines = {};

// Read the configuration file
let config = JSON.parse(Filesystem.readFileSync("tanks.json"));

// Load in the maps for server-side collision checks
let available_maps = config.maps.map(name => "maps/" + name + ".csv");
let current_map = Math.floor(Math.random() * available_maps.length) % available_maps.length;
let maps = {};
var team = 0;
var scores = {red: 0o0, green: 0o0}; // 0o0 what's this? - Nick
let spawns = {};
let presents = [];
let roundPlaying = true;
let roundStart = Date.now();

for (let map of available_maps) {
    maps[map] = [];
    let read_map = Filesystem.readFileSync("public/" + map, {encoding:'utf8', flag:'r'})
        .trim()
        .split(/\r?\n/)
        .map(x => x.split(","));
    // Map borders
    maps[map].push(Array(read_map[0].length + 2).fill(2));

    let tmp_spawns = {
        red: [],
        redInc: 0,
        green: [],
        greenInc: 0
    };

    for (let row in read_map) {
        let temp = [2];
        for (let tile in read_map[row]) {
            let id = parseInt(read_map[row][tile], 10) || 0;
            id &= ~((1 << 29) | (1 << 30)); // Ignore rotation bits from tiled
            if (id < 0) {
                id = 0;
            }
            if (id == 4) {
                // Red spawn
                tmp_spawns.red.push({x: parseInt(tile) + 1, y: parseInt(row) + 1});
            } else if (id == 5) {
                // Green spawn
                tmp_spawns.green.push({x: parseInt(tile) + 1, y: parseInt(row) + 1});
            } else if (id == 1) {
                presents.push({x: parseInt(tile) + 1, y: parseInt(row) + 1, destroyed: false, destroyed_time: Date.now()});
            }
            temp.push(id);
        }
        let padding = (read_map[0].length + 2) - temp.length;
        temp = temp.concat(Array(padding).fill(2));
        maps[map].push(temp);
    }
    spawns[map] = tmp_spawns;
    maps[map].push(Array(read_map[0].length + 2).fill(2));
}

console.log("Loaded maps: " + Object.keys(maps).join(", "));

const wss = new WebSocket.Server({server: Https.createServer(
    {
        key: Filesystem.readFileSync("server.key"),
        cert: Filesystem.readFileSync("server.crt"),
    },
    app
).listen(config.port)});

/* Message types:
Type 0 - Server tick
Type 1 - Client update
Type 2 - Server identification
Type 3 - Spawn tank
Type 4 - Destroy tank
Type 5 - Shoot bullet
Type 6 - Destroy bullet
Type 7 - Lay mine
Type 8 - Destroy mine
Type 9 - Destroy present
Type 10 - Bullet ricochet
Type 11 - Shoot response
Type 12 - Victory!
Type 13 - OVERTIME!
Type 14 - Local Tank Correction
*/
wss.on("connection", conn => {
    conn.alive = false;
    conn.base = 0;
    conn.bullets = 7;
    conn.cannon = 0;
    conn.challenge = Math.floor(Math.random() * 1000);
    conn.direction = {x: 0, y: 0};
    conn.id = Uuid.v4();
    conn.killstreak = 0;
    conn.last = Date.now();
    conn.mines = 2;
    conn.name = "Unknown";
    if(team >= 0) {
        conn.team = "red";
        team--;
    } else {
        conn.team = "green";
        team++;
    }
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
                                                    switch(maps[available_maps[current_map]][check_y][check_x]) {
                                                    case 1:
                                                        let still_exists = true;
                                                        for (let i in presents) {
                                                            if (presents[i].x == check_x && presents[i].y == check_y && presents[i].destroyed) {
                                                                still_exists = false;
                                                                break;
                                                            }
                                                        }
                                                        has_collided = has_collided || still_exists;
                                                        break;
                                                    case 2:
                                                        has_collided = true;
                                                        break;
                                                    case 3:
                                                        has_collided = true;
                                                        break;
                                                    case 6:
                                                        if (conn.team == "green") {
                                                            has_collided = true;
                                                        }
                                                        break;
                                                    case 7:
                                                        if (conn.team == "red") {
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
                                                } else {
                                                    conn.send(JSON.stringify({type: 14, x: conn.x, y: conn.y}));
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        break;
                    case 3:
                        if(roundPlaying) {
                            if(typeof msg.name === "string") {
                                if(msg.name.length <= 32) {
                                    conn.name = msg.name;
                                    conn.bullets = 7;
                                    conn.mines = 2;

                                    let current = available_maps[current_map];

                                    if(conn.team == "red") {
                                        let spawnNum = ++spawns[current].redInc % spawns[current].red.length;
                                        conn.x = spawns[current].red[spawnNum].x;
                                        conn.y = -spawns[current].red[spawnNum].y;
                                    } else {
                                        let spawnNum = ++spawns[current].greenInc % spawns[current].green.length;
                                        conn.x = spawns[current].green[spawnNum].x;
                                        conn.y = -spawns[current].green[spawnNum].y;
                                    }
                                    conn.alive = true;

                                    for(let i in presents) {
                                        if (presents[i].destroyed) {
                                            conn.send(JSON.stringify({type: 9, x: presents[i].x, y: presents[i].y, destroyed: true}));
                                        }
                                    }
                                }
                            }
                        } else {
                            conn.send(JSON.stringify({
                                type: 4,
                                id: conn.id,
                                killer: conn.id,
                                method: "disconnect",
                                killstreak: 0
                            }));
                        }
                        break;
                    case 5:
                        if(conn.alive) {
                            if(typeof msg.rot === "number") {
                                let x = conn.x + Math.cos(msg.rot);
                                let y = conn.y - Math.sin(msg.rot);
                                if(conn.bullets > 0) {
                                    conn.bullets--;
                                    const id = Uuid.v4();
                                    bullets[id] = {
                                        created: Date.now(),
                                        owner: conn.id,
                                        ricochet: true,
                                        rot: msg.rot,
                                        team: conn.team,
                                        x,
                                        y
                                    };
                                    wss.clients.forEach(client => {
                                        if(client.readyState === WebSocket.OPEN) {
                                            client.send(JSON.stringify({type: 11, success: true, x, y}));
                                        }
                                    });

                                } else {
                                    wss.clients.forEach(client => {
                                        if(client.readyState === WebSocket.OPEN) {
                                            client.send(JSON.stringify({type: 11, success: false, x, y}));
                                        }
                                    });
                                }
                            }
                        }
                        break;
                    case 7:
                        if(conn.alive) {
                            if(conn.mines > 0) {
                                conn.mines--;
                                const id = Uuid.v4();
                                mines[id] = {
                                    created: Date.now(),
                                    owner: conn.id,
                                    team: conn.team,
                                    ticking: false,
                                    x: conn.x,
                                    y: conn.y
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
            if(client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({type: 4, id: conn.id, killer: conn.id, method: "disconnect", killstreak: 0}));
            }
        });
    });
    conn.send(JSON.stringify({type: 2, id: conn.id, map: available_maps[current_map], roundStart}));
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

function killTank(id, killer, method, kills, team, teamkill) {
    let killstreak = killer == id ? 0 : kills + 1;
    let payload = JSON.stringify({type: 4, id, killer, method, killstreak});
    if(!teamkill) {
        scores[team]++;
    }
    wss.clients.forEach(client => {
        if(client.id == id) {
            client.alive = false;
            client.killstreak = 0;
        } else if(client.id == killer) {
            client.killstreak++;
        }
        client.send(payload);
    });
}

function detonateMine(id) {
    wss.clients.forEach(client => {
        if(client.readyState === WebSocket.OPEN) {
            if(client.id == mines[id].owner) {
                client.mines++;
            }
            client.send(JSON.stringify({type: 8, id}));
            if(client.alive) {
                let distance = Math.sqrt(Math.pow(client.x - mines[id].x, 2) + Math.pow(client.y - mines[id].y, 2));
                if(distance < 1.5) {
                    var team, teamkill;
                    var killstreak = 0;
                    wss.clients.forEach(killer => {
                        if(killer.id == mines[id].owner) {
                            killstreak = killer.killstreak;
                            team = killer.team;
                            teamkill = killer.team == client.team;
                        }
                    });
                    killTank(client.id, mines[id].owner, "mine", killstreak, team, teamkill);
                }
            }
        }

        for (let i in presents) {
            if (!presents[i].destroyed) {
                let distance = Math.sqrt(Math.pow(presents[i].x - mines[id].x, 2) + Math.pow(presents[i].y - -mines[id].y, 2));

                if (distance < 1.5) {
                    presents[i].destroyed = true;
                    presents[i].destroyed_time = Date.now();

                    wss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({type: 9, x: presents[i].x, y: presents[i].y, destroyed: true}));
                        }
                    })
                }
            }
        }
    });

    delete mines[id];
}

function gameTick() {
    let sinceStart = Math.floor((Date.now() - roundStart) / 1000);
    let payload = {type: 0, tanks: {}, bullets: {}, mines: {}, scores, sinceStart};
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
    for(let id in mines) {
        payload.mines[id] = {
            team: mines[id].team,
            ticking: mines[id].ticking,
            x: mines[id].x,
            y: mines[id].y
        };
    }
    wss.clients.forEach(client => {
        if(client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({challenge: client.challenge, clip: client.bullets, explosives: client.mines, ...payload}));
        }
    });
    for(let id in bullets) {
        if(Date.now() - bullets[id].created > 10000) {
            destroyBullet(id);
        } else {
            for(let other in bullets) {
                if(id != other) {
                    let distance = Math.sqrt(Math.pow(bullets[id].x - bullets[other].x, 2) + Math.pow(bullets[id].y - bullets[other].y, 2));
                    if(distance < 0.2) {
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
                        if(distance < 0.5) {
                            var team, teamkill;
                            var killstreak = 0;
                            wss.clients.forEach(killer => {
                                if(killer.id == bullets[id].owner) {
                                    killstreak = killer.killstreak;
                                    team = killer.team;
                                    teamkill = killer.team == tank.team;
                                }
                            });
                            if(!(bullets[id].owner == tank.id && bullets[id].ricochet)) {
                                if(bullets[id].team != tank.team || bullets[id].owner == tank.id) {
                                    killTank(tank.id, bullets[id].owner, bullets[id].ricochet ? "bullet" : "ricochet", killstreak, team, teamkill);
                                }
                                destroyBullet(id);
                            }
                        }
                    }
                });
                if(bullets[id]) {
                    let check_collision = (x, y) => {
                        for(let check_x = Math.floor(x - 0.01); check_x <= Math.floor(x + 0.01); check_x++) {
                            for(let check_y = -Math.ceil(y + 0.01); check_y <= -Math.ceil(y - 0.01); check_y++) {
                                switch(maps[available_maps[current_map]][check_y][check_x]) {
                                    case 1:
                                        let still_exists = true;
                                        for (let i in presents) {
                                            if (presents[i].x == check_x && presents[i].y == check_y && presents[i].destroyed) {
                                                still_exists = false;
                                                break;
                                            }
                                        }
                                        return still_exists;
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
                    if (check_collision(bullets[id].x + 0.5 + (dx * 0.125), bullets[id].y - 0.5)) {
                        // Flip x
                        bullets[id].rot = Math.PI - bullets[id].rot;
                        dx = -dx;
                        did_reflect = true;
                    }
                    if (check_collision(bullets[id].x + 0.5, bullets[id].y - (dy * 0.125) - 0.5)) {
                        bullets[id].rot = -bullets[id].rot;
                        dy = -dy;
                        did_reflect = true;
                    }

                    bullets[id].x += dx * 0.125;
                    bullets[id].y -= dy * 0.125;

                    if (did_reflect) {
                        if (!bullets[id].ricochet) {
                            destroyBullet(id);
                        } else {
                            wss.clients.forEach(client => {
                                if(client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({type: 10, x: bullets[id].x, y: bullets[id].y}));
                                }
                            });

                            bullets[id].ricochet = false;
                        }
                    }
                }
            }
        }
    }
    for(let id in mines) {
        if(mines[id].ticking) {
            if(Date.now() - mines[id].created > 2000) {
                detonateMine(id);
            }
        } else if(Date.now() - mines[id].created > 7000) {
            if(!mines[id].ticking) {
                mines[id].ticking = true;
                mines[id].created = Date.now();
            }
        }
        if(mines[id]) {
            for(let bid in bullets) {
                let distance = Math.sqrt(Math.pow(mines[id].x - bullets[bid].x, 2) + Math.pow(mines[id].y - bullets[bid].y, 2));
                if(distance < 0.6) {
                    mines[id].owner = bullets[bid].owner;
                    destroyBullet(bid);
                    detonateMine(id);
                    break;
                }
            }
        }
        if(mines[id]) {
            wss.clients.forEach(tank => {
                if(mines[id]) {
                    if(tank.team != mines[id].team && tank.alive) {
                        let distance = Math.sqrt(Math.pow(mines[id].x - tank.x, 2) + Math.pow(mines[id].y - tank.y, 2));
                        if(distance < 3) {
                            if(!mines[id].ticking) {
                                mines[id].ticking = true;
                                mines[id].created = Date.now();
                            }
                        }
                    }
                }
            });
        }
    }

    // Present regeneration
    const regen_time = 20000; // 20 seconds
    for(let id in presents) {
        if (presents[id].destroyed && Date.now() - presents[id].destroyed_time >= regen_time) {
            let tank_in_range = false;
            wss.clients.forEach(tank => {
                let distance = Math.sqrt(Math.pow(presents[id].x - tank.x, 2) + Math.pow(presents[id].y + tank.y, 2));
                if(distance < 3) {
                    tank_in_range = true;
                }
            });
            if (!tank_in_range) {
                presents[id].destroyed = false;
                wss.clients.forEach(client => {
                    client.send(JSON.stringify({type: 9, x: presents[id].x, y: presents[id].y, destroyed: false}));
                });
            }
        }
    }

    // Map switching
    if(roundPlaying) {
        let sinceStart = Math.floor((Date.now() - roundStart) / 1000);
        if(((600 - sinceStart <= 0) && (scores.red != scores.green)) || (wss.clients.length == 0 || (900 - sinceStart <= 0))) {
            roundPlaying = false;
            current_map = (current_map + 1) % available_maps.length;
            roundStart = Date.now();

            let winner = scores.red != scores.green ? (scores.red > scores.green ? "red" : "green") : "tie";

            // Reset the scoreboard
            scores = {red: 0, green: 0};
            // Clear all the bullets and mines from the field
            for(let id in bullets) {
                destroyBullet(id);
            }
            for(let id in mines) {
                detonateMine(id);
            }
            // Clear all the tanks from the field and display the victor
            wss.clients.forEach(client => {
                client.send(JSON.stringify({type: 12, winner}));
                killTank(client.id, client.id, "disconnect", 0, client.team, true);
            });
            // Inform players of the new map
            setTimeout(() => {
                wss.clients.forEach(client => {
                    client.send(JSON.stringify({type: 2, id: client.id, map: available_maps[current_map]}));
                });
                roundPlaying = true;
            }, 3000);
        }
    }

    setTimeout(gameTick, 33 - (Date.now() - start));
}

setTimeout(gameTick, 0);

setInterval(() => {
    let now = Date.now();
    wss.clients.forEach(client => {
        if(client.readyState === WebSocket.OPEN) {
            if(now - client.last > 2000) {
                wss.clients.forEach(player => {
                    if(player.readyState === WebSocket.OPEN) {
                        player.send(JSON.stringify({type: 4, id: client.id, killer: client.id, method: "disconnect", killstreak: 0}));
                    }
                });
                client.terminate();
            }
        }
    });
}, 1000);
