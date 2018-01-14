Battlecode 2018 Tiny Viewer
===========================

Tiny HTML5-based viewer for Battlecode 2018 replays. Not necessarily compliant with anything, as it was hacked out by manually inspecting replay files and doing what seemed right.

To run, visit [https://dabbler0.github.io/bc18-tinyview](https://dabbler0.github.io/bc18-tinyview).

Alternatively, run this by running a localhost server. For instance, suppose you have the following file structure:

```
battlecode/
    replays/
        replay-1.bc18
        replay-2.bc18
    bc18-tinyview/ [this repository]
        index.html
        README.md
```

Then run `python -m http.server 8080` in the `battlecode/` directory. Then navigate to `localhost:8080/bc18-tinyview/index.html`. Then type `/replays/replay-1.bc18` in the "filename" input and hit enter. It should now start loading the replay and will start the animation once it's done loading.

Adjust the "10" in the input below it to change the number of milliseconds between each frame (so larger is slower). Hit enter to apply the new speed.

Hit "Reset" to, well, reset and start the animation over from the beginning.

Contributing
------------

~~This viewer is not very good and needs improvement.~~ Tinyviewer is pretty good thanks to contributions from HalfVoxel, ChiCubed, gabrielsimoes, and stefangimmillaro. Fork this repository and make pull requests and I will merge them when I'm paying attention.

Nice-to-haves:
 - Visualize units in space
 - Visualize units in garrison of buildings (possibly only on mouseover)
 - Visualize research queue and completed research
 - Show attacks when paused
 - Add additional detailed info with mouseover or click, including precise health, cooldown, precise location, precise Karbonite
 - Allow toggling Fog of War for given player
 - Create an annotation format; players should be able to make special log files, and if we load them alongside the game, render lines and dots on the map (like last year).

 Finished TODOS
 ---------------
 - Visualize Mars at all (done)
 - Distinguish between different types of units (done)
 - Visualize health bars on units (done)
 - Make visualizations for attacks that make clear who is attacking whom (done)
 - Show how many of each kind of unit each player has (done)
 - Implement a scrubber (done)
