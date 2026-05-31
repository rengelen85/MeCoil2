I have bought a super cool Goliath Recoil laser gun set, which unfortunately is discontinued by the vendor and the latest Android app doesn't work anymore.

Therefor I'd like to develop my own web app that I can use on any mobile device. The following user has already made a simple nice open source version here: https://github.com/DroopCat/Scope. Probably there is some reusable stuff in this repo w.r.t. connecting the smartphone to the gun via Bluetooth. Some other open source alternatives to potentially check are:
- https://gitlab.com/FeralBytes/FreecoiL
- https://github.com/Dees-Troy/SimpleCoil

I'd like to start with a web app that can be started in any smartphone's browser, but later also have the option to extend with dedicated android and iOS apps.

The game should include/support:
 - Bluetooth connectivity to the Recoil gun hardware
 - Any local available wi-fi network, where players on the same network as the server can join the game
 - The server should be able to run from any Linux based system, where it should als be able to run from a Raspberry PI. Windows would be optional.
 - At least the following game modes:
   - Free for all
   - Team Deathmatch
   - Capture the flag

The app should include a profesional and modern looking game interfaceat, with at least the following UI elements:
- a main menu to set preferences and start or join a new game
- when a user starts a new game they should be able to set a game mode and some game limits (e.g. score or time limits)
- a lobby for people to wait before a new game starts
- a in game view, that:
  - Offers real-time score view and timer for the game
  - Includes a map view, which ideally is based on an open map from the actual location of the players, where:
    - Players from the same team are always visible as a dot in green color.
    - Enemies should only be briefly visible as a red dot on the map when they are firing their gun
    - Power-ups through random drop down packages which are also made visible on the map as blue dots. The player can collect them when their GPS location closely matches the dropped package on the map
  