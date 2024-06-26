var openlayersmap = new ol.Map({
	target: 'map',
	layers: [
		new ol.layer.Tile({
			source: new ol.source.OSM(),
			opacity: 0.5
		})
	],
	view: new ol.View({
		center: ol.proj.fromLonLat([10.448851, 51.16077]),
		zoom: 16
	})
});

var canvas;
var mapHeight;
var windowX, windowY;
let txtoverpassQuery;
var OSMxml;
var numnodes, numways;
var minlat = Infinity,
	maxlat = -Infinity,
	minlon = Infinity,
	maxlon = -Infinity;
var nodes = [],
	edges = [];
var mapminlat, mapminlon, mapmaxlat, mapmaxlon;
var totaledgedistance = 0;
var closestnodetomouse = -1;
var closestedgetomouse = -1;
var startnode, currentnode;
var selectnodemode = 1,
	solveRESmode = 2,
	choosemapmode = 3,
	trimmode = 4,
	downloadGPXmode = 5;
var mode;
var remainingedges;
var debugsteps = 0;
var bestdistance;
var bestroute;
var bestarea;
var bestdoublingsup;
var showSteps = false;
var showRoads = true;
var iterations, iterationsperframe;
var msgbckDiv, msgDiv, reportbckDiv,reportmsgDiv;
var margin;
var btnTLx, btnTLy, btnBRx, btnBRy; // button's top left and bottom right x and y coordinates.
var starttime;
var efficiencyhistory = [],
	distancehistory = [];
var totalefficiencygains = 0;
var isTouchScreenDevice = false;
var totaluniqueroads;

function setup() {
	if (navigator.geolocation) { //if browser shares user GPS location, update map to center on it.
		navigator.geolocation.getCurrentPosition(function (position) {
			openlayersmap.getView().setCenter(ol.proj.fromLonLat([position.coords.longitude, position.coords.latitude]));
		});
	}
	mapWidth = windowWidth;
	mapHeight = windowHeight;
	windowX = windowWidth;
	windowY = mapHeight //; + 250;
	canvas = createCanvas(windowX, windowY - 34);
	colorMode(HSB);
	mode = choosemapmode;
	iterationsperframe = 1;
	margin = 0.07; // don't pull data in the extreme edges of the map
	showMessage("Zoom to selected area, then click here");

}

function draw() { //main loop called by the P5.js framework every frame
	if (touches.length > 0) {
		isTouchScreenDevice = true;
	} // detect touch screen device such as mobile
	clear();
	drawMask(); //frame the active area on the map

	if (mode != choosemapmode) {
		if (showRoads) {
			showEdges(); //draw connections between nodes
		}
		if (mode == solveRESmode) {
			iterationsperframe = max(0.01, iterationsperframe - 1 * (5 - frameRate())); // dynamically adapt iterations per frame to hit 5fps
			for (let it = 0; it < iterationsperframe; it++) {
				iterations++;
				let solutionfound = false;
				while (!solutionfound) { //run randomly down least roads until all roads have been run
					shuffle(currentnode.edges, true);
					currentnode.edges.sort((a, b) => a.travels - b.travels); // sort edges around node by number of times traveled, and travel down least.
					let edgewithleasttravels = currentnode.edges[0];
					let nextNode = edgewithleasttravels.OtherNodeofEdge(currentnode);
					edgewithleasttravels.travels++;
					currentroute.addWaypoint(nextNode, edgewithleasttravels.distance);
					currentnode = nextNode;
					if (edgewithleasttravels.travels == 1) { // then first time traveled on this edge
						remainingedges--; //fewer edges that have not been travelled
					}
					if (remainingedges == 0) { //once all edges have been traveled, the route is complete. Work out total distance and see if this route is the best so far.
						solutionfound = true;
						currentroute.distance += calcdistance(currentnode.lat, currentnode.lon, startnode.lat, startnode.lon);
						if (currentroute.distance < bestdistance) { // this latest route is now record
							bestroute = new Route(null, currentroute);
							bestdistance = currentroute.distance;
							if (efficiencyhistory.length > 1) {
								totalefficiencygains += totaledgedistance / bestroute.distance - efficiencyhistory[efficiencyhistory.length - 1];
							}
							efficiencyhistory.push(totaledgedistance / bestroute.distance);
							distancehistory.push(bestroute.distance);

						}
						currentnode = startnode;
						remainingedges = edges.length;
						currentroute = new Route(currentnode, null);
						resetEdges();
					}
				}
			}
		}
		showNodes();
		if (bestroute != null) {
			bestroute.show();
		}
		if (mode == solveRESmode) {
			drawProgressGraph();
		}
		if (mode == downloadGPXmode){
			showReportOut();
		}
		//showStatus();
	}
}

function getOverpassData() { //load nodes and edge map data in XML format from OpenStreetMap via the Overpass API
	showMessage("Loading map data...");
	canvas.position(0, 34); // start canvas just below logo image
	bestroute = null;
	totaluniqueroads=0;
	var extent = ol.proj.transformExtent(openlayersmap.getView().calculateExtent(openlayersmap.getSize()), 'EPSG:3857', 'EPSG:4326'); //get the coordinates current view on the map
	mapminlat = extent[1];
	mapminlon = extent[0];
	mapmaxlat = extent[3];
	mapmaxlon = extent[2]; //51.62354589659512,0.3054885475158691,51.635853268644496,0.33291145248413084
	dataminlat = extent[1] + (extent[3] - extent[1]) * margin; //51.62662273960746,0.31234427375793455,51.63277642563215,0.3260557262420654
	dataminlon = extent[0] + (extent[2] - extent[0]) * margin;
	datamaxlat = extent[3] - (extent[3] - extent[1]) * margin;
	datamaxlon = extent[2] - (extent[2] - extent[0]) * margin;
	let OverpassURL = "https://overpass-api.de/api/interpreter?data=";
	//let overpassquery = "(way({{bbox}})['name']['highway']['highway' !~ 'path']['highway' !~ 'steps']['highway' !~ 'motorway']['highway' !~ 'motorway_link']['highway' !~ 'raceway']['highway' !~ 'bridleway']['highway' !~ 'proposed']['highway' !~ 'construction']['highway' !~ 'elevator']['highway' !~ 'bus_guideway']['highway' !~ 'footway']['highway' !~ 'cycleway']['highway' !~ 'trunk']['highway' !~ 'platform']['foot' !~ 'no']['service' !~ 'drive-through']['service' !~ 'parking_aisle']['access' !~ 'private']['access' !~ 'no'];node(w)({{bbox}}););out;";
	let overpassquery = "(way({{bbox}})['highway']['highway' !~ 'motorway']['highway' !~ 'motorway_link']['highway' !~ 'raceway']['highway' !~ 'proposed']['highway' !~ 'construction']['highway' !~ 'elevator']['highway' !~ 'bus_guideway']['highway' !~ 'trunk']['highway' !~ 'platform']['foot' !~ 'no']['service' !~ 'drive-through']['service' !~ 'parking_aisle']['access' !~ 'private']['access' !~ 'no'];node(w)({{bbox}}););out;";

	overpassquery = overpassquery.replace("{{bbox}}", dataminlat + "," + dataminlon + "," + datamaxlat + "," + datamaxlon);
	overpassquery = overpassquery.replace("{{bbox}}", dataminlat + "," + dataminlon + "," + datamaxlat + "," + datamaxlon);
	OverpassURL = OverpassURL + encodeURI(overpassquery);
	httpGet(OverpassURL, 'text', false, function (response) {
		let OverpassResponse = response;
		var parser = new DOMParser();
		OSMxml = parser.parseFromString(OverpassResponse, "text/xml");
		var XMLnodes = OSMxml.getElementsByTagName("node")
		var XMLways = OSMxml.getElementsByTagName("way")
		numnodes = XMLnodes.length;
		numways = XMLways.length;
		for (let i = 0; i < numnodes; i++) {
			var lat = XMLnodes[i].getAttribute('lat');
			var lon = XMLnodes[i].getAttribute('lon');
			minlat = min(minlat, lat);
			maxlat = max(maxlat, lat);
			minlon = min(minlon, lon);
			maxlon = max(maxlon, lon);
		}
		nodes = [];
		edges = [];
		for (let i = 0; i < numnodes; i++) {
			var lat = XMLnodes[i].getAttribute('lat');
			var lon = XMLnodes[i].getAttribute('lon');
			var nodeid = XMLnodes[i].getAttribute('id');
			let node = new Node(nodeid, lat, lon);
			nodes.push(node);
		}
		//parse ways into edges
		for (let i = 0; i < numways; i++) {
			let wayid = XMLways[i].getAttribute('id');
			let nodesinsideway = XMLways[i].getElementsByTagName('nd');
			for (let j = 0; j < nodesinsideway.length - 1; j++) {
				fromnode = getNodebyId(nodesinsideway[j].getAttribute("ref"));
				tonode = getNodebyId(nodesinsideway[j + 1].getAttribute("ref"));
				if (fromnode != null & tonode != null) {
					let newEdge = new Edge(fromnode, tonode, wayid);
					edges.push(newEdge);
					totaledgedistance += newEdge.distance;
				}
			}
		}
		mode = selectnodemode;
		showMessage("Click on start of route");
	});
}

function showNodes() {
	let closestnodetomousedist = Infinity;
	for (let i = 0; i < nodes.length; i++) {
		if (showRoads) {
			nodes[i].show();
		}
		if (mode == selectnodemode) {
			disttoMouse = dist(nodes[i].x, nodes[i].y, mouseX, mouseY);
			if (disttoMouse < closestnodetomousedist) {
				closestnodetomousedist = disttoMouse;
				closestnodetomouse = i;
			}
		}
	}
	if (mode == selectnodemode) {
		startnode = nodes[closestnodetomouse];
	}
	if (startnode != null && (!isTouchScreenDevice || mode != selectnodemode)) {
		startnode.highlight();
	}
}

function showEdges() {
	let closestedgetomousedist = Infinity;
	for (let i = 0; i < edges.length; i++) {
		edges[i].show();
		if (mode == trimmode) {
			let dist = edges[i].distanceToPoint(mouseX, mouseY)
			if (dist < closestedgetomousedist) {
				closestedgetomousedist = dist;
				closestedgetomouse = i;
			}
		}
	}
	if (closestedgetomouse >= 0 && !isTouchScreenDevice) {
		edges[closestedgetomouse].highlight();
	}

}

function resetEdges() {
	for (let i = 0; i < edges.length; i++) {
		edges[i].travels = 0;
	}
}

function removeOrphans() { // remove unreachable nodes and edges 
	resetEdges();
	currentnode = startnode;
	floodfill(currentnode, 1); // recursively walk every unwalked route until all connected nodes have been reached at least once, then remove unwalked ones.
	let newedges = [];
	let newnodes = [];
	totaledgedistance = 0;
	for (let i = 0; i < edges.length; i++) {
		if (edges[i].travels > 0) {
			newedges.push(edges[i]);
			totaledgedistance += edges[i].distance;
			if (!newnodes.includes(edges[i].from)) {
				newnodes.push(edges[i].from);
			}
			if (!newnodes.includes(edges[i].to)) {
				newnodes.push(edges[i].to);
			}
		}
	}
	edges = newedges;
	nodes = newnodes;
	resetEdges();
}

function floodfill(node, stepssofar) {
	for (let i = 0; i < node.edges.length; i++) {
		if (node.edges[i].travels == 0) {
			node.edges[i].travels = stepssofar;
			floodfill(node.edges[i].OtherNodeofEdge(node), stepssofar + 1);
		}
	}
}

function solveRES() {
	removeOrphans();
	showRoads = false;
	remainingedges = edges.length;
	currentroute = new Route(currentnode, null);
	bestroute = new Route(currentnode, null);
	bestdistance = Infinity;
	iterations = 0;
	iterationsperframe = 1;
	starttime = millis();
}

function mousePressed() { // clicked on map to select a node
	if (mode == choosemapmode && mouseY < btnBRy && mouseY > btnTLy && mouseX > btnTLx && mouseX < btnBRx) { // Was in Choose map mode and clicked on button
		getOverpassData();
		return;
	}
	if (mode == selectnodemode && mouseY < mapHeight) { // Select node mode, and clicked on map 
		showNodes(); //find node closest to mouse
		mode = trimmode;
		showMessage('Click on roads to trim, then click here');
		removeOrphans(); // deletes parts of the network that cannot be reached from start
		return;
	}
	if (mode == trimmode) {
		showEdges(); // find closest edge
		if (mouseY < btnBRy && mouseY > btnTLy && mouseX > btnTLx && mouseX < btnBRx) { // clicked on button
			mode = solveRESmode;
			showMessage('Calculating... Click to stop');
			showNodes(); // recalculate closest node
			solveRES();
			return;
		} else { // clicked on edge to remove it
			trimSelectedEdge();
		}
	}
	if (mode == solveRESmode && mouseY < btnBRy && mouseY > btnTLy && mouseX > btnTLx && mouseX < btnBRx) { // Was busy solving and user clicked on button
		mode = downloadGPXmode;
		hideMessage();
		//calculate total unique roads (ways):
		let uniqueways=[];
		for (let i = 0; i < edges.length; i++) {
			if (!uniqueways.includes(edges[i].wayid)) {
				uniqueways.push(edges[i].wayid);
			}
		}
		totaluniqueroads=uniqueways.length;
		return;
	}
	if (mode == downloadGPXmode && mouseY < height/2+200+40 && mouseY > height/2+200 && mouseX > width/2-140 && mouseX < width/2-140+280) { // Clicked Download Route rect(width/2-140,height/2+200,280,40);
		bestroute.exportGPX();
		return;
	}

	
}

function positionMap(minlon_, minlat_, maxlon_, maxlat_) {
	extent = [minlon_, minlat_, maxlon_, maxlat_];
	//try to fit the map to these coordinates
	openlayersmap.getView().fit(ol.proj.transformExtent(extent, 'EPSG:4326', 'EPSG:3857'), openlayersmap.getSize());
	//capture the exact coverage of the map after fitting
	var extent = ol.proj.transformExtent(openlayersmap.getView().calculateExtent(openlayersmap.getSize()), 'EPSG:3857', 'EPSG:4326');
	mapminlat = extent[1];
	mapminlon = extent[0];
	mapmaxlat = extent[3];
	mapmaxlon = extent[2];
}

function calcdistance(lat1, long1, lat2, long2) {
	lat1 = radians(lat1);
	long1 = radians(long1);
	lat2 = radians(lat2);
	long2 = radians(long2);
	return 2 * asin(sqrt(pow(sin((lat2 - lat1) / 2), 2) + cos(lat1) * cos(lat2) * pow(sin((long2 - long1) / 2), 2))) * 6371.0;
}

function getNodebyId(id) {
	for (let i = 0; i < nodes.length; i++) {
		if (nodes[i].nodeId == id) {
			return nodes[i];
		}
	}
	return null;
}

function showMessage(msg) {
	if (msgDiv) {
		hideMessage();
	}
	let ypos = 20;
	let btnwidth = 320;
	msgbckDiv = createDiv('');
	msgbckDiv.style('position', 'fixed');
	msgbckDiv.style('width', btnwidth + 'px');
	msgbckDiv.style('top', ypos + 45 + 'px');
	msgbckDiv.style('left', '50%');
	msgbckDiv.style('background', 'black');
	msgbckDiv.style('opacity', '0.3');
	msgbckDiv.style('-webkit-transform', 'translate(-50%, -50%)');
	msgbckDiv.style('transform', 'translate(-50%, -50%)');
	msgbckDiv.style('height', '30px');
	msgbckDiv.style('border-radius', '7px');
	msgDiv = createDiv('');
	msgDiv.style('position', 'fixed');
	msgDiv.style('width', btnwidth + 'px');
	msgDiv.style('top', ypos + 57 + 'px');
	msgDiv.style('left', '50%');
	msgDiv.style('color', 'white');
	msgDiv.style('background', 'none');
	msgDiv.style('opacity', '1');
	msgDiv.style('-webkit-transform', 'translate(-50%, -50%)');
	msgDiv.style('transform', 'translate(-50%, -50%)');
	msgDiv.style('font-family', '"Lucida Sans Unicode", "Lucida Grande", sans-serif');
	msgDiv.style('font-size', '16px');
	msgDiv.style('text-align', 'center');
	msgDiv.style('vertical-align', 'middle');
	msgDiv.style('height', '50px');
	msgDiv.html(msg);
	btnTLx = windowWidth / 2 - 200; // area that is touch/click sensitive
	btnTLy = ypos - 4;
	btnBRx = btnTLx + 400;
	btnBRy = btnTLy + 32;
}

function hideMessage() {
	msgbckDiv.remove();
	msgDiv.remove();
}

function drawMask() {
	noFill();
	stroke(0, 0, 255, 0.4);
	strokeWeight(0.5);
	rect(windowWidth * margin, windowHeight * margin, windowWidth * (1 - 2 * margin), windowHeight * (1 - 2 * margin));
}

function trimSelectedEdge() {
	if (closestedgetomouse >= 0) {
		let edgetodelete = edges[closestedgetomouse];
		edges.splice(edges.findIndex((element) => element == edgetodelete), 1);
		for (let i = 0; i < nodes.length; i++) { // remove references to the deleted edge from within each of the nodes
			if (nodes[i].edges.includes(edgetodelete)) {
				nodes[i].edges.splice(nodes[i].edges.findIndex((element) => element == edgetodelete), 1);
			}
		}
		removeOrphans(); // deletes parts of the network that no longer can be reached.
		closestedgetomouse = -1;
	}
}

function drawProgressGraph() {
	if (efficiencyhistory.length > 0) {
		noStroke();
		fill(0, 0, 0, 0.3);
		let graphHeight = 100;
		rect(0, height - graphHeight, windowWidth, graphHeight);
		fill(0, 5, 225, 255);
		textAlign(LEFT);
		textSize(12);
		text("Routes tried: " + (iterations.toLocaleString()) + ", Length of all roads: " + nf(totaledgedistance, 0, 1) + "km, Best route: " + nf(bestroute.distance, 0, 1) + "km (" + round(efficiencyhistory[efficiencyhistory.length - 1] * 100) + "%)", 15, height - graphHeight + 18);
		textAlign(CENTER);
		textSize(12);
		for (let i = 0; i < efficiencyhistory.length; i++) {
			fill(i * 128 / efficiencyhistory.length, 255, 205, 1);
			let startx = map(i, 0, efficiencyhistory.length, 0, windowWidth);
			let starty = height - graphHeight * efficiencyhistory[i];
			rect(startx, starty, windowWidth / efficiencyhistory.length, graphHeight * efficiencyhistory[i]);
			fill(0, 5, 0);
			text(round(distancehistory[i]) + "km", startx + windowWidth / efficiencyhistory.length / 2, height - 5);
		}
	}
}

function showReportOut() {

	fill(250,255,0,0.6);
	noStroke();
	rect(width/2-150,height/2-250,300,500);
	fill(250,255,0,0.15);
	rect(width/2-147,height/2-247,300,500);
	strokeWeight(1);
	stroke(20,255,255,0.8);
	line(width/2-150,height/2-200,width/2+150,height/2-200);
	noStroke();
	fill(0,0,255,1);
	textSize(28);
	textAlign(CENTER);
	text('Route Summary',width/2,height/2-215);
	fill(0,0,255,0.75);
	textSize(16);
	text('Total roads covered',width/2,height/2-170+0*95);
	text('Total length of all roads',width/2,height/2-170+1*95);
	text('Length of final route',width/2,height/2-170+2*95);
	text('Efficiency',width/2,height/2-170+3*95);

	textSize(36);
	fill(20,255,255,1);
	text(totaluniqueroads,width/2,height/2-120+0*95);
	text(nf(totaledgedistance, 0, 1) + "km",width/2,height/2-120+1*95);
	text(nf(bestroute.distance, 0, 1) + "km",width/2,height/2-120+2*95);
	text(round(100 * totaledgedistance / bestroute.distance) + "%",width/2,height/2-120+3*95);

	fill(20,255,100,0.75);
	rect(width/2-140,height/2+200,280,40);
	fill(0,0,255,1);
	textSize(28);
	text('Download Route',width/2,height/2+230);
}

function showStatus() {
	if (startnode != null) {
		let textx = 2;
		let texty = mapHeight - 400;
		fill(0, 5, 225);
		noStroke();
		textSize(12);
		textAlign(LEFT);
		text("Total number nodes: " + nodes.length, textx, texty);
		text("Total number road sections: " + edges.length, textx, texty + 20);
		text("Length of roads: " + nf(totaledgedistance, 0, 3) + "km", textx, texty + 40);
		if (bestroute != null) {
			if (bestroute.waypoints.length > 0) {
				text("Best route: " + nf(bestroute.distance, 0, 3) + "km, " + nf(100 * totaledgedistance / bestroute.distance, 0, 2) + "%", textx, texty + 60);
			}
			text("Routes tried: " + iterations, textx, texty + 80);
			text("Frame rate: " + frameRate(), textx, texty + 100);
			text("Solutions per frame: " + iterationsperframe, textx, texty + 120);
			text("Iterations/second: " + iterations / (millis() - starttime) * 1000, textx, texty + 140);
			text("best routes: " + efficiencyhistory.length, textx, texty + 160);
			text("efficiency gains: " + nf(100 * totalefficiencygains, 0, 2) + "% and " + nf(100 * totalefficiencygains / (millis() - starttime) * 1000, 0, 2) + "% gains/sec:", textx, texty + 180); //
			text("isTouchScreenDevice: " + isTouchScreenDevice, textx, texty + 200);
		}
	}
}