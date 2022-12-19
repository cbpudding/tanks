# Tanks: A Christmas-themed tank arena

Tanks is a tile-based team deathmatch built for your web browser. Initially created as a tribute to a minigame of the same name, the initial run of the game was from December 24th, 2021 to January 6th, 2022 with some public testing done beforehand. The source code is a Christmas gift from Breadpudding and Nick to the citizens of the Internet. We hope you enjoy it as much as we do!

If you're interested in playing the game with others, feel free to join our [Discord](https://discord.gg/huUMC62BpK)!

## How to play

1. Find someone who is hosting the game
2. Navigate to the server address in your web browser
3. Type in your preferred username and click play!

| Key(s)              | Action      |
| ------------------- | ----------- |
| W / U / Up Arrow    | Move north  |
| A / H / Left Arrow  | Move west   |
| S / J / Down Arrow  | Move south  |
| D / K / Right Arrow | Move east   |
| Spacebar            | Place mine  |
| Move mouse          | Aim cannon  |
| Click               | Fire cannon |

Tips:
- Presents can be blown up with mines to open new paths!
- Bullets will ricochet off of walls(but only once before breaking)!
- Bullets can be destroyed by other bullets.
- Mines can be detonated by shooting them, being in close proximity to an enemy tank, or by simply waiting.

## How to host

*Note: The following instructions were created with Linux systems in mind.*

Requirements:
- Git
- Node.js
- OpenSSL
- Yarn

```
git clone https://github.com/cbpudding/tanks
cd tanks
openssl req -newkey rsa:4096 -nodes -keyout server.key -out server.csr
openssl x509 -signkey server.key -in server.csr -req -days 365 -out server.crt
rm server.csr
yarn install
npm test
```

Then navigate to https://localhost:3000/ and ignore any SSL errors that may occur.

To make a public game, it is recommended that you forward TCP port 3000 and acquire a real certificate using a service like Let's Encrypt.

## How to build a map

1. Download and install [Tiled](https://www.mapeditor.org/)
2. Create a new map and import the tileset found in assets/tilemap/tilemap_v2.png
3. Design the map however you wish
4. Export as a CSV and place the file in public/maps

*Note: If you want a reference to build off of, a few TMX files are available under assets/maps.*

## How to contribute

*TODO*