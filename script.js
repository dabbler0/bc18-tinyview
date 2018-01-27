// Constants
var UNIT_CLASSES = ['Worker', 'Knight', 'Ranger', 'Mage', 'Healer', 'Factory', 'Rocket'];
var MAX_HEALTHS = {'Worker': 100, 'Knight': 250, 'Ranger': 200, 'Mage': 80, 'Healer': 100, 'Factory': 300, 'Rocket': 200};
var TEAMS = ['Red', 'Blue'];
var TEAM_COLOR = {'Red': '#ac1c1e', 'Blue': '#3273dc'};
var ATTACK_COLOR = {'Red': 'rgba(255, 0, 0, 0.7)', 'Blue': 'rgba(0, 0, 255, 0.7)'};
var HEAL_COLOR = {'Red': 'rgba(77, 175, 74, 0.8)', 'Blue': 'rgba(77, 175, 74, 0.8)'};
var HEAD_SIZE = 0.3;
var BORDER_WIDTH = 0.2;

// Globals
var mousedown_listener, mouseup_listener, input_listener;
var research_canvas = document.getElementById('research');
var earth_canvas = document.getElementById('earth');
var graph_canvas = document.getElementById('graphs');
var research_ctx = research_canvas.getContext('2d');
var graph_ctx = graph_canvas.getContext('2d');
var earth_ctx = earth_canvas.getContext('2d');
var mars_canvas = document.getElementById('mars');
var mars_ctx = mars_canvas.getContext('2d');
var timeout = 40;
var activeID = 0;

const turnsliderElement = document.getElementById('turnslider');
const turnElement = document.getElementById('turn');
const teamUnitCountElements = [];

for (var i = 0, team; team = TEAMS[i]; i++) {
    let v = [];
    for (var j = 0, unit_class; unit_class = UNIT_CLASSES[j]; j++) {
        v.push(document.getElementById('info' + team + unit_class));
    }
    teamUnitCountElements.push(v);
}

var classIcons = {};
for (let i = 0; i < UNIT_CLASSES.length; i++) {
    let img = new Image();
    img.src = "images/" + UNIT_CLASSES[i] + ".svg";
    classIcons[UNIT_CLASSES[i]] = img;
}

let rocketIcons = [null, null];
for (let i = 0; i < 2; i++) {
    let img = new Image();
    img.src = "images/RocketInSpace" + TEAMS[i] + ".svg";
    rocketIcons[i] = img;
}


// Set default timeout value
document.getElementById('timeout').value = getTPS();

// Allow setting replay speed
document.getElementById('timeout').addEventListener('change', function(e) {
    setTPS(document.getElementById('timeout').value);
});

// Set ticks per second
function setTPSExternal(tps) {
    setTPS(tps);
    document.getElementById('timeout').value = tps;
}

function setTPS(tps) {
    if (tps == 0) return;
    timeout = 1000 / tps;
}

function getTPS() {
    if (timeout === 0) return 0;
    return 1000 / timeout;
}

if (location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname === "") {
    document.getElementById("fname").style.display = "inline-block";
}

/*
Visualize a replay file given a JSON object
corresponding to the file.
(This is prior to the messages within the replay file,
 which are strings corresponding to JSON objects,
 being parsed.)
*/

function lerp(p1, p2, t) {
    t = Math.min(1, Math.max(0, t));
    return { x: p2.x*t + p1.x*(1-t), y: p2.y*t + p1.y*(1-t) }
}

function lerpf(v1, v2, t) {
    t = Math.min(1, Math.max(0, t));
    return v2 * t + v1 * (1 - t);
}

function vectorSub(v1, v2) {
    return { x: v2.x - v1.x, y: v2.y - v1.y }
}

function vectorRotate90(v) {
    return { x: -v.y, y: v.x }
}

function vectorNormalize(v) {
    var magn = Math.sqrt(v.x*v.x + v.y*v.y);
    return { x: v.x/magn, y: v.y/magn }
}

function clamp01(x) {
    return Math.max(0, Math.min(1, x));
}

function moveLinear(from, to, t) {
    let delta = Math.abs(to - from);
    t = Math.min(t, delta);
    t = Math.max(t, 0);
    return from + Math.sign(to - from) * t;
}

function handleLocationClick(canvas, planetName, planetWidth, planetHeight){
	var tileWidth = canvas.width/planetWidth;
	var tileHeight = canvas.height/planetHeight;
	return function(event){
		//https://stackoverflow.com/questions/55677/how-do-i-get-the-coordinates-of-a-mouse-click-on-a-canvas-element
		var rect = canvas.getBoundingClientRect();
		var x = Math.floor((event.clientX - rect.left)/tileWidth);
		var y = planetHeight-Math.floor((event.clientY - rect.top)/tileHeight)-1;
		document.getElementById('location').innerText = planetName + '[' + x + ' - ' + y + ']';
	}
}

function visualize(data) {
    activeID += 1;
    let currentID = activeID;
    // Globals
    var winner;
    var team_name = {}
    var id2team = {};
    var id2teamIndex = {};
    var maturation_times = {};
    var reserves = [[100, 100]]; // Precomped for every turn

    // Whether or not the slider is currently being held down.
    // This is used because the input event only fires
    // when the slider's value is actively changing,
    // but we want it to pause even if it is held in position.
    var slider_held = false;

    // Whether or not we're currently paused.
    var paused = false;

    // Whether we should restart the replay
    var reset = false;

    // Store team names
    team_name['Red'] = data['metadata'].player1;
    team_name['Blue'] = data['metadata'].player2;

    // Determine who won
    winner = data['metadata'].winner;
    if (winner == 'player1') winner = 'Red';
    else winner = 'Blue';

    // Parse each turn from the replay file
    data = data['message'].map(JSON.parse);
    
    // Pop off the first "turn", whic is not a turn
    // but instead an initialization object
    let world = data[0].world;
    data.shift();

    // Clear info on the winner
    document.getElementById('winner').innerText = '';

    // Get impassable squares for Earth
    var planet_maps = {
        'Earth': world.planet_maps.Earth.is_passable_terrain,
        'Mars': world.planet_maps.Mars.is_passable_terrain
    };

    // Get Karbonite data
    // We'll precomp this for every turn
    var karbonite_maps = {
        'Earth': [world.planet_maps.Earth.initial_karbonite],
        'Mars': [planet_maps['Mars'].map(function(x) { return x.map(function() { return 0; }); })]
    };

    // Get the team identities of the initial units
    // (these are not given ever again so we need to remember)
    var initial_units = world.planet_states.Earth.units
    for (var key in initial_units) {
        var unit = initial_units[key];
        id2team[unit.id] = unit.team;
        id2teamIndex[unit.id] = TEAMS.indexOf(unit.team);
    }

    // We will now precomp Karbonite data,
    // reserves data, and unit teams, to allow
    // scrubbing.
    for (var t = 0; t < data.length; t += 1) {
        // Update Karbonite reserves if necessary.
        // TODO:
        // This currently will result in updating reserves
        // _before_ being displayed for a turn.
        // If this should occur _after_ being displayed
        // for a turn instead, swap the two lines below.
        reserves[reserves.length - 1][t % 2] = data[t].karbonite;
        reserves.push(reserves[reserves.length - 1].slice(0));

        function update_for(planet) {
            // If Karbonite on the board has changed, update our current counts
            karbonite_maps[planet].push(
                karbonite_maps[planet][karbonite_maps[planet].length - 1].map(function(x) {
                    return x.slice(0);
                })
            );
            for (var i = 0; i < data[t].additional_changes.length; i += 1) {
                var change = data[t].additional_changes[i];
                if (change.KarboniteChanged != null &&
                        change.KarboniteChanged.location.planet === planet) {
                    karbonite_maps[planet][
                        karbonite_maps[planet].length - 1
                    ][
                        change.KarboniteChanged.location.y
                    ][
                        change.KarboniteChanged.location.x
                    ] = change.KarboniteChanged.new_amount;
                }
            }

            // Precomp units
            for (var i = 0; i < data[t].units.length; i += 1) {
                var unit = data[t].units[i];
                if (unit.location.planet == planet) {
                    // If this unit has never been seen before, it must
                    // have just been made. Thus it belongs to the current player.
                    if (!(unit.id in id2team)) {
                        id2team[unit.id] = TEAMS[t % 2];
                        id2teamIndex[unit.id] = t % 2;

                        // Factories, before they reach full health,
                        // are actually just blueprints
                        if (unit.unit_type == 'Factory' || unit.unit_type == 'Rocket') {
                            maturation_times[unit.id] = Infinity;
                        }
                    }

                    // Factories and rockets mature when they reach full health
                    if ((unit.unit_type == 'Factory' && unit.health == 300 ||
                            unit.unit_type == 'Rocket' && unit.health == 200) &&
                            maturation_times[unit.id] == Infinity) {
                        maturation_times[unit.id] = t;
                    }
                }
            }
        }

        update_for('Earth');
        update_for('Mars');
    }

    let unitValueByTime = [];

    // Note: need to keep up to date
    let unit_values = {
        "Worker": 50,
        "Knight": 40,
        "Ranger": 40,
        "Mage": 40,
        "Healer": 40,
        "Rocket": 150,
        "Factory": 200,
    };

    for (var t = 0; t < data.length; t += 1) {
        let values = [0, 0];
        let units = data[t].units;
        for (let i = 0; i < units.length; i++) {
            values[id2teamIndex[units[i].id]] += unit_values[units[i].unit_type];
        }
        unitValueByTime.push(values);
    }

    // set the maximum turn we could slide to
    var t = data.length - 1;
    turnsliderElement.max = (t - t % 4) / 4 + 1;

    // Convenience dimension variables
    var earth_w = planet_maps['Earth'][0].length, earth_h = planet_maps['Earth'].length;
    // Convenience dimension variables
    var mars_w = planet_maps['Mars'][0].length, mars_h = planet_maps['Mars'].length;
    
    // set canvas width / height
    earth_canvas.width = 500;
    earth_canvas.height = earth_canvas.width * earth_h / earth_w;
    
    mars_canvas.width = 500;
    mars_canvas.height = mars_canvas.width * mars_h / mars_w;

    let researchEvents = [[], []];
    for (let t = 0; t < data.length; t++) {
        let eventBuffer = researchEvents[t % 2];

        let changes = data[t].additional_changes;
        for (let i = 0; i < changes.length; i++) {
            if ("ResearchComplete" in changes[i]) {
                let item = changes[i]["ResearchComplete"];
                let buffer = eventBuffer;

                // This is currently bugged in the engine
                // Awaiting engine fix
                if ("team" in item) {
                    // Yay! The Engine has been fixed
                    buffer = researchEvents[TEAMS.indexOf(item.team)];
                }

                for (let j = 0; j < buffer.length; j++) {
                    if (buffer[j].end_turn == -1) {
                        if (buffer[j].branch != item.branch) {
                            console.log("Incorrect research was completed. Expected " + buffer[j].branch + " but got " + item.branch + ". This error will be removed once a bug in the battlecode engine is patched");
                            break;
                        }
                        buffer[j].end_turn = t;

                        // Start next research
                        for (let q = 0; q < buffer.length; q++) {
                            if (buffer[q].start_active_turn == -1 && !buffer[q].cancelled) {
                                buffer[q].start_active_turn = t;
                                break;
                            }
                        }
                        break;
                    }
                }
            }
        }

        changes = data[t].changes;
        for (let i = 0; i < changes.length; i++) {
            if (changes[i] == "ResetResearchQueue") {
                for (let j = 0; j < eventBuffer.length; j++) {
                    if (eventBuffer[j].end_turn == -1) {
                        eventBuffer[j].cancelled = true;
                        eventBuffer[j].end_turn = t;
                    }
                }
            } else if ("QueueResearch" in changes[i]) {
                let item = changes[i]["QueueResearch"];
                let anyActive = false;
                for (let j = 0; j < eventBuffer.length; j++) {
                    // Active!
                    if (eventBuffer[j].end_turn == -1) {
                        anyActive = true;
                    }
                }
                eventBuffer.push({
                    branch: item.branch,
                    start_turn: t,
                    end_turn: -1,
                    start_active_turn: anyActive ? -1 : t,
                    cancelled: false,
                });
            }
        }
    }

    // Note: may have to be updated if any balancing changes are done
    const RocketResearchTravelTimeReduction = 80;

    let rockets = [];
    for (let t = 0; t < data.length; t++) {
        let changes = data[t].changes;
        for (let i = 0; i < changes.length; i++) {
            let launch = changes[i].LaunchRocket;
            if (launch !== undefined) {
                let rocket = {
                    unitId: launch.rocket_id,
                    startTurn: t,
                    endTurn: t + 4*travel_time(t, world.orbit) + 1 - (has_research(t, "Rocket", 2, t % 2) ? RocketResearchTravelTimeReduction : 0),
                    teamIndex: t % 2,
                    location: launch.location,
                };
                rockets.push(rocket);

                if (rocket.endTurn < data.length) {
                    let expectedLandingChanges = data[rocket.endTurn].additional_changes;
                    let found = false;
                    for (let j = 0; j < expectedLandingChanges.length; j++) {
                        var landing = expectedLandingChanges[j].RocketLanding;
                        if (landing !== undefined && landing.rocket_id == launch.rocket_id) {
                            found = true;
                            break;
                        }
                    }

                    // Note: a bug was recently fixed in the engine that caused rocket research to increase the travel time instead of reduce it, that bug can cause this message to be logged.
                    if (!found) {
                        console.log("Didn't find rocket landing, start at " + rocket.startTurn + " expected landing at " + rocket.endTurn);
                    }
                } else if (rocket.endTurn/4 < 1000) {
                    console.log("Rocket should land after the game end, but before turn 1000, how is this possible?");
                }
            }
        }
    }

    function travel_time_smooth(time, orbit) {
        return orbit.center + orbit.amplitude * Math.sin((time/4+1) * (2*Math.PI / orbit.period));
    }

    function travel_time(time, orbit) {
        // Note |0 is used to round towards zero, in contrast to floor which rounds towards negative infinity
        return orbit.center + ((orbit.amplitude * Math.sin(Math.floor(time/4+1) * (2*Math.PI / orbit.period)))|0);
    }

    function has_research(time, research, level, teamIndex) {
        let lev = 0;
        for (let i = 0; i < researchEvents[teamIndex].length; i++) {
            let item = researchEvents[teamIndex][i];
            if (item.branch == research && !item.cancelled && time >= item.end_turn && item.end_turn != -1) lev++;
        }
        return lev >= level;
    }

    function test_duration() {
        let period = 200;
        let orbit = {
            amplitude: 150,
            period: period,
            center: 250,
        };
        function duration(round, orbit) {
            return Math.round(travel_time(4*round - 4, orbit));
        }
        for (let i = 0; i < 5; i++) {
            let base = period * i;
            console.assert(250 == duration(base, orbit), 250 + " == " + duration(base, orbit));
            console.assert(400 == duration(base + period / 4, orbit), 400 + " == " + duration(base + period / 4, orbit));
            console.assert(250 == duration(base + period / 2, orbit), 250 + " == " + duration(base + period / 2, orbit));
            console.assert(100 == duration(base + period * 3 / 4, orbit), 100 + " == " + duration(base + period * 3 / 4, orbit));
            console.assert(250 == duration(base + period, orbit), 250 + " == " + duration(base + period, orbit));

            let dur = duration(base + period / 8, orbit);
            console.assert(dur > 250 && dur < 400);
        }
    }

    test_duration();

    function render_planet_background(t, planet, ctx) {
        // Convenience dimension variables
        var w = planet_maps[planet][0].length, h = planet_maps[planet].length;

        // This is used to invert the y-axis
        function flipY(oy) { return (h - oy - 1); }

        // Draw background
        if (planet == 'Mars') {
            ctx.fillStyle = "#e4cdc0";
        } else {
            ctx.fillStyle = "#FFF";
        }
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

        // Draw the map
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";

        let karbonite_at_tick = karbonite_maps[planet][t];

        for (var i = 0; i < h; i++) {
            for (var j = 0; j < w; j++) {
                // Flip along y-axis
                var px = j, py = flipY(i);

                var impassable = !planet_maps[planet][i][j];
                var karbs = karbonite_at_tick[i][j] > 0;

                if (impassable || karbs) {
                    ctx.beginPath();
                    // Draw a rect. It is 1 pixel larger than the tile to avoid graphical artifacts at the borders between tiles
                    ctx.rect(px * (ctx.canvas.width / w) - 0.5, py * (ctx.canvas.height / h) - 0.5,
                             ctx.canvas.width / w + 0.5, ctx.canvas.height / h + 0.5);

                    // Black out impassable squares
                    if (impassable) {
                        if (planet == 'Mars') {
                            ctx.fillStyle = '#5d1e10';
                        } else {
                            ctx.fillStyle = '#306796';
                        }

                        ctx.fill();
                    }

                    if (karbs) {
                        // Write amount of Karbonite at location
                        ctx.globalAlpha = (karbonite_at_tick[i][j] > 0 ? 0.2 : 0.0) + 0.6 * (karbonite_at_tick[i][j] / 50);
                        ctx.fillStyle = '#337';
                        ctx.fill();
                        ctx.globalAlpha = 1.0;
                        ctx.fillStyle = '#888';
                        ctx.fillText(karbonite_at_tick[i][j].toString(),
                                (px + 0.5) * (ctx.canvas.width / w), (py + 0.5) * ctx.canvas.height / h + 2);
                    }
                }
            }
        }

        ctx.strokeStyle = "rgba(0,0,0,0.1)";
        ctx.lineWidth = 1;

        // Draw grid lines
        for (var y = 0; y < h; y++) {
            ctx.beginPath();
            ctx.moveTo(0, y * (ctx.canvas.height / h));
            ctx.lineTo(ctx.canvas.width, y * (ctx.canvas.height / h));
            ctx.stroke();
        }
        for (var x = 0; x < h; x++) {
            ctx.beginPath();
            ctx.moveTo(x * (ctx.canvas.width / w), 0);
            ctx.lineTo(x * (ctx.canvas.width / w), ctx.canvas.height);
            ctx.stroke();
        }
    }

    const DamageTime = 0.7;
    const MoveFinishedTime = 0.8;
    const OverchargeTime = 0.4;

    function render_units(t, fractional_t, planet, ctx, unit_locations, unit_types, prevUnits, unit_count) {
        // Convenience dimension variables
        var w = planet_maps[planet][0].length, h = planet_maps[planet].length;

        // This is used to invert the y-axis
        function flipY(oy) { return (h - oy - 1); }

        let units = data[t].units;
        for (var i = 0; i < units.length; i += 1) {
            var unit = units[i];

            var prevUnit = prevUnits[unit.id];
            if (prevUnit === undefined) prevUnit = unit;

            let interpLocation = lerp(prevUnit.location, unit.location, fractional_t / MoveFinishedTime);
            unit_locations[unit.id] = [interpLocation.x, interpLocation.y, unit.location.planet];
            unit_types[unit.id] = unit.unit_type;

            if (unit.location.planet == planet) {
                // Increment unit_count for the scoreboard
                unit_count[id2team[unit.id]][unit.unit_type]++;

                // Render the unit in the correct color.

                // Blueprints will be given an alpha
                if ((unit.unit_type === "Factory" || unit.unit_type === "Rocket") &&
                        maturation_times[unit.id] > t) {
                    ctx.globalAlpha = 0.5;
                }

                let unitTypeStyle = "";
                // The border of the square will represent the unit type.
                switch (unit.unit_type) {
                    case "Worker":
                        // Workers will be yellow, because whatever.
                        unitTypeStyle = '#FF0'; break;
                    case "Knight":
                        // Knights will be some kind of maroon
                        unitTypeStyle = '#800'; break;
                    case "Ranger":
                        // Rangers will be some kind of dark green
                        unitTypeStyle = '#080'; break;
                    case "Mage":
                        // Rangers will be some kind of dark blue
                        unitTypeStyle = '#008'; break;
                    case "Healer":
                        // Healers will be some kind of purple
                        unitTypeStyle = '#808'; break;
                    case "Factory":
                        // Factories will be gray
                        unitTypeStyle = '#000'; break;
                    case "Rocket":
                        // Rockets
                        unitTypeStyle = '#000'; break;
                    default:
                        // Unimplemented unit type
                        unitTypeStyle = '#FFF';
                }

                // Flip along the y-axis for drawing.
                // This is because canvas is top-left based.
                var px = interpLocation.x;
                var py = flipY(interpLocation.y);

                // The inside of the square represents the team allegiance
                // and also health

                if (fractional_t > DamageTime) {
                    health = lerpf(prevUnit.health, unit.health, (fractional_t - DamageTime)/(1 - DamageTime)) / MAX_HEALTHS[unit.unit_type];
                } else {
                    health = prevUnit.health / MAX_HEALTHS[unit.unit_type];
                }

                if (unit.unit_type == "Factory") {
                    // Fill the border
                    ctx.fillStyle = unitTypeStyle;
                    ctx.fillRect(
                        px * ctx.canvas.width / w, py * ctx.canvas.height / h,
                        ctx.canvas.width / w, ctx.canvas.height / h
                    )

                    ctx.fillStyle = '#FFF';
                    ctx.fillRect(
                        (px + BORDER_WIDTH) * ctx.canvas.width / w, (py + BORDER_WIDTH) * ctx.canvas.height / h,
                        (1 - 2 * BORDER_WIDTH) * ctx.canvas.width / w, (1 - 2 * BORDER_WIDTH) * ctx.canvas.height / h
                    );
                    ctx.fillStyle = ctx.strokeStyle = TEAM_COLOR[id2team[unit.id]];
                    ctx.lineWidth = 1;
                    ctx.strokeRect(
                        (px + BORDER_WIDTH) * ctx.canvas.width / w, (py + BORDER_WIDTH) * ctx.canvas.height / h,
                        (1 - 2 * BORDER_WIDTH) * ctx.canvas.width / w, (1 - 2 * BORDER_WIDTH) * ctx.canvas.height / h
                    );
                    ctx.fillRect(
                        (px + BORDER_WIDTH) * ctx.canvas.width / w,
                        (py + BORDER_WIDTH + (1 - 2 * BORDER_WIDTH) * (1 - health)) * ctx.canvas.height / h,
                        (1 - 2 * BORDER_WIDTH) * ctx.canvas.width / w,
                        (1 - 2 * BORDER_WIDTH) * health * ctx.canvas.height / h
                    );
                } else {
                    var cx = (px + 0.5) * ctx.canvas.width / w;
                    var cy = (py + 0.5) * ctx.canvas.height / h;
                    var radius = 0.3 * ctx.canvas.width / w;

                    let lineWidthMultiplier = 20 / w;
                    ctx.beginPath();
                    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
                    ctx.strokeStyle = TEAM_COLOR[id2team[unit.id]];
                    ctx.lineWidth = 6 * lineWidthMultiplier;
                    ctx.stroke();

                    if (health < 1) {
                        ctx.fillStyle = "#FFF";
                        ctx.beginPath();
                        ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
                        ctx.fill();
                    }

                    ctx.fillStyle = unitTypeStyle;
                    ctx.beginPath();
                    // Fill from bottom to top. Don't let angle be exactly Math.PI or
                    // rounding error can cause the circle not to fill at all.
                    let angle = Math.asin((health * 2 - 1) * (1 - 1e-3));
                    //ctx.arc(cx, cy, radius, Math.PI * 0.5, -angle, true);
                    //ctx.arc(cx, cy, radius, Math.PI + angle, Math.PI * 0.5, true);
                    ctx.arc(cx, cy, radius, Math.PI + angle, -angle, true);

                    // Radial health
                    // ctx.arc(cx, cy, health * radius, 0, 2 * Math.PI);
                    ctx.fill();

                    if (unit.unit_type == "Rocket") {
                        // Draw how many units are inside
                        // ctx.fillStyle = '#888';
                        // ctx.fillText(karbonite_at_tick[i][j].toString(),
                        //         (px + 0.4) * (500 / w), (py + 0.6) * 500 / h);
                    }
                }

                ctx.globalAlpha = 1;
            }
        }
    }

    function render_attacks(t, fractional_t, planet, ctx, unit_locations, unit_types, prevUnits) {
        // Convenience dimension variables
        var w = planet_maps[planet][0].length, h = planet_maps[planet].length;

        // This is used to invert the y-axis
        function flipY(oy) { return (h - oy - 1); }

        let attacksByUnit = {};

        // Render attacks
        // (these are technically made the next turn,
        //  but are rendered this turn for ease of viewing)
        for (var i = 0; i < data[t].changes.length; i += 1) {
            var change = data[t].changes[i];

            // Required to avoid exceptions when trying to use the 'in' operator.
            // It will not work on the 'ResetResearchQueue' event which is a string, not an object.
            if (typeof change !== 'object') continue;

            let target = null;
            let robot = null;
            let isAbility = false;

            if ('Overcharge' in change) {
                let heal = change['Overcharge'];
                target = heal.target_robot_id;
                robot = heal.healer_id;
                isAbility = true;
            }

            if ('Attack' in change) {
                let attack = change['Attack'];
                target = attack.target_unit_id;
                robot = attack.robot_id;
            }

            if ('Heal' in change) {
                let heal = change['Heal'];
                target = heal.target_robot_id;
                robot = heal.healer_id;
            }

            if (robot != null) {
                if (unit_locations[target][2] != planet || unit_locations[robot][2] != planet)
                    continue;

                // Store positions.
                // While we do this we flip the y-axis
                // for rendering to the canvas.
                var rpos = {
                    x: unit_locations[robot][0],
                    y: flipY(unit_locations[robot][1])
                };

                var tpos = {
                    x: unit_locations[target][0],
                    y: flipY(unit_locations[target][1])
                };

                if (!(robot in attacksByUnit)) {
                    attacksByUnit[robot] = 0;
                }

                let previousAttacks = attacksByUnit[robot];
                attacksByUnit[robot] = previousAttacks + 1;

                let attackTime = fractional_t;
                if (!isAbility) {
                    // Will modify time to make later attacks happen later during the frame
                    // Will still happen during 0...1
                    attackTime = clamp01(1 - (1 - attackTime) * (previousAttacks + 1));
                }

                if (unit_types[robot] == 'Ranger') {
                    var interPos1 = lerp(rpos, tpos, (attackTime - 0.3) / DamageTime);
                    var interPos2 = lerp(rpos, tpos, (attackTime) / DamageTime);

                    ctx.strokeStyle = ATTACK_COLOR[id2team[robot]];
                    ctx.lineWidth = 5;
                    ctx.beginPath();
                    ctx.moveTo(
                        (interPos1.x + 0.5) * ctx.canvas.width / w,
                        (interPos1.y + 0.5) * ctx.canvas.height / h);
                    ctx.lineTo(
                        (interPos2.x + 0.5) * ctx.canvas.width / w,
                        (interPos2.y + 0.5) * ctx.canvas.height / h);
                    ctx.stroke();

                    if (attackTime > DamageTime && attackTime < DamageTime + 0.1) {
                        let size = (attackTime - DamageTime)/0.1;
                        ctx.beginPath();
                        ctx.arc(
                            (tpos.x + 0.5) * ctx.canvas.width / w,
                            (tpos.y + 0.5) * ctx.canvas.height / h,
                            size * HEAD_SIZE * ctx.canvas.width / w,
                            // size * HEAD_SIZE * ctx.canvas.height / h,
                            0,
                            2 * Math.PI
                        );
                        ctx.fillStyle = '#F0F';
                        ctx.fill();
                    }
                } else if (unit_types[robot] == 'Healer') {
                    if (isAbility) {
                        // Overcharge!
                        var t0 = (attackTime - 0.3) / OverchargeTime;
                        var t1 = (attackTime) / OverchargeTime;
                        var interPos1 = lerp(rpos, tpos, t0);
                        var interPos2 = lerp(rpos, tpos, t1);

                        ctx.strokeStyle = "#12e5ca";
                        ctx.lineWidth = 3;
                        ctx.beginPath();


                        let normal = vectorNormalize(vectorRotate90(vectorSub(interPos2, interPos1)));
                        for (let i = 0; i <= 20; i++) {
                            let tx = lerpf(t0, t1, i * 0.05);
                            let p = lerp(rpos, tpos, tx);
                            let offset = 0.05 * Math.sin(tx * 30);
                            p.x += normal.x * offset;
                            p.y += normal.y * offset;
                            if (i == 0) ctx.moveTo((p.x + 0.5) * ctx.canvas.width / w, (p.y + 0.5) * ctx.canvas.height / h);
                            else ctx.lineTo((p.x + 0.5) * ctx.canvas.width / w, (p.y + 0.5) * ctx.canvas.height / h);
                        }

                        ctx.stroke();

                        let effectEnd = 0.9;
                        let effectStart = 0.1;
                        if (attackTime > 0.1 && attackTime < 0.9) {
                            let tposx = (tpos.x + 0.5) * ctx.canvas.width / w;
                            let tposy = (tpos.y + 0.5) * ctx.canvas.height / h;
                            ctx.beginPath();
                            let lines = 9;
                            let innerRadius = 0.5;
                            let outerRadius = 0.8 + attackTime * 0.2;
                            let angleOffset = attackTime * 0.5 * Math.PI;
                            for (let i = 0; i < 9; i++) {
                                let angle = (i / lines) * 2 * Math.PI;
                                ctx.moveTo(tposx + innerRadius * Math.cos(angle + angleOffset) * (ctx.canvas.width / w),
                                           tposy + innerRadius * Math.sin(angle + angleOffset) * (ctx.canvas.height / h));
                                ctx.lineTo(tposx + outerRadius * Math.cos(angle + angleOffset) * (ctx.canvas.width / w),
                                           tposy + outerRadius * Math.sin(angle + angleOffset) * (ctx.canvas.height / h));
                            }
                            ctx.strokeStyle = "#12e5ca";
                            ctx.lineWidth = 2;
                            ctx.globalAlpha = clamp01((effectEnd - attackTime) / 0.1);
                            ctx.stroke();
                            ctx.globalAlpha = 1.0;
                        }
                    } else {
                        // Heal
                        var t0 = (attackTime - 0.3) / DamageTime;
                        var t1 = (attackTime) / DamageTime;
                        var interPos1 = lerp(rpos, tpos, t0);
                        var interPos2 = lerp(rpos, tpos, t1);

                        ctx.strokeStyle = HEAL_COLOR[id2team[robot]];
                        ctx.lineWidth = 3;
                        ctx.beginPath();

                        let normal = vectorNormalize(vectorRotate90(vectorSub(interPos2, interPos1)));
                        for (let i = 0; i <= 20; i++) {
                            let tx = lerpf(t0, t1, i * 0.05);
                            let p = lerp(rpos, tpos, tx);
                            let offset = 0.05 * Math.sin(tx * 30);
                            p.x += normal.x * offset;
                            p.y += normal.y * offset;
                            if (i == 0) ctx.moveTo((p.x + 0.5) * ctx.canvas.width / w, (p.y + 0.5) * ctx.canvas.height / h);
                            else ctx.lineTo((p.x + 0.5) * ctx.canvas.width / w, (p.y + 0.5) * ctx.canvas.height / h);
                        }

                        ctx.stroke();

                        if (attackTime > DamageTime && attackTime < DamageTime + 0.1) {
                            let size = (attackTime - DamageTime)/0.1;
                            ctx.beginPath();
                            ctx.arc(
                                (tpos.x + 0.5) * ctx.canvas.width / w,
                                (tpos.y + 0.5) * ctx.canvas.height / h,
                                size * HEAD_SIZE * ctx.canvas.width / w,
                                // size * HEAD_SIZE * ctx.canvas.height / h,
                                0,
                                2 * Math.PI
                            );
                            ctx.fillStyle = '#F0F';
                            ctx.fill();
                        }
                    }

                } else if (unit_types[robot] == 'Knight') {
                    var interPos1 = lerp(rpos, tpos, (attackTime - 0.3) / DamageTime);
                    var interPos2 = lerp(rpos, tpos, (attackTime) / DamageTime);

                    ctx.strokeStyle = ATTACK_COLOR[id2team[robot]];
                    ctx.lineWidth = 5;
                    ctx.beginPath();
                    ctx.moveTo(
                        (interPos1.x + 0.5) * ctx.canvas.width / w,
                        (interPos1.y + 0.5) * ctx.canvas.height / h);
                    ctx.lineTo(
                        (interPos2.x + 0.5) * ctx.canvas.width / w,
                        (interPos2.y + 0.5) * ctx.canvas.height / h);
                    ctx.stroke();

                    if (attackTime > DamageTime && attackTime < DamageTime + 0.1) {
                        let size = (attackTime - DamageTime)/0.1;
                        ctx.beginPath();
                        ctx.arc(
                            (tpos.x + 0.5) * ctx.canvas.width / w,
                            (tpos.y + 0.5) * ctx.canvas.height / h,
                            size * HEAD_SIZE * ctx.canvas.width / w,
                            // size * HEAD_SIZE * ctx.canvas.height / h,
                            0,
                            2 * Math.PI
                        );
                        ctx.fillStyle = '#F0F';
                        ctx.fill();
                    }
                } else if (unit_types[robot] == 'Mage') {
                    var interPos1 = lerp(rpos, tpos, (attackTime - 0.3) / DamageTime);
                    var interPos2 = lerp(rpos, tpos, (attackTime) / DamageTime);

                    ctx.strokeStyle = ATTACK_COLOR[id2team[robot]];
                    ctx.lineWidth = 5;
                    ctx.beginPath();
                    ctx.moveTo(
                        (interPos1.x + 0.5) * ctx.canvas.width / w,
                        (interPos1.y + 0.5) * ctx.canvas.height / h);
                    ctx.lineTo(
                        (interPos2.x + 0.5) * ctx.canvas.width / w,
                        (interPos2.y + 0.5) * ctx.canvas.height / h);
                    ctx.stroke();

                    if (attackTime > DamageTime && attackTime < DamageTime + 0.1) {
                        let size = (attackTime - DamageTime)/0.1;
                        ctx.beginPath();
                        ctx.arc(
                            (tpos.x + 0.5) * ctx.canvas.width / w,
                            (tpos.y + 0.5) * ctx.canvas.height / h,
                            size * HEAD_SIZE * ctx.canvas.width / w,
                            // size * HEAD_SIZE * ctx.canvas.height / h,
                            0,
                            2 * Math.PI
                        );
                        ctx.fillStyle = '#F0F';
                        ctx.fill();
                    }

                    // Render splash damage from mages
                    if (attackTime > DamageTime - 0.1 && attackTime < DamageTime + 0.05) {
                        for (var dx = -1; dx <= 1; dx += 1) {
                            for (var dy = -1; dy <= 1; dy += 1) {
                                ctx.strokeStyle = '#F0F';
                                ctx.lineWidth = 5;
                                ctx.beginPath();
                                ctx.moveTo(
                                    (tpos.x + 0.5) * ctx.canvas.width / w,
                                    (tpos.y + 0.5) * ctx.canvas.height / h);
                                ctx.lineTo(
                                    (tpos.x + 0.5 + dx) * ctx.canvas.width / w,
                                    (tpos.y + 0.5 + dy) * ctx.canvas.height / h);
                                ctx.stroke();
                            }
                        }
                    }
                } else {
                    console.log("Unknown attack type for " + unit_types[robot]);
                    // ???
                }
            }
        }
    }

    function render_rocket_landings(t, ctx, canvas) {
        // Convenience dimension variables
        var w = mars_w, h = mars_h;

        // This is used to invert the y-axis
        function flipY(oy) { return (h - oy - 1); }

        const effectDurations = [4*18, 4*5];
        const effectOffsets = [4*5, 4*2];
        const effectRadii = [1.5, 1];
        for (let i = 0; i < rockets.length; i++) {
            const rocket = rockets[i];
            for (let k = 0; k < 2; k++) {
                const effectDuration = effectDurations[k];
                const effectOffset = effectOffsets[k];
                const effectRadius = effectRadii[k];
                if (t >= rocket.endTurn - effectDuration + effectOffset && t < rocket.endTurn + effectOffset) {
                    ctx.save();
                    ctx.translate((rocket.location.x + 0.5) * 500 / mars_w, (flipY(rocket.location.y) + 0.5) * 500 / mars_h);
                    ctx.fillStyle = "#8b3c0d";
                
                    const relativeTime = 1 - (rocket.endTurn + effectOffset - t) / effectDuration;
                    for (let j = 0; j < 10; j++) {
                        // const rad = (j+1) * (relativeTime - 1 + 1 / (j + 1));
                        const rad = Math.pow(j+1, 0.4) * ( relativeTime - (j+1) / 10)
                        if (rad > 0) {
                            //const rad2 = Math.pow(j+1, 0.8) * (relativeTime - 1 + 1 / (j + 1));
                            ctx.beginPath();
                            ctx.arc(0, 0, rad * effectRadius * (500 / mars_w), 0, 2 * Math.PI);
                            if (j == 0) {
                                ctx.globalCompositeOperation = "multiply";
                            } else {
                                ctx.globalCompositeOperation = "lighter";
                            }
                            ctx.globalAlpha = clamp01(2*(1 - Math.pow(relativeTime, 0.5)));
                            ctx.fill();
                        }
                    }
                    ctx.restore();
                }
            }
        }
    }

    // Now, to render an animation frame:
    function render_planet(t, fractional_t, planet, ctx, canvas, unit_count) {
        // Convenience dimension variables
        var w = planet_maps[planet][0].length, h = planet_maps[planet].length;

        // This is used to invert the y-axis
        function flipY(oy) { return (h - oy - 1); }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        render_planet_background(t, planet, ctx);
        if (planet == "Mars") render_rocket_landings(t + fractional_t, ctx, canvas);

        // Render units
        var unit_locations = {};
        var unit_types = {};
        let prevUnits = {}
        if (t > 0) {
            for (var i = 0; i < data[t - 1].units.length; i += 1) {
                var unit = data[t - 1].units[i];
                unit_locations[unit.id] = [unit.location.x, unit.location.y, unit.location.planet];
                prevUnits[unit.id] = unit;
            }
        }

        render_units(t, fractional_t, planet, ctx, unit_locations, unit_types, prevUnits, unit_count);
        render_attacks(t, fractional_t, planet, ctx, unit_locations, unit_types, prevUnits);
    }

    function render_graph(ctx, label, values, time, x, y, w, h, colors) {
        ctx.save();

        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.fillStyle = "#222";
        ctx.strokeStyle = "#000";
        ctx.fill();

        function remapx(_x) {
            return _x * w + x;
        }

        function remapy(_y) {
            return (1 - _y) * h + y;
        }

        if (values.length == 0) return;

        let mx = 0;
        let categories = values[0].length;
        for (let i = 0; i < values.length; i++) {
            for (let j = 0; j < categories; j++) {
                mx = Math.max(mx, values[i][j]);
            }
        }

        colors = colors || ["rgba(228,26,28, 0.8)", "rgba(55,126,184, 0.8)"];

        mx *= 1.2;

        for (let j = 0; j < categories; j++) {
            ctx.beginPath();
            ctx.moveTo(remapx(0), remapy(values[0][j] / mx));
            for (let i = 1; i < values.length; i += 4) {
                let px = i / (values.length - 1);
                ctx.lineTo(remapx(px), remapy(values[i][j] / mx));
            }
            ctx.strokeStyle = colors[j]; // TEAM_COLOR[TEAMS[j]];
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        ctx.beginPath();
        ctx.moveTo(remapx(time / values.length), y);
        ctx.lineTo(remapx(time / values.length), y + h);
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.stroke();

        ctx.textBaseline = "top";
        ctx.textAlign = "center";
        ctx.fillStyle = "#FFF";
        ctx.font = '1.2em Roboto';
        ctx.fillText("" + label, x + w/2, y + 12);
        ctx.restore();
    }

    let TeamResearchColors = ["#e41a1c", "#377eb8"];
    let TeamResearchColorsAccent = ["#870f11", "#25567d"];
    function render_research_team(time, ctx, team, team_events, x, UIdt) {
        let y = 2;
        let height = 48;
        let width = 90;

        for (let i = 0; i < team_events.length; i++) {
            let item = team_events[i];
            let time_to_start = item.start_turn - time;
            let time_to_end = item.end_turn - time;
            if (item.end_turn == -1) time_to_end = 1000;

            let alpha1 = Math.max(0, Math.min(1, 1 - (time_to_start)));
            let alpha2 = Math.max(0, Math.min(1, (time_to_end + 1)));
            if (!item.cancelled) alpha2 = 1;

            if (item.ui_alpha == undefined) {
                item.ui_alpha = 0;
            }

            let alpha = alpha1 * alpha2;
            item.ui_alpha = moveLinear(item.ui_alpha, alpha, (1 + 2/(i+1)) * UIdt);
            alpha = item.ui_alpha;
            if (alpha > 0.001) {

                let level = 1;
                for (let j = 0; j < i; j++) {
                    // Check if visible
                    if (time < team_events[j].start_turn) continue;
                    if (team_events[j].cancelled && time >= team_events[j].end_turn) continue;

                    if (team_events[j].branch == item.branch) level++;
                }

                ctx.globalAlpha = alpha;
                let fractionCompleted = item.cancelled || item.start_active_turn == -1 || item.end_turn == -1 ? 0 : 1 - (time_to_end / (item.end_turn - item.start_active_turn));
                fractionCompleted = Math.max(0, Math.min(1, fractionCompleted));

                ctx.fillStyle = TeamResearchColors[team];
                ctx.beginPath();
                ctx.rect(x, y, width, alpha2 * height);
                ctx.lineWidth = 4;
                ctx.strokeStyle = TeamResearchColorsAccent[team];
                ctx.fill();
                ctx.stroke();

                let img = classIcons[item.branch];
                let iconW = 30;
                let iconH = 30;
                ctx.drawImage(img, x + 10, y + height/2 - iconH/2, iconW, iconH);

                if (fractionCompleted >= 1) {
                    ctx.fillStyle = "#fff17c";
                } else {
                    ctx.fillStyle = '#FFF';
                }
                ctx.textBaseline = "middle";
                ctx.textAlign = "center";
                ctx.font = '1.5em Roboto';
                ctx.fillText("" + level, x + width - 24, y + height/2 + 3);

                ctx.beginPath();
                ctx.fillStyle = "rgba(0,0,0,0.2)"
                ctx.rect(x, y, width, height * alpha2 * (1 - fractionCompleted));
                ctx.fill();

                y += height * alpha2;
                ctx.globalAlpha = 1.0;
            }
        }
        
    }

    function render_research(time, ctx, UIdt) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        render_research_team(time, ctx, 0, researchEvents[0], 118, UIdt);
        render_research_team(time, ctx, 1, researchEvents[1], 118 + 90, UIdt);
    }

    

    function render_space_travel(time, ctx) {
        let max_travel = world.orbit.center + world.orbit.amplitude;
        let min_travel = world.orbit.center - world.orbit.amplitude;

        const marsFactor = 0.75;
        const earthFactor = 0.1;
        let planetEarthX = travel_time_smooth(time, world.orbit) * (earthFactor - marsFactor) / max_travel + marsFactor;
        let planetMarsX = marsFactor;

        planetEarthX *= ctx.canvas.width;
        planetMarsX *= ctx.canvas.width;
        let y = 50;
        let planetRadius = 20;

        ctx.save();
        ctx.fillStyle = "#377eb8";
        ctx.strokeStyle = "#0065b8";
        ctx.beginPath();
        ctx.arc(planetEarthX - planetRadius, y, planetRadius, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#cb6430";
        ctx.strokeStyle = "#cb4400";
        ctx.beginPath();
        ctx.arc(planetMarsX + planetRadius, y, planetRadius, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();

        for (let i = 0; i < rockets.length; i++) {
            const rocket = rockets[i];
            const fadeoutTime = 10;
            if (time > rocket.startTurn && time < rocket.endTurn + fadeoutTime) {
                let fractionCompleted = (time - rocket.startTurn) / (rocket.endTurn - rocket.startTurn);
                fractionCompleted = clamp01(fractionCompleted);

                // Remap to make the rocket slow down slightly at the end of the path
                const slowdown = 0.1;
                fractionCompleted = (fractionCompleted - slowdown*Math.pow(fractionCompleted, 1 / slowdown)) / (1 - slowdown);

                let maxYOffset = 20;
                if (rocket.teamIndex == 1) maxYOffset *= -1;
                const yOffset = maxYOffset * 4*fractionCompleted*(1-fractionCompleted);
                const travelDistanceInPixels = travel_time(rocket.startTurn, world.orbit)/max_travel * ctx.canvas.width * (marsFactor - earthFactor);
                const distanceFromMarsInPixels = (1 - fractionCompleted) * travelDistanceInPixels;
                const yVelocity = (maxYOffset * 4 * (1 - 2*fractionCompleted));
                const xVelocity = travelDistanceInPixels;

                let angle = Math.atan2(yVelocity, xVelocity);

                let img = rocketIcons[rocket.teamIndex];
                let iconW = 40;
                let iconH = iconW * img.height / img.width;

                angle += Math.PI * (Math.tanh(30*(fractionCompleted - 0.8))+1)/2;
                ctx.save();
                ctx.translate(planetMarsX - distanceFromMarsInPixels, y + yOffset);
                ctx.rotate(angle);
                ctx.globalAlpha = clamp01(1 - (time - rocket.endTurn)/fadeoutTime);
                ctx.shadowBlur = 3;
                ctx.shadowColor = "#000";
                ctx.drawImage(img, -iconW/2, -iconH/2, iconW, iconH);
                ctx.restore();
            }
        }

        ctx.beginPath();
        ctx.moveTo(planetMarsX, 20);
        ctx.lineTo(planetEarthX, 20);
        ctx.setLineDash([5,5]);
        ctx.strokeStyle = "#CCC";
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#CCC";
        ctx.strokeStyle = "#222";
        ctx.lineWidth = 10;
        ctx.font = '14px Roboto';
        ctx.strokeText("" + travel_time(time, world.orbit), (planetMarsX + planetEarthX)/2, 20 + 1);
        ctx.fillText("" + travel_time(time, world.orbit), (planetMarsX + planetEarthX)/2, 20 + 1);
        ctx.restore();
    }

    function render_graphs(time, ctx) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        let width = ctx.canvas.width;
        render_graph(ctx, "Karbonite", reserves, time, 0, 100, 490, 150);
        render_graph(ctx, "Total unit value", unitValueByTime, time, width - 490, 100, 490, 150);
        render_space_travel(time, ctx);
    }

    let lastTime = performance.now() * 0.001;
    let realtime = 0;
    let first = true;

    function render(timestamp) {
        // Another map has been loaded, don't render anymore
        if (currentID != activeID) return;
        if (first) {
            first = false;
            lastTime = timestamp;
        }

        let dt = timestamp * 0.001 - lastTime;
        // ?? Apparently might happen at the first frame
        if (dt < 0) dt = 0;

        lastTime = timestamp * 0.001;
        let UIdt = dt;
        if (slider_held || paused) {
            dt = 0;
            // Make UI progress very quickly to reach the final state in their animations
            UIdt = 10;
        }
        realtime += dt * 1/(timeout * 0.001);
        if (reset) {
            realtime = 0;
            reset = false;
        }

        realtime = Math.max(0, Math.min(realtime, data.length - 1));
        const ti = Math.floor(realtime);

        var earth_unit_count = {};
        var mars_unit_count = {};

        for (var i = 0, team; team = TEAMS[i]; i++) {
            earth_unit_count[team] = {};
            mars_unit_count[team] = {};
            for (var j = 0, unit_class; unit_class = UNIT_CLASSES[j]; j++) {
                earth_unit_count[team][unit_class] = 0;
                mars_unit_count[team][unit_class] = 0;
            }
        }

        render_planet(ti, realtime - ti, 'Earth', earth_ctx, earth_canvas, earth_unit_count);
        render_planet(ti, realtime - ti, 'Mars', mars_ctx, mars_canvas, mars_unit_count);
        render_graphs(realtime, graph_ctx);
        render_research(realtime, research_ctx, UIdt);

        let turn = (ti - ti % 4) / 4 + 1;
        if (!slider_held) {
            // This sets the value of the slider to the current turn.
            // Note: Turn number should be 1-indexed when displayed.
            turnsliderElement.value = turn;
        }

        // Render Karbonite reserves and turn number
        turnElement.innerText = turn.toString();
        document.getElementById('red_karbonite').innerText = reserves[ti][0].toString();
        document.getElementById('blue_karbonite').innerText = reserves[ti][1].toString();

        // Render unit count for each team
        for (var i = 0, team; team = TEAMS[i]; i++) {
            for (var j = 0, unit_class; unit_class = UNIT_CLASSES[j]; j++) {
                teamUnitCountElements[i][j].innerText = earth_unit_count[team][unit_class] + ' // ' + mars_unit_count[team][unit_class];
            }
        }

        if (ti < data.length - 1) {
            // document.getElementById('winner').innerText = '';
        } else {
            // It's the end
            var name = ' (' + team_name[winner] + ')';
            if (!team_name[winner]) name = '';
            turnElement.innerText = winner + name + ' wins at turn ' + turn + '!';
            turnElement.style.color = TEAM_COLOR[winner];

        }

        // Schedule next animation frame
        window.requestAnimationFrame(render);
    }

    // A bunch of slider + button event handlers
    // Remove the ones from the previous visualization
    turnsliderElement.removeEventListener('input', input_listener);
    turnsliderElement.removeEventListener('mousedown', mousedown_listener);
    turnsliderElement.removeEventListener('mouseup', mouseup_listener);

    let pause = () => {
        document.getElementById('pause').style.display='none';
        document.getElementById('play').style.display='inline-block';
        paused = true;
    }

    turnsliderElement.addEventListener('input', input_listener = function(e) {
        // Render the first value of t represented by the given turn
        realtime = (this.value - 1) * 4;
    });

    turnsliderElement.addEventListener('mousedown', mousedown_listener = function(e) {
        slider_held = true;
    });

    turnsliderElement.addEventListener('mouseup', mouseup_listener = function(e) {
        slider_held = false;
    });
    
    document.getElementById('move_to_start').addEventListener('click', function(e) {
        reset = true;
    });
    document.getElementById('move_to_end').addEventListener('click', function(e) {
        realtime = data.length;
    });

    const singleStepAnimationSpeed = 3;

    document.getElementById('move_prev').addEventListener('click', function(e) {
        let targetTime = Math.round(realtime/4)*4 - 4;
        let prevTime = 0;
        f = (t) => {
            if (prevTime === 0) prevTime = t;
            let dt = t - prevTime;
            prevTime = t;

            realtime -= singleStepAnimationSpeed*4*0.001*dt;
            if (realtime <= targetTime) {
                realtime = targetTime + 0.001;
            } else {
                requestAnimationFrame(f);
            }
        }
        pause();
        requestAnimationFrame(f);
    });

    document.getElementById('move_next').addEventListener('click', function(e) {
        let targetTime = Math.round(realtime/4)*4 + 4;
        let prevTime = 0;
        f = (t) => {
            if (prevTime === 0) prevTime = t;
            let dt = t - prevTime;
            prevTime = t;

            realtime += singleStepAnimationSpeed*4*0.001*dt;
            if (realtime >= targetTime) {
                realtime = targetTime - 0.001;
            } else {
                requestAnimationFrame(f);
            }
        }
        pause();
        requestAnimationFrame(f);
    });

    document.getElementById('pause').addEventListener('click', function(e) {
        pause();
    });
    document.getElementById('play').addEventListener('click', function(e) {
        document.getElementById('pause').style.display='inline-block';
        document.getElementById('play').style.display='none';
        paused = false;
    });
    
    earth_canvas.addEventListener('click', handleLocationClick(earth_canvas, 'EARTH', earth_w, earth_h));
    mars_canvas.addEventListener('click', handleLocationClick(mars_canvas, 'MARS', mars_w, mars_h));

    // We're about to render, so let's force unpause.
    paused = false;
    document.getElementById('pause').style.display='inline-block';
    document.getElementById('play').style.display='none';

    window.requestAnimationFrame(render);
}

// Pressing "enter" on the input starts the request for the replay.
document.getElementById('fname').addEventListener('keydown', function(e) {
    if (e.which === 13) {
        var path = this.value;

        // Request the replay file
        var q = new XMLHttpRequest();
        q.open('GET', path, true);
        document.getElementById('loading').innerText = 'Loading...';

        // Replay file arrives -- callback:
        q.onreadystatechange = function() {
            if (q.readyState == XMLHttpRequest.DONE) {
                document.getElementById('loading').innerText = 'Done.';

                // Parse replay file
                var data = JSON.parse(q.responseText);
                visualize(data);
            }
        };

        q.send();
    }
});

// Selecting a file triggers replay visualization
document.getElementById('ffile').addEventListener('change', function(e) {
    var file = this.files[0];

    // Is the file gzipped?
    if (file.name.indexOf('.bc18z') !== -1) {
       handleGzippedReplay(file);
    }
    else if (file.name.indexOf('.bc18') !== -1){
       handleUnzippedReplay(file,false);
    }
    else {
       handleUnzippedReplay(file,true);
    }
});

function handleGzippedReplay(file){
    console.log('Handling gzipped replay');
    var reader = new FileReader();

    // FileReader loads -- callback:
    reader.onload = function(e) {
        var array = new Uint8Array(reader.result);

        try {
            // Parse replay file
            var data = JSON.parse(pako.inflate(array, {to: 'string'}));

            visualize(data);
        }
        catch (err) {
            alert('Could not decompress gzipped .bc18z file.');
        }

    }

    reader.readAsArrayBuffer(file);
}

function handleUnzippedReplay(file,ambiguous_zipped_status){
    console.log("Handling unzipped replay with ambiguous_zipped_status = "+ambiguous_zipped_status);

    // Read the contents of the file
    var reader = new FileReader();

    // FileReader loads -- callback:
    reader.onload = function(e) {
        var txt = reader.result;
        if (ambiguous_zipped_status){
           //If we are unsure as to whether this file is zipped or not:

           try {
               //Attempt to parse it as unzipped              
               var data = JSON.parse(txt);

               visualize(data);
            }
            catch(err) {
                //If this fails, parse it as zipped

                console.log("Ambiguous file fails to parse as straight json, passing to handleGzippedReplay");
                handleGzippedReplay(file);
            }

        } else {

            //We are certain this file is unzipped
            var data = JSON.parse(txt);

            visualize(data);
        }

    }

    reader.readAsText(file);
}


function getParameterByName(name, url) {
    if (!url) url = window.location.href;
    name = name.replace(/[\[\]]/g, "\\$&");
    var regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)"),
        results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, " "));
}

let decodedURL = getParameterByName("replay");
if (decodedURL != null && decodedURL.length > 0) {
    // Send amazon requests through a proxy because of CORS.
    // Ideally we should get Teh Devs to set the proper CORS flags.
    // For now here is a proxy server that can be used.
    decodedURL = decodedURL.replace("https://s3.amazonaws.com", "http://battlecode.arongranberg.com");
    decodedURL = decodedURL.replace("http://s3.amazonaws.com", "http://battlecode.arongranberg.com");
    var xhr = new XMLHttpRequest();
    xhr.onload = function () {
        var array = new Uint8Array(this.response);

        try {
            // Parse replay file
            var data = JSON.parse(pako.inflate(array, {to: 'string'}));
            visualize(data);
        } catch (err) {
            alert('Could not decompress gzipped .bc18z file.');
            console.log(err);
        }
    }
    xhr.open("GET", decodedURL, true);
    xhr.responseType = "arraybuffer";
    xhr.send();
}

// Trigger if local path provided in url
var regex = new RegExp("[?&]fname(=([^&#]*)|&|#|$)");
var results = regex.exec(window.location.href);
if (results && results[2]) {
    var txt = decodeURIComponent(results[2].replace(/\+/g, " "));
    document.getElementById('fname').value = txt;
    var event;
    if (document.createEvent) {
        event = document.createEvent("HTMLEvents");
        event.initEvent("keydown", true, true);
    } else {
        event = document.createEventObject();
        event.eventType = "keydown";
    }

    event.eventName = "keydown";
    event.which = 13;

    if (document.createEvent) {
        document.getElementById('fname').dispatchEvent(event);
    } else {
        document.getElementById('fname').fireEvent("on" + event.eventType, event);
    }
}
