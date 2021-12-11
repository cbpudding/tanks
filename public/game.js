/* TODO List:
- Tank movement
- Multiplayer
- Bullets
- Mines
- Tank death
- Main menu
- Sound
*/

$(() => {
    const canvas = $("#display")[0];
    const clock = new THREE.Clock();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 128);
    const renderer = new THREE.WebGLRenderer({canvas});
    const gltfLoader = new THREE.GLTFLoader();
    var websock = null;

    class Bullet {
        constructor(id, x, y) {
            this.model = models.bullet.clone();
            scene.add(this.model);
            this.rotation = 0;
            this.x = x;
            this.y = y;

            bullets[id] = this;
        }

        remove() {
            scene.remove(this.model);
        }

        update(_deltatime) {
            this.model.position.x = this.x;
            this.model.position.z = this.y;
            this.model.rotation.y = this.rotation;
        }
    }

    class Map {
        constructor(url) {
            $.get(url, data => {
                // Convert CSV data into a two-dimensional array of IDs
                this.data = [];
                let lines = data.trim().split(/\r?\n/);
                this.height = lines.length + 2;
                this.width = lines[0].split(",").length;
                this.data.push(Array(this.width + 2).fill(2));
                for(let line of lines) {
                    let temp = [2];
                    let tiles = line.split(",").slice(0, this.width);
                    for(let tile of tiles) {
                        let id = parseInt(tile, 10) || 0;
                        if(id < 0) {
                            id = 0;
                        }
                        temp.push(id);
                    }
                    let padding = (this.width + 2) - temp.length;
                    temp = temp.concat(Array(padding).fill(2));
                    this.data.push(temp);
                }
                this.data.push(Array(this.width + 2).fill(2));
                this.width += 2;
                // Create the tiles from the parsed map data
                this.tiles = [];
                for(let y in this.data) {
                    let row = [];
                    for(let x in this.data[y]) {
                        row.push(new Tile(this.data[y][x], x, y));
                    }
                    this.tiles.push(row);
                }
                // Center the camera on the newly loaded map for good measure
                setCameraPosition((this.width / 2) - 0.5, (this.height / -2) + 0.5);
            });
        }

        // Returns if a collision is occuring
        // IMPORTANT: 0 = none, 1 = colliding with wall (Takes priority over 2), 2 = colliding with hole
        isColliding(collider_size /* square, side length */, x, y) {
            let x_min = Math.floor(x);
            let x_max = Math.floor(x + collider_size);
            let y_min = -Math.ceil(y);
            let y_max = -Math.ceil(y - collider_size);

            let is_hole = 0;
            for(let check_x = x_min; check_x <= x_max; check_x++) {
                for(let check_y = y_min; check_y <= y_max; check_y++) {
                    switch(this.tiles[check_x][check_y].canCollide()) {
                    case 1:
                        return 1;
                    case 2:
                        is_hole = 2; // Because it is overwritten by wall if found
                    }
                }
            }

            return is_hole;
        }
    }

    class Tank {
        constructor(id, team) {
            this.base = models.base.clone();
            this.baseAngle = 0; // Y rotation
            this.cannon = models.cannon.clone();
            this.cannonAngle = 0; // Y rotation
            this.desiredBaseAngle = 0;
            this.direction = {x: 0, y: 0}; // Used for movement prediction
            this.team = team;
            this.x = 0; // 3D coordinate X
            this.y = 0; // 3D coordinate Z
            recolorModel(this.base, this.team.colorMaterial);
            recolorModel(this.cannon, this.team.colorMaterial);
            scene.add(this.base);
            scene.add(this.cannon);
            tanks[id] = this;
        }

        delete() {
            scene.remove(this.base);
            scene.remove(this.cannon);
        }

        update(_deltatime) {
            this.base.position.x = this.x;
            this.base.position.z = this.y;
            this.base.rotation.y = this.baseAngle;
            this.cannon.position.x = this.x;
            this.cannon.position.z = this.y;
            this.cannon.rotation.y = this.cannonAngle;
        }
    }

    class Team {
        constructor(color) {
            this.color = color;
            this.colorMaterial = new THREE.MeshPhongMaterial({color: this.color});
        }
    }

    class Tile {
        constructor(id, x, y) {
            this.id = id;
            switch(id) {
                case 1:
                    // Destructable Wall
                    const presents = ["present", "presentblue", "presentgreen"];
                    this.object = models[presents[Math.floor(Math.random() * presents.length)]].clone();
                    this.child = new Tile(0, x, y);
                    break;
                case 2:
                    // Regular Wall
                    this.object = models.wall.clone();
                    break;
                case 3:
                    // Hole
                    this.object = models.hole.clone();
                    break;
                case 6:
                    // Red Barrier
                    break;
                case 7:
                    // Blue Barrier
                    break;
                case 8:
                    // Heavy Snow
                    break;
                default:
                    // Ground
                    let geometry = new THREE.PlaneGeometry(1, 1);
                    geometry.rotateX(-Math.PI / 2);
                    let material = new THREE.MeshPhongMaterial({color: 0xffffff});
                    this.object = new THREE.Mesh(geometry, material);
                    break;
            }
            if(this.object) {
                this.object.position.x = x;
                this.object.position.z = -y;
                scene.add(this.object);
            } else {
                console.warn("ID " + this.id + " has no physical representation!");
            }
        }

        canCollide() {
            switch(this.id) {
                case 1:
                case 2:
                    return 1;
                case 3:
                    return 2;
                default:
                return 0;
            }
        }
    }

    const bullets = {};
    const buttons = {
        down: false,
        left: false,
        right: false,
        up: false
    };
    var currentMap = null;
    var desiredAngle = 0;
    var direction = {x: 0, y: 0};
    var localTank = null;
    var me = null;
    const models = {};
    const tanks = {};
    const teams = {
        green: new Team(0x14430d),
        red: new Team(0xff1209)
    };

    function updateLocalTank(deltatime) {
        if(localTank) {
            if(buttons.down || buttons.left || buttons.right || buttons.up) {
                let dir = {x: 0, y: 0};
                if(buttons.down ^ buttons.up) {
                    if(buttons.down) {
                        dir.y = -1;
                    } else {
                        dir.y = 1;
                    }
                }
                if(buttons.left ^ buttons.right) {
                    if(buttons.left) {
                        dir.x = -1;
                    } else {
                        dir.x = 1;
                    }
                }
                let angle = Math.atan(direction.y / direction.x);
                if(isNaN(angle)) {
                    angle = localTank.baseAngle;
                }
                if(dir.x < 0) {
                    desiredAngle = angle + Math.PI;
                } else {
                    desiredAngle = angle;
                }
                direction = dir;
            } else {
                desiredAngle = localTank.baseAngle;
                direction = {x: 0, y: 0};
            }
            localTank.desiredBaseAngle = desiredAngle;

            // Move tank (and test collision)
            if (currentMap.isColliding(0.95, localTank.x + (direction.x * 2 * deltatime), localTank.y) == 0) {
                localTank.x += direction.x * 2 * deltatime;
            }
            if (currentMap.isColliding(0.95, localTank.x, localTank.y - (direction.y * 2 * deltatime)) == 0) {
                localTank.y -= direction.y * 2 * deltatime;
            }
            setCameraPosition(localTank.x, localTank.y);

            // Regulate the variables to an acceptable range
            let normalizeAngle = (angle) => {
                if (angle < 0) {
                    angle += 2 * Math.PI;
                } else if (angle >= 2 * Math.PI) {
                    angle -= 2 * Math.PI;
                }
                return angle;
            };

            localTank.desiredBaseAngle = normalizeAngle(localTank.desiredBaseAngle);
            localTank.baseAngle = normalizeAngle(localTank.baseAngle);

            if (Math.abs(localTank.desiredBaseAngle % Math.PI - localTank.baseAngle % Math.PI) != 0) {
                // Determine the offset needed to reach the angle that appears closest
                // All items in the array are angles for an end of the tank.
                let possible_near = [
                    localTank.baseAngle - (Math.PI * 2),
                    localTank.baseAngle - Math.PI,
                    localTank.baseAngle,
                    localTank.baseAngle + Math.PI,
                    localTank.baseAngle + (Math.PI * 2)
                ].reduce((min, rad) => {
                    // Determine the minimum distance to an end of the tank
                    return Math.abs(min) < Math.abs(localTank.desiredBaseAngle - rad) ? min : localTank.desiredBaseAngle - rad;
                }, 1000000);

                // Changes how fast the tank appears to turn (cosmetic only)
                const TURN_SPEED = 2 * Math.PI;

                if (Math.abs(possible_near) <= TURN_SPEED * deltatime) {
                    // Jump immediately to the desired angle if going to overshoot
                    localTank.baseAngle += possible_near;
                } else {
                    // Move at the turning speed in the correct direction to approach
                    // the desired angle
                    if(possible_near < 0) {
                        localTank.baseAngle -= TURN_SPEED * deltatime;
                    } else {
                        localTank.baseAngle += TURN_SPEED * deltatime;
                    }
                }
            }
        }
    }

    function updateExternalTank(id, deltatime) {
        // Test collision and move external tank for somewhat-realistic predictive movement
        if (currentMap.isColliding(0.95, tanks[id].x + (tanks[id].direction.x * 2 * deltatime), tanks[id].y) == 0) {
            tanks[id].x += tanks[id].direction.x * 2 * deltatime;
        }
        if (currentMap.isColliding(0.95, tanks[id].x, tanks[id].y - (tanks[id].direction.y * 2 * deltatime)) == 0) {
            tanks[id].y -= tanks[id].direction.y * 2 * deltatime;
        }
    }

    function joinGame() {
        $("#menu").hide();
        let name = $("#nickname").val() || "Anonymous";
        websock.send(JSON.stringify({type: 3, name}));
    }

    function loadMap(path) {
        if(currentMap) {
            // TODO: Unload the existing map
        }
        currentMap = new Map(path);
    }

    function loadModel(name, path) {
        return new Promise(resolve => {
            gltfLoader.load(path, gltf => {
                models[name] = gltf.scene;
                resolve();
            });
        });
    }

    function pointCannonAtMouse(event) {
        if(localTank) {
            let mouse = {x: event.pageX, y: event.pageY};
            let tank = {x: window.innerWidth / 2, y: window.innerHeight / 2};
            let angle = Math.atan((mouse.y - tank.y) / (mouse.x - tank.x));
            if(mouse.x - tank.x < 0) {
                localTank.cannonAngle = -angle + Math.PI;
            } else {
                localTank.cannonAngle = -angle;
            }
        }
    }

    function recolorModel(model, material) {
        for(let part of model.children) {
            part.material = material;
        }
    }

    function renderScene() {
        requestAnimationFrame(renderScene);

        let deltatime = clock.getDelta();

        updateLocalTank(deltatime);
        for(let id in tanks) {
            tanks[id].update(deltatime);

            if (tanks[id] != localTank) {
                updateExternalTank(id, deltatime);
            }
        }
        for(let id in bullets) {
            bullets[id].update(deltatime);
        }
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);
    }

    function scaleDisplay() {
        renderer.setSize(window.innerWidth, window.innerHeight);
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
    }

    function setCameraPosition(x, y) {
        camera.position.x = x;
        camera.position.z = y + 16;
    }

    function shoot() {
        if (localTank) {
            websock.send(JSON.stringify({
                    type: 5,
                    rot: localTank.cannonAngle
            }));
        }
    }

    function updateKey(keycode, pressed) {
        switch(keycode) {
            case "KeyW":
            case "KeyU":
            case "ArrowUp":
                buttons.up = pressed;
                break;
            case "KeyA":
            case "KeyH":
            case "ArrowLeft":
                buttons.left = pressed;
                break;
            case "KeyS":
            case "KeyJ":
            case "ArrowDown":
                buttons.down = pressed;
                break;
            case "KeyD":
            case "KeyK":
            case "ArrowRight":
                buttons.right = pressed;
                break;
        }
    }

    scaleDisplay();
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.setClearColor(0xffffff, 1);
    scene.add(new THREE.AmbientLight(0xbaffe7));
    let lamp = new THREE.DirectionalLight(0xffffff, 0.5);
    lamp.position.x = 1;
    lamp.position.z = 1;
    scene.add(lamp);
    camera.position.y = 20;
    camera.position.z = 16;
    camera.rotation.x = -50 * (Math.PI / 180);
    camera.zoom = 2;
    camera.updateProjectionMatrix();

    Promise.all([
        loadModel("hole", "models/hole.glb"),
        loadModel("mine", "models/mine.glb"),
        loadModel("present", "models/present.glb"),
        loadModel("presentblue", "models/present_blue.glb"),
        loadModel("presentgreen", "models/present_green.glb"),
        loadModel("bullet", "models/projectile.glb"),
        loadModel("wall", "models/rockwall.glb"),
        loadModel("base", "models/tank_bottom.glb"),
        loadModel("cannon", "models/tank_top.glb")
    ]).then(() => {
        websock = new WebSocket("ws://" + location.hostname + ":3000/");

        websock.onmessage = event => {
            let msg = JSON.parse(event.data);
            switch(msg.type) {
                case 0:
                    let challenge = msg.challenge;
                    let payload = {type: 1, challenge};
                    if(localTank) {
                        payload.base = localTank.baseAngle;
                        payload.direction = direction;
                        payload.cannon = localTank.cannonAngle;
                        payload.x = localTank.x;
                        payload.y = localTank.y;
                    }
                    websock.send(JSON.stringify(payload));
                    for(let id in msg.tanks) {
                        if(id != me) {
                            if(!tanks[id]) {
                                new Tank(id, teams.green);
                            }
                            tanks[id].direction = msg.tanks[id].direction;
                            tanks[id].baseAngle = msg.tanks[id].base;
                            tanks[id].cannonAngle = msg.tanks[id].cannon;
                            tanks[id].x = msg.tanks[id].x;
                            tanks[id].y = msg.tanks[id].y;
                        } else if(!localTank) {
                            localTank = new Tank(id, teams.red);
                            localTank.x = 4;
                            localTank.y = -2;
                        }
                    }

                    for (let id in msg.bullets) {
                        if(!bullets[id]) {
                            new Bullet(id, msg.bullets[id].x, msg.bullets[id].y);
                        }

                        bullets[id].rotation = msg.bullets[id].rot;
                        bullets[id].x = msg.bullets[id].x;
                        bullets[id].y = msg.bullets[id].y;
                    }
                    break;
                case 2:
                    me = msg.id;
                    console.log("Connected as " + me);
                    loadMap(msg.map);
                    break;
                case 4:
                    if(msg.id == me) {
                        localTank = null;
                    }
                    tanks[msg.id].delete();
                    delete tanks[msg.id];
                case 5:
                    bullets[msg.id].delete();
                    delete bullets[msg.id];
            }
        };

        renderScene();
    }).catch(error => console.error);

    $("#play").on("click", joinGame);
    $(window).on("mousedown", shoot);
    $(window).on("keydown", event => updateKey(event.code, true));
    $(window).on("keyup", event => updateKey(event.code, false));
    $(window).on("mousemove", pointCannonAtMouse);
    $(window).on("resize", scaleDisplay);
});
