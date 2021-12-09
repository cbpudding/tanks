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
    }

    class Tank {
        constructor(id, team) {
            this.base = models.base.clone();
            this.baseAngle = 0; // Y rotation
            this.cannon = models.cannon.clone();
            this.cannonAngle = 0; // Y rotation
            this.desiredBaseAngle = 0;
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

        update(deltatime) {
            // Regulate the variables to an acceptable range
            let normalizeAngle = (angle) => {
                if (angle < 0) {
                    angle += 2 * Math.PI;
                } else if (angle >= 2 * Math.PI) {
                    angle -= 2 * Math.PI;
                }
                return angle;
            };

            this.desiredBaseAngle = normalizeAngle(this.desiredBaseAngle);
            this.baseAngle = normalizeAngle(this.baseAngle);

            if (Math.abs(this.desiredBaseAngle % Math.PI - this.baseAngle % Math.PI) != 0) {
                // Determine the offset needed to reach the angle that appears closest
                // All items in the array are angles for an end of the tank.
                let possible_near = [
                    this.baseAngle - (Math.PI * 2),
                    this.baseAngle - Math.PI,
                    this.baseAngle,
                    this.baseAngle + Math.PI,
                    this.baseAngle + (Math.PI * 2)
                ].reduce((min, rad) => {
                    // Determine the minimum distance to an end of the tank
                    return Math.abs(min) < Math.abs(this.desiredBaseAngle - rad) ? min : this.desiredBaseAngle - rad;
                }, 1000000);

                // Changes how fast the tank appears to turn (cosmetic only)
                const TURN_SPEED = 2 * Math.PI;

                if (Math.abs(possible_near) <= TURN_SPEED * deltatime) {
                    // Jump immediately to the desired angle if going to overshoot
                    this.baseAngle += possible_near;
                } else {
                    // Move at the turning speed in the correct direction to approach
                    // the desired angle
                    if(possible_near < 0) {
                        this.baseAngle -= TURN_SPEED * deltatime;
                    } else {
                        this.baseAngle += TURN_SPEED * deltatime;
                    }
                }
            }

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
    }

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

            localTank.x += direction.x * 2 * deltatime;
            localTank.y -= direction.y * 2 * deltatime;
            setCameraPosition(localTank.x, localTank.y);
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
                            tanks[id].baseAngle = msg.tanks[id].base;
                            tanks[id].cannonAngle = msg.tanks[id].cannon;
                            tanks[id].x = msg.tanks[id].x;
                            tanks[id].y = msg.tanks[id].y;
                        } else if(!localTank) {
                            localTank = new Tank(id, teams.red);
                        }
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
            }
        };

        renderScene();
    }).catch(error => console.error);

    $("#play").on("click", joinGame);
    $(window).on("keydown", event => updateKey(event.code, true));
    $(window).on("keyup", event => updateKey(event.code, false));
    $(window).on("mousemove", pointCannonAtMouse);
    $(window).on("resize", scaleDisplay);
});
