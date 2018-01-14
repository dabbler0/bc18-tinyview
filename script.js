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
var earth_canvas = document.getElementById('earth');
var graph_canvas = document.getElementById('graphs');
var graph_ctx = graph_canvas.getContext('2d');
var earth_ctx = earth_canvas.getContext('2d');
var mars_canvas = document.getElementById('mars');
var mars_ctx = mars_canvas.getContext('2d');
var timeout = 40;
var activeID = 0;

// Set default timeout value
document.getElementById('timeout').value = timeout;

// Allow setting replay speed
document.getElementById('timeout').addEventListener('change', function(e) {
    timeout = document.getElementById('timeout').value;
});

// Create tags for representing each team's unit count
// for (var i = 0, team; team = TEAMS[i]; i++) {
//     teamInfo = document.getElementById('info' + team);
//     for (var j = 0, unit_class; unit_class = UNIT_CLASSES[j]; j++) {
//         var property = document.createElement('p');
//         property.setAttribute('class', 'property')
//         property.innerText = unit_class + ': ';

//         var field = document.createElement('span');
//         field.setAttribute('id', 'info' + team + unit_class);
//         property.appendChild(field);
//         teamInfo.appendChild(property);
//     }
// }

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

    // Clear info on the winner
    document.getElementById('winner').innerText = '';

    // Get impassable squares for Earth
    var planet_maps = {
        'Earth': data[0].world.planet_maps.Earth.is_passable_terrain,
        'Mars': data[0].world.planet_maps.Mars.is_passable_terrain
    };

    // Get Karbonite data
    // We'll precomp this for every turn
    var karbonite_maps = {
        'Earth': [data[0].world.planet_maps.Earth.initial_karbonite],
        'Mars': [planet_maps['Mars'].map(function(x) { return x.map(function() { return 0; }); })]
    };

    // Convenience dimension variables
    var w = planet_maps['Earth'][0].length, h = planet_maps['Earth'].length;

    // Get the team identities of the initial units
    // (these are not given ever again so we need to remember)
    var initial_units = data[0].world.planet_states.Earth.units
    for (var key in initial_units) {
        var unit = initial_units[key];
        id2team[unit.id] = unit.team;
        id2teamIndex[unit.id] = TEAMS.indexOf(unit.team);
    }

    // Pop off the first "turn", whic is not a turn
    // but instead an initialization object
    data.shift();

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
        "Worker": 25,
        "Knight": 20,
        "Ranger": 20,
        "Mage": 20,
        "Healer": 20,
        "Rocket": 75,
        "Factory": 100,
    };

    for (var t = 0; t < data.length; t += 1) {
        let values = [0, 0];
        let units = data[t].units;
        for (let i = 0; i < units.length; i++) {
            values[id2teamIndex[units[i].id]] += unit_values[units[i].unit_type];
        }
        unitValueByTime.push(values);
        // for (let team = 0; team <= 1; team++) {
        //     let unitValue = 0;
        //     let karbonite = 0;
        //     data[t].units
            
        // }
    }
    console.log(unitValueByTime);
    

    // set the maximum turn we could slide to
    var t = data.length - 1;
    document.getElementById('turnslider').max = (t - t % 4) / 4 + 1;

    // This is used to invert the y-axis
    function flipY(oy) { return (h - oy - 1); }

    // Now, to render an animation frame:
    function render_planet(t, fractional_t, planet, ctx, canvas, unit_count) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

        let karbonite_at_tick = karbonite_maps[planet][t];

        // Draw the map
        for (var i = 0; i < h; i += 1) {
            for (var j = 0; j < w; j += 1) {
                // Flip along y-axis
                var px = j, py = flipY(i);

                // Black out impassable squares
                ctx.beginPath();
                ctx.rect(px * (500 / w), py * (500 / h), 500 / w, 500 / h);

                if (!planet_maps[planet][i][j]) {
                    if (planet == 'Mars') {
                        ctx.fillStyle = '#5d1e10';
                        ctx.strokeStyle = '#591d0f';
                    } else {
                        ctx.fillStyle = '#306796';
                        ctx.strokeStyle = '#2e6491';
                    }

                } else {
                    if (planet == 'Mars') {
                        ctx.fillStyle = "#e4cdc0";
                        ctx.strokeStyle = '#c4b0a5';
                    } else {
                        ctx.fillStyle = "#FFF";
                        ctx.strokeStyle = '#e4e4e4';
                    }
                }
                
                ctx.fill();
                ctx.lineWidth = 1;
                ctx.stroke();

                if (karbonite_at_tick[i][j] > 0) {
                    // Write amount of Karbonite at location
                    ctx.globalAlpha = (karbonite_at_tick[i][j] > 0 ? 0.2 : 0.0) + 0.6 * (karbonite_at_tick[i][j] / 50);
                    ctx.fillStyle = '#337';
                    ctx.fill();
                    ctx.globalAlpha = 1.0;
                    // ctx.fillStyle = '#888';
                    // ctx.fillText(karbonite_at_tick[i][j].toString(),
                    //         (px + 0.4) * (500 / w), (py + 0.6) * 500 / h);
                }
            }
        }

        // Render units
        var unit_locations = {};
        var unit_types = {};
        if (t > 0) {
            for (var i = 0; i < data[t - 1].units.length; i += 1) {
                var unit = data[t - 1].units[i];
                unit_locations[unit.id] = [unit.location.x, unit.location.y, unit.location.planet];
            }
        }

        let prevUnits = {}
        if (t > 0) {
            for (var i = 0; i < data[t - 1].units.length; i += 1) {
                var unit = data[t - 1].units[i];
                prevUnits[unit.id] = unit;
            }
        }
        

        const DamageTime = 0.7;
        const MoveFinishedTime = 0.8;

        for (var i = 0; i < data[t].units.length; i += 1) {
            var unit = data[t].units[i];

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
                        px * 500 / w, py * 500 / h,
                        500 / w, 500 / h
                    )

                    ctx.fillStyle = '#FFF';
                    ctx.fillRect(
                        (px + BORDER_WIDTH) * 500 / w, (py + BORDER_WIDTH) * 500 / h,
                        (1 - 2 * BORDER_WIDTH) * 500 / w, (1 - 2 * BORDER_WIDTH) * 500 / h
                    );
                    ctx.fillStyle = ctx.strokeStyle = TEAM_COLOR[id2team[unit.id]];
                    ctx.lineWidth = 1;
                    ctx.strokeRect(
                        (px + BORDER_WIDTH) * 500 / w, (py + BORDER_WIDTH) * 500 / h,
                        (1 - 2 * BORDER_WIDTH) * 500 / w, (1 - 2 * BORDER_WIDTH) * 500 / h
                    );
                    ctx.fillRect(
                        (px + BORDER_WIDTH) * 500 / w, (py + BORDER_WIDTH + (1 - 2 * BORDER_WIDTH) * (1 - health)) * 500 / h,
                        (1 - 2 * BORDER_WIDTH) * 500 / w, (1 - 2 * BORDER_WIDTH) * health * 500 / h
                    );
                } else {
                    var cx = (px + 0.5) * 500 / w;
                    var cy = (py + 0.5) * 500 / h;
                    var radius = 0.3 * 500 / w;

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
                    // Fill from bottom to top
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

        // Render attacks
        // (these are technically made the next turn,
        //  but are rendered this turn for ease of viewing)
        for (var i = 0; i < data[t].changes.length; i += 1) {
            var change = data[t].changes[i];
            let target = null;
            let robot = null;

            if ('Attack' in change) {
                var attack = change['Attack'];
                target = attack.target_unit_id;
                robot = attack.robot_id;
            }

            if ('Heal' in change) {
                var heal = change['Heal'];
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

                if (unit_types[robot] == 'Ranger') {
                    var interPos1 = lerp(rpos, tpos, (fractional_t - 0.3) / DamageTime);
                    var interPos2 = lerp(rpos, tpos, (fractional_t) / DamageTime);

                    ctx.strokeStyle = ATTACK_COLOR[id2team[robot]];
                    ctx.lineWidth = 5;
                    ctx.beginPath();
                    ctx.moveTo(
                        (interPos1.x + 0.5) * 500 / w,
                        (interPos1.y + 0.5) * 500 / h);
                    ctx.lineTo(
                        (interPos2.x + 0.5) * 500 / w,
                        (interPos2.y + 0.5) * 500 / h);
                    ctx.stroke();

                    if (fractional_t > DamageTime && fractional_t < DamageTime + 0.1) {
                        let size = (fractional_t - DamageTime)/0.1;
                        ctx.beginPath();
                        ctx.arc(
                            (tpos.x + 0.5) * 500 / w,
                            (tpos.y + 0.5) * 500 / h,
                            size * HEAD_SIZE * 500 / w,
                            // size * HEAD_SIZE * 500 / h,
                            0,
                            2 * Math.PI
                        );
                        ctx.fillStyle = '#F0F';
                        ctx.fill();
                    }
                } else if (unit_types[robot] == 'Healer') {
                    var t0 = (fractional_t - 0.3) / DamageTime;
                    var t1 = (fractional_t) / DamageTime;
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
                        if (i == 0) ctx.moveTo((p.x + 0.5) * 500 / w, (p.y + 0.5) * 500 / h);
                        else ctx.lineTo((p.x + 0.5) * 500 / w, (p.y + 0.5) * 500 / h);
                    }

                    ctx.stroke();

                    if (fractional_t > DamageTime && fractional_t < DamageTime + 0.1) {
                        let size = (fractional_t - DamageTime)/0.1;
                        ctx.beginPath();
                        ctx.arc(
                            (tpos.x + 0.5) * 500 / w,
                            (tpos.y + 0.5) * 500 / h,
                            size * HEAD_SIZE * 500 / w,
                            // size * HEAD_SIZE * 500 / h,
                            0,
                            2 * Math.PI
                        );
                        ctx.fillStyle = '#F0F';
                        ctx.fill();
                    }

                } else if (unit_types[robot] == 'Knight') {
                    var interPos1 = lerp(rpos, tpos, (fractional_t - 0.3) / DamageTime);
                    var interPos2 = lerp(rpos, tpos, (fractional_t) / DamageTime);

                    ctx.strokeStyle = ATTACK_COLOR[id2team[robot]];
                    ctx.lineWidth = 5;
                    ctx.beginPath();
                    ctx.moveTo(
                        (interPos1.x + 0.5) * 500 / w,
                        (interPos1.y + 0.5) * 500 / h);
                    ctx.lineTo(
                        (interPos2.x + 0.5) * 500 / w,
                        (interPos2.y + 0.5) * 500 / h);
                    ctx.stroke();

                    if (fractional_t > DamageTime && fractional_t < DamageTime + 0.1) {
                        let size = (fractional_t - DamageTime)/0.1;
                        ctx.beginPath();
                        ctx.arc(
                            (tpos.x + 0.5) * 500 / w,
                            (tpos.y + 0.5) * 500 / h,
                            size * HEAD_SIZE * 500 / w,
                            // size * HEAD_SIZE * 500 / h,
                            0,
                            2 * Math.PI
                        );
                        ctx.fillStyle = '#F0F';
                        ctx.fill();
                    }
                } else if (unit_types[robot] == 'Mage') {
                    var interPos1 = lerp(rpos, tpos, (fractional_t - 0.3) / DamageTime);
                    var interPos2 = lerp(rpos, tpos, (fractional_t) / DamageTime);

                    ctx.strokeStyle = ATTACK_COLOR[id2team[robot]];
                    ctx.lineWidth = 5;
                    ctx.beginPath();
                    ctx.moveTo(
                        (interPos1.x + 0.5) * 500 / w,
                        (interPos1.y + 0.5) * 500 / h);
                    ctx.lineTo(
                        (interPos2.x + 0.5) * 500 / w,
                        (interPos2.y + 0.5) * 500 / h);
                    ctx.stroke();

                    if (fractional_t > DamageTime && fractional_t < DamageTime + 0.1) {
                        let size = (fractional_t - DamageTime)/0.1;
                        ctx.beginPath();
                        ctx.arc(
                            (tpos.x + 0.5) * 500 / w,
                            (tpos.y + 0.5) * 500 / h,
                            size * HEAD_SIZE * 500 / w,
                            // size * HEAD_SIZE * 500 / h,
                            0,
                            2 * Math.PI
                        );
                        ctx.fillStyle = '#F0F';
                        ctx.fill();
                    }

                    // Render splash damage from mages
                    if (fractional_t > DamageTime - 0.1 && fractional_t < DamageTime + 0.05) {
                        for (var dx = -1; dx <= 1; dx += 1) {
                            for (var dy = -1; dy <= 1; dy += 1) {
                                ctx.strokeStyle = '#F0F';
                                ctx.lineWidth = 5;
                                ctx.beginPath();
                                ctx.moveTo(
                                    (tpos.x + 0.5) * 500 / w,
                                    (tpos.y + 0.5) * 500 / h);
                                ctx.lineTo(
                                    (tpos.x + 0.5 + dx) * 500 / w,
                                    (tpos.y + 0.5 + dy) * 500 / h);
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

    function render_graph(ctx, values, x, y, w, h, colors) {
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

        ctx.restore();
    }

    function render_graphs(time, ctx) {
        let width = ctx.canvas.width;
        render_graph(ctx, reserves, 0, 0, 300, 200, ["rgba(55,126,184, 0.8)", "rgba(228,26,28, 0.8)"]); // Reserves are reversed colors for whatever reason
        render_graph(ctx, unitValueByTime, width/2 - 300/2, 0, 300, 200);
        render_graph(ctx, [0,1,0,1,0,1], width - 300, 0, 300, 200);
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
        if (slider_held || paused) {
            dt = 0;
        }
        if (timeout > 0) {
            realtime += dt * 1/(timeout * 0.001);
        }
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

        if (!slider_held) {
            // This sets the value of the slider to the current turn.
            // Note: Turn number should be 1-indexed when displayed.
            document.getElementById('turnslider').value = (ti - ti % 4) / 4 + 1;
        }

        // Render Karbonite reserves and turn number
        document.getElementById('turn').innerText = document.getElementById('turnslider').value.toString();
        document.getElementById('blue_karbonite').innerText = reserves[ti][0].toString();
        document.getElementById('red_karbonite').innerText = reserves[ti][1].toString();

        // Render unit count for each team
        for (var i = 0, team; team = TEAMS[i]; i++) {
            for (var j = 0, unit_class; unit_class = UNIT_CLASSES[j]; j++) {
                document.getElementById('info' + team + unit_class)
                    .innerText = earth_unit_count[team][unit_class] + ' // ' + mars_unit_count[team][unit_class];
            }
        }

        if (ti < data.length - 1) {
            document.getElementById('winner').innerText = '';
        } else {
            // It's the end
            var name = ' (' + team_name[winner] + ')';
            if (!team_name[winner]) name = '';
            document.getElementById('winner').innerText = winner + name + ' wins!';
            document.getElementById('winner').style.color = TEAM_COLOR[winner];
        }

        // Schedule next animation frame
        window.requestAnimationFrame(render);
    }

    // A bunch of slider + button event handlers
    // Remove the ones from the previous visualization
    document.getElementById('turnslider').removeEventListener('input', input_listener);
    document.getElementById('turnslider').removeEventListener('mousedown', mousedown_listener);
    document.getElementById('turnslider').removeEventListener('mouseup', mouseup_listener);

    document.getElementById('turnslider').addEventListener('input', input_listener = function(e) {
        // Render the first value of t represented by the given turn
        realtime = (this.value - 1) * 4;
    });

    document.getElementById('turnslider').addEventListener('mousedown', mousedown_listener = function(e) {
        slider_held = true;
    });

    document.getElementById('turnslider').addEventListener('mouseup', mouseup_listener = function(e) {
        slider_held = false;
    });

    document.getElementById('pause').addEventListener('click', function(e) {
        paused = !paused;
        if (paused) this.innerText = 'Resume';
        else this.innerText = 'Pause';
    })

    document.getElementById('reset').addEventListener('click', function(e) {
        reset = true;
    })

    // We're about to render, so let's force unpause.
    paused = false;
    document.getElementById('pause').innerText = 'Pause';

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
                console.log("Parsing!");
                visualize(data);
            }
        };

        q.send();
    }
});

// Selecting a file triggers replay visualization
document.getElementById('ffile').addEventListener('change', function(e) {
    var file = this.files[0];

    // Read the contents of the file
    var reader = new FileReader();

    // FileReader loads -- callback:
    reader.onload = function(e) {
        var txt = reader.result;

        // Parse replay file
        var data = JSON.parse(txt);

        console.log("Parsing 2!");
        visualize(data);
    }

    reader.readAsText(file);
});

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
