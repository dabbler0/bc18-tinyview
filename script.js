var UNIT_CLASSES = ['Worker', 'Knight', 'Factory', 'Ranger', 'Mage', 'Healer'];
var MAX_HEALTHS = {'Worker': 100, 'Knight': 250, 'Factory': 300, 'Ranger': 200, 'Mage': 80, 'Healer': 100};
var TEAMS = ['Red', 'Blue'];
var TEAM_COLOR = {'Red': '#F00', 'Blue': '#00F'};
var HEAD_SIZE = 0.3;
var BORDER_WIDTH = 0.2;

var mousedown_listener, mouseup_listener, input_listener, needs_clear = false;
var earth_canvas = document.getElementById('earth');
var earth_ctx = earth_canvas.getContext('2d');
var mars_canvas = document.getElementById('mars');
var mars_ctx = mars_canvas.getContext('2d');

var timeout = 10;
var winner;
document.getElementById('timeout').value = timeout;

/*
Allow setting replay speed
*/
document.getElementById('timeout').addEventListener('change', function(e) {
    timeout = document.getElementById('timeout').value;
});

for (var i = 0, team; team = TEAMS[i]; i++) {
    teamInfo = document.getElementById('info' + team);
    for (var j = 0, unit_class; unit_class = UNIT_CLASSES[j]; j++) {
        var property = document.createElement('p');
        property.setAttribute('class', 'property')
        property.innerText = unit_class + ': ';

        var field = document.createElement('span');
        field.setAttribute('id', 'info' + team + unit_class);
        property.appendChild(field);
        teamInfo.appendChild(property);
    }
}

/*
Visualize a replay file given a JSON object
corresponding to the file.
(This is prior to the messages within the replay file,
 which are strings corresponding to JSON objects,
 being parsed.)
*/
var current_anim_timeout = null;

function visualize(data) {
    // Globals
    var id2team = {};
    var maturation_times = {};
    var reserves = [[100, 100]]; // Precomped for every turn

    if (current_anim_timeout != null) {
        clearTimeout(current_anim_timeout);
    }
    
    // Whether or not the slider is currently being held down.
    // This is used because the input event only fires
    // when the slider's value is actively changing,
    // but we want it to pause even if it is held in position.
    var slider_held = false;
    
    // Whether or not we're currently paused.
    var paused = false;

    // Determine who won
    winner = data['metadata'].winner;
    if (winner == 'player1') {
        winner = data['metadata'].player1;
        winner_color = 'Red';
    } else {
        winner = data['metadata'].player2;
        winner_color = 'Blue';
    }
    
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
    
    // set the maximum turn we could slide to
    var t = data.length - 1;
    document.getElementById('turnslider').max = (t - t % 4) / 4 + 1;
    
    // This is used to invert the y-axis
    function flipY(oy) { return (h - oy - 1); }

    // Now, to render an animation frame:
    function render_planet(t, planet, ctx, canvas, unit_count) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw the map
        for (var i = 0; i < h; i += 1) {
            for (var j = 0; j < w; j += 1) {
                // Flip along y-axis
                var px = j, py = flipY(i);
                
                // Black out impassable squares
                if (!planet_maps[planet][i][j]) {
                    ctx.fillStyle = '#000'
                        ctx.fillRect(px * (500 / w), py * (500 / h),
                                500 / w, 500 / h);
                }

                // Write amount of Karbonite at location
                ctx.fillStyle = '#888';
                ctx.fillText(karbonite_maps[planet][t][i][j].toString(),
                        (px + 0.5) * (500 / w), (py + 0.5) * 500 / h);
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
        for (var i = 0; i < data[t].units.length; i += 1) {
            var unit = data[t].units[i];

            unit_locations[unit.id] = [unit.location.x, unit.location.y, unit.location.planet];
            unit_types[unit.id] = unit.unit_type;

            if (unit.location.planet == planet) {
                unit_count[id2team[unit.id]][unit.unit_type]++;

                // Render the unit in the correct color.

                // Blueprints will be given an alpha
                if ((unit.unit_type === "Factory" || unit.unit_type === "Rocket") &&
                        maturation_times[unit.id] > t) {
                    ctx.globalAlpha = 0.5;
                }

                // The border of the square will represent the
                // unit type.
                if (unit.unit_type === "Worker") {
                    // Workers will be yellow, because whatever.
                    ctx.fillStyle = '#FF0';
                }
                
                else if (unit.unit_type === "Factory") {
                    // Factories will be gray
                    ctx.fillStyle = '#888';
                }

                else if (unit.unit_type == "Knight") {
                    // Knights will be some kind of maroon
                    ctx.fillStyle = '#800';
                }

                else if (unit.unit_type == "Ranger") {
                    // Rangers will be some kind of dark green
                    ctx.fillStyle = '#080';
                }

                else if (unit.unit_type == "Mage") {
                    // Rangers will be some kind of dark blue
                    ctx.fillStyle = '#008';
                }

                else {
                    // Unimplemented unit type
                    ctx.fillStyle = '#FFF';
                }
                
                // Flip along the y-axis for drawing.
                // This is because canvas is top-left based.
                var px = unit.location.x;
                var py = flipY(unit.location.y);

                // Fill the border
                ctx.fillRect(
                    px * 500 / w, py * 500 / h,
                    500 / w, 500 / h
                )

                // The inside of the square represents the team allegiance
                // and also health
                var health_ratio = unit.health / MAX_HEALTHS[unit.unit_type];
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
                    (px + BORDER_WIDTH) * 500 / w, (py + BORDER_WIDTH + (1 - 2 * BORDER_WIDTH) * (1 - health_ratio)) * 500 / h,
                    (1 - 2 * BORDER_WIDTH) * 500 / w, (1 - 2 * BORDER_WIDTH) * health_ratio * 500 / h
                );

                ctx.globalAlpha = 1;
            }
        }

        // Render attacks
        // (these are technically made the next turn,
        //  but are rendered this turn for ease of viewing)
        for (var i = 0; i < data[t].changes.length; i += 1) {
            var change = data[t].changes[i];
            if ('Attack' in change) {
                var attack = change['Attack'];
                var target = attack.target_unit_id, robot = attack.robot_id;

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

                ctx.strokeStyle = '#F0F';
                ctx.lineWidth = 5;
                ctx.beginPath();
                ctx.moveTo(
                    (rpos.x + 0.5) * 500 / w,
                    (rpos.y + 0.5) * 500 / h);
                ctx.lineTo(
                    (tpos.x + 0.5) * 500 / w,
                    (tpos.y + 0.5) * 500 / h);
                ctx.stroke();

                ctx.fillStyle = '#F0F';
                ctx.fillRect(
                    (tpos.x + 0.5) * 500 / w - HEAD_SIZE / 2 * 500 / w,
                    (tpos.y + 0.5) * 500 / h - HEAD_SIZE / 2 * 500 / h,
                    HEAD_SIZE * 500 / w,
                    HEAD_SIZE * 500 / h
                );
                
                // Render splash damage from mages
                if (unit_types[robot] == 'Mage') {
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
            }
        }
    }

    function render(t) {
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

        render_planet(t, 'Earth', earth_ctx, earth_canvas, earth_unit_count);
        render_planet(t, 'Mars', mars_ctx, mars_canvas, mars_unit_count);

        // This sets the value of the slider to the current turn.
        // Note: Turn number should be 1-indexed when displayed.
        document.getElementById('turnslider').value = (t - t % 4) / 4 + 1;
        
        // Render Karbonite reserves and turn number
        document.getElementById('turn').innerText = document.getElementById('turnslider').value.toString();
        document.getElementById('blue_karbonite').innerText = reserves[t][0].toString();
        document.getElementById('red_karbonite').innerText = reserves[t][1].toString();

        for (var i = 0, team; team = TEAMS[i]; i++) {
            for (var j = 0, unit_class; unit_class = UNIT_CLASSES[j]; j++) {
                document.getElementById('info' + team + unit_class)
                    .innerText = earth_unit_count[team][unit_class] + ' // ' + mars_unit_count[team][unit_class];
            }
        }

        // Schedule next animation frame
        if (t + 1 < data.length) {
            var new_t = t + 1;
            if (slider_held || paused) {
                // We want to pause.
                new_t = t;
            }
            
            current_anim_timeout = setTimeout(function() {
                render(new_t);
            }, timeout);
            document.getElementById('winner').innerText = '';
        } else {
            // It's the end
            document.getElementById('winner').innerText = winner_color + ' wins! (' + winner + ')';
            document.getElementById('winner').style.color = TEAM_COLOR[winner_color];
        }
    }
    
    // A bunch of slider + button event handlers
    if (needs_clear) {
        document.getElementById('turnslider').removeEventListener('input', input_listener);
        document.getElementById('turnslider').removeEventListener('mousedown', mousedown_listener);
        document.getElementById('turnslider').removeEventListener('mouseup', mouseup_listener);
    }

    needs_clear = true;

    document.getElementById('turnslider').addEventListener('input', input_listener = function(e) {
        // Clear current timeout
        clearTimeout(current_anim_timeout);
        
        // Render the first value of t represented by the given turn
        var t = (this.value - 1) * 4;
        render(t);
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
    
    // We're about to render, so let's
    // force unpause.
    paused = false;
    document.getElementById('pause').innerText = 'Pause';
    
    render(0);
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

document.getElementById('ffile').addEventListener('change', function(e) {
    var file = this.files[0];

    // Read the contents of the file
    var reader = new FileReader();

    // FileReader loads -- callback:
    reader.onload = function(e) {
        var txt = reader.result;

        // Parse replay file
        var data = JSON.parse(txt);

        visualize(data);
    }

    reader.readAsText(file);
});