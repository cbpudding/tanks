$(() => {
    const canvas = $("#display")[0];
    const textMeasurer = document.createElement("canvas").getContext("2d");
    const clock = new THREE.Clock();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 128);
    const renderer = new THREE.WebGLRenderer({canvas});
    const gltfLoader = new THREE.GLTFLoader();
    const texLoader = new THREE.TextureLoader();
    const audioListener = new THREE.AudioListener();
    const audioLoader = new THREE.AudioLoader();

    const materials = {};
    const players = {};
    const sounds = {};
    const textures = {};
    var websock = null;

    function playSound(name, x, y) {
        let sound = new THREE.PositionalAudio(audioListener);
        sound.setBuffer(sounds[name]);
        // TODO: Decide on a proper distance until major falloff
        sound.setRefDistance(10);
        sound.position.set(x, 20, y + 16);

        // TODO: Less hackish way to spawn and then remove sound
        scene.add(sound);
        sound.onEnded = () => scene.remove(sound);
        
        sound.play();

        // TODO: Remove sound debug when happy (also helps confirm proper removal of sound)
        const helper = new THREE.PositionalAudioHelper( sound, 1 );
        sound.add( helper );
    }

    class Bullet {
        constructor(id, x, y) {
            this.model = models.bullet.clone();
            this.model.scale.set(2, 2, 2);
            scene.add(this.model);
            this.rotation = 0;
            this.x = x;
            this.y = y;

            bullets[id] = this;
        }

        delete() {
            scene.remove(this.model);
        }

        update(deltatime) {
            let dx = Math.cos(this.rotation);
            let dy = Math.sin(this.rotation);

            this.x += dx * (3.676470588 * deltatime);
            this.y -= dy * (3.676470588 * deltatime);

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

            let wall_type = 0;
            for(let check_x = x_min; check_x <= x_max; check_x++) {
                for(let check_y = y_min; check_y <= y_max; check_y++) {
                    switch(this.tiles[check_y][check_x].canCollide()) {
                    case 1:
                        wall_type =  1;
                        break;
                    case 2:
                        wall_type = 2; // Because it is overwritten by a wall if found
                        break;
                    case 3:
                        if (wall_type == 0) wall_type = 3;
                        break;
                    case 4:
                        if (wall_type == 0) wall_type = 4;
                        break;
                    }
                }
            }

            return wall_type;
        }
    }

    const mineColor = new THREE.MeshPhongMaterial({color: 0x777777});

    class Mine {
        constructor(team, ticking, x, y) {
            this.exploded = false;
            this.lit = false;
            this.model = models.mine.clone();
            this.model.position.x = x;
            this.model.position.z = y;
            this.model.scale.set(0.5, 0.5, 0.5);
            this.queueDeletion = false;
            this.team = team;
            this.ticking = ticking;
            this.totaltime = 0;
            this.x = x;
            this.y = y;
            recolorModel(this.model, mineColor);
            scene.add(this.model);
        }

        explode() {
            scene.remove(this.model);
            this.model = new THREE.Mesh(
                new THREE.SphereGeometry(1.5),
                materials.explosion.clone()
            );
            this.model.position.x = this.x;
            this.model.position.z = this.y;
            this.model.rotation.x = -Math.PI / 4; // Hide seam
            this.model.rotation.y = Math.random() * Math.PI;

            this.model.material.transparent = true;
            this.model.material.opacity = 1;
            scene.add(this.model);

            this.ticking = false;
            this.exploded = true;

            playSound("boom", this.x, this.y);
        }

        delete() {
            scene.remove(this.model);
        }

        update(deltatime) {
            if(this.ticking) {
                this.totaltime += deltatime;
                if(Math.floor((this.totaltime * 7) % 2) == 0) {
                    if(this.lit) {
                        this.lit = false;
                        recolorModel(this.model, mineColor);
                    }
                } else {
                    if(!this.lit) {
                        this.lit = true;
                        recolorModel(this.model, this.team.colorMaterial);
                    }
                }
            } else if (this.exploded) {
                this.model.rotation.y += Math.PI * deltatime;
                this.model.material.opacity -= 2 * deltatime;
                let scale = Math.min(1, 1 - this.model.material.opacity);
                this.model.scale.set(scale, scale, scale);
                if (this.model.material.opacity <= 0) {
                    this.queueDeletion = true;
                }
            }
        }
    }

    class Tank {
        constructor(id, name, team) {
            this.base = models.base.clone();
            this.baseAngle = 0; // Y rotation
            this.cannon = models.cannon.clone();
            this.cannonAngle = 0; // Y rotation
            this.desiredBaseAngle = 0;
            this.direction = {x: 0, y: 0}; // Used for movement prediction

            // Create name geometry
            this.name = name;
            players[id] = {name, team};
            if (name != "") {
                this.nametag = document.createElement('p');
                this.nametag.innerText = name;
                this.nametag.style.position = "absolute";
                $("#nametags").append(this.nametag);
            }

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
            if(this.nametag) {
                this.nametag.remove();
            }
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

            if(this.nametag) {
                camera.updateMatrixWorld();
                let vector = new THREE.Vector3(this.x, 1.5, this.y).project(camera);
                vector.x = (vector.x + 1) / 2 * window.innerWidth;
                vector.y = -(vector.y - 1) / 2 * window.innerHeight;

                if(localStorage.dyslexic == "true") {
                    textMeasurer.font = "16px OpenSans";
                } else {
                    textMeasurer.font = "16px OpenDyslexic";
                }
                let width = textMeasurer.measureText(this.nametag.innerText).width / 2;

                this.nametag.style.left = vector.x - width + "px";
                this.nametag.style.top = vector.y + "px";
            }
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
            let geometry, material;
            this.id = id;
            switch(id) {
                case 1:
                    // Destructable Wall
                    const presents = ["present", "presentblue", "presentgreen"];
                    this.object = models[presents[Math.floor(Math.random() * presents.length)]].clone();
                    this.child = new Tile(0, x, y);
                    this.destroyed = false;
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
                    geometry = new THREE.PlaneGeometry(1, 1);
                    geometry.rotateX(-Math.PI / 2);
                    this.object = new THREE.Mesh(geometry, materials.redbarrier);
                    break;
                case 7:
                    // Blue Barrier
                    geometry = new THREE.PlaneGeometry(1, 1);
                    geometry.rotateX(-Math.PI / 2);
                    this.object = new THREE.Mesh(geometry, materials.greenbarrier);
                    break;
                case 8:
                    // Heavy Snow
                    break;
                default:
                    // Ground
                    geometry = new THREE.PlaneGeometry(1, 1);
                    geometry.rotateX(-Math.PI / 2);
                    material = new THREE.MeshPhongMaterial({color: 0xffffff});
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
                    return this.destroyed ? 0 : 1;
                case 2:
                    return 1;
                case 3:
                    return 2;
                case 6: // Red barrier
                    return 3; // Red only
                case 7: // Green barrier
                    return 4; // Green only
                default:
                    return 0;
            }
        }

        destroy() {
            if (this.id == 1 && !this.destroyed) {
                let x = this.object.position.x;
                let y = this.object.position.z;
                scene.remove(this.object);
                this.object = models.presentdestroyed.clone();
                this.object.position.x = x;
                this.object.position.z = y;
                
                scene.add(this.object);
                this.destroyed = true;
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
    var killfeed = []; // Array to store killfeed elements
    var localTank = null;
    var me = null;
    const mines = {};
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

            // Move tank (and test collisions)
            let collided = currentMap.isColliding(0.95, localTank.x + (direction.x * 2 * deltatime), localTank.y);
            if (collided == 0 || collided == (localTank.team == teams.green ? 4 : 3)) {
                localTank.x += direction.x * 2 * deltatime;
            }
            collided = currentMap.isColliding(0.95, localTank.x, localTank.y - (direction.y * 2 * deltatime));
            if (collided == 0 || collided == (localTank.team == teams.green ? 4 : 3)) {
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
        audioListener.context.resume();
        $("#menu").hide();
        $("#nickname").blur();
        let name = $("#nickname").val() || "Anonymous";
        localStorage.nickname = name;
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

    function loadSound(name, path) {
        return new Promise(resolve => {
            audioLoader.load(path, buffer => {
                sounds[name] = buffer;
                resolve();
            });
        });
    }

    function loadTexture(name, path) {
        return new Promise(resolve => {
            textures[name] = texLoader.load(path);
            resolve();
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
        for(let id in mines) {
            mines[id].update(deltatime);
            if (mines[id].queueDeletion) {
                mines[id].delete();
                delete mines[id];
            }
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
            case "Space":
                if(pressed) {
                    websock.send(JSON.stringify({type: 7}));
                }
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
    camera.add(audioListener);
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
        loadModel("presentdestroyed", "models/present_destroyed.glb"),
        loadModel("bullet", "models/projectile.glb"),
        loadModel("wall", "models/rockwall.glb"),
        loadModel("base", "models/tank_bottom.glb"),
        loadModel("cannon", "models/tank_top.glb"),
        loadSound("boom", "sounds/boom.ogg"),
        loadSound("ricochet", "sounds/ricochet.ogg"),
        loadSound("shoot", "sounds/shoot.ogg"),
        loadTexture("barrierblue", "textures/blue_barrier.png"),
        loadTexture("barriergreen", "textures/green_barrier.png"),
        loadTexture("barrierred", "textures/red_barrier.png"),
        loadTexture("explosion", "textures/explosion.png")
    ]).then(() => {
        materials.redbarrier = new THREE.MeshPhongMaterial({map: textures.barrierred});
        materials.greenbarrier = new THREE.MeshPhongMaterial({map: textures.barriergreen});
        materials.explosion = new THREE.MeshPhongMaterial({map: textures.explosion});

        websock = new WebSocket("wss://" + location.hostname + ":3000/");

        dyslexiaFont(localStorage.dyslexic == "true");
        recolorGreen(localStorage.recolor == "true");

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
                        if(id != me || !localTank) {
                            if(!tanks[id]) {
                                let tank = new Tank(id, msg.tanks[id].name, teams[msg.tanks[id].team]);
                                if(!localTank && id == me) {
                                    localTank = tank;
                                }
                            }
                            tanks[id].direction = msg.tanks[id].direction;
                            tanks[id].baseAngle = msg.tanks[id].base;
                            tanks[id].cannonAngle = msg.tanks[id].cannon;
                            tanks[id].x = msg.tanks[id].x;
                            tanks[id].y = msg.tanks[id].y;
                        }
                    }

                    for (let id in msg.bullets) {
                        if(!bullets[id]) {
                            new Bullet(id, msg.bullets[id].x, msg.bullets[id].y);
                            playSound("shoot", msg.bullets[id].x, msg.bullets[id].y);
                        }

                        bullets[id].rotation = msg.bullets[id].rot;
                        bullets[id].x = msg.bullets[id].x;
                        bullets[id].y = msg.bullets[id].y;
                    }

                    for(let id in msg.mines) {
                        if(!mines[id]) {
                            mines[id] = new Mine(teams[msg.mines[id].team], msg.mines[id].ticking, msg.mines[id].x, msg.mines[id].y);
                        }
                        mines[id].ticking = msg.mines[id].ticking;
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
                        $("#menu").show();
                    }
                    if(msg.killstreak >= 50) {
                        if(tanks[msg.killer].nametag) {
                            if(!tanks[msg.killer].nametag.classList.contains("rainbow")) {
                                tanks[msg.killer].nametag.classList.add("rainbow");
                            }
                        }
                    }
                    if(msg.method != "disconnect") {
                        console.log(players[msg.killer].name + " killed " + players[msg.id].name + " with " + msg.method);

                        let killfeedEntry = document.createElement("div");
                        killfeedEntry.className = "killfeedEntry";

                        let victim = undefined;
                        if(msg.killer != msg.id) {
                            victim = document.createElement("div");
                            victim.innerText = players[msg.id].name;
                            victim.className = "killfeedName";
                            victim.style.color = "#" + players[msg.id].team.color.toString(16);
                        }

                        let method = document.createElement("img");
                        switch(msg.method) {
                            case "bullet":
                                method.src = "/textures/bullet.png";
                                break;
                            case "mine":
                                method.src = "/textures/mine.png";
                                break;
                            case "ricochet":
                                method.src = "/textures/ricochet.png";
                                break;
                            default:
                                method.src = "/textures/WAT.png";
                                break;
                        }
                        method.className = "killfeedMethod";

                        let killer = document.createElement("div");
                        killer.innerText = players[msg.killer].name;
                        killer.className = "killfeedName";
                        killer.style.color = "#" + players[msg.killer].team.color.toString(16);

                        killfeedEntry.appendChild(killer);
                        killfeedEntry.appendChild(method);
                        if(victim) {
                            killfeedEntry.appendChild(victim);
                        }

                        if (killfeed.length >= 4) {
                            killfeed[0].remove();
                            killfeed.shift();
                        }

                        killfeed.push(killfeedEntry);
                        $("#killfeed").append(killfeedEntry);
                    }

                    tanks[msg.id].delete();
                    delete tanks[msg.id];
                    break;
                case 6:
                    bullets[msg.id].delete();
                    delete bullets[msg.id];
                    break;
                case 8:
                    mines[msg.id].explode();
                    // Don't delete here, simply play the explosion
                    // and wait for the mine to queue deletion
                    break;
                case 9:
                    currentMap.tiles[msg.y][msg.x].destroy();
                    break;
            }
        };

        renderScene();
    }).catch(error => console.error);

    $("#nickname").keydown(event => {
        if(event.code == "Enter") {
            joinGame();
        }
    });
    $("#play").on("click", joinGame);
    $(window).on("mousedown", shoot);
    $(window).on("keydown", event => updateKey(event.code, true));
    $(window).on("keyup", event => updateKey(event.code, false));
    $(window).on("mousemove", pointCannonAtMouse);
    $(window).on("resize", scaleDisplay);

    function dyslexiaFont(enabled) {
        if(enabled) {
            $("body").addClass("dyslexia");
        } else {
            $("body").removeClass("dyslexia");
        }
    }

    function recolorGreen(enabled) {
        if(enabled) {
            teams.green.color = 0x00bfff;
            teams.green.colorMaterial.color = new THREE.Color(0x00bfff);
            $("#greenpreview").css("color", "deepskyblue");
            materials.greenbarrier.map = textures.barrierblue;
        } else {
            teams.green.color = 0x14430d;
            teams.green.colorMaterial.color = new THREE.Color(0x14430d);
            $("#greenpreview").css("color", "green");
            materials.greenbarrier.map = textures.barriergreen;
        }
    }

    $("#dyslexic").click(() => {
        localStorage.dyslexic = $("#dyslexic").prop("checked");
        dyslexiaFont(localStorage.dyslexic == "true");
    });
    $("#dyslexic").prop("checked", localStorage.dyslexic == "true");
    $("#nickname").val(localStorage.nickname || "");
    $("#nickname").focus();
});
