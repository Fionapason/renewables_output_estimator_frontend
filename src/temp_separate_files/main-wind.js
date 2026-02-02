import "./style-wind.css";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import {computeAndUpdateOutputWind, optimizePolygon} from "../wind_output/wind_api.js";
import {getPolygonVerticesCartesian, removePolygonTurbines, generateCandidateLonLat, placeTurbinesAtLonLat} from "../wind_output/optimizer_helpers.js"
import {generateHexagonalTurbinePositions} from "../wind_output/turbine_placers.js"
import {showPolygonOutput, closePolygonOutput, setSelectedWindOutput} from "../wind_output/output_ui.js";
import {createOptimizerCanvasLoader} from "../wind_output/output_ui.js";


// FIONA'S CHANGES
let canvasLoader = null;
function getCanvasLoader() {
  if (canvasLoader) return canvasLoader;

  const canvas = document.getElementById("optimizerCanvas");
  if (!canvas) {
    throw new Error("optimizerCanvas not found in DOM (panel not rendered yet?)");
  }

  canvasLoader = createOptimizerCanvasLoader();
  return canvasLoader;
}


// TODO manage polygon output bugs: changing hub height, race condition when making changes before it computes
async function main() {
    'use strict';

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// SCENE
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

    Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIzYjkzYTQ3NC04MTgwLTRkNDMtODgwYi1kODRiYzYwNmJkODUiLCJpZCI6Mjc2OTY5LCJpYXQiOjE3Mzk4NzIyODB9.aGj7tzhvd9OrzBDuTSZfF8jIkhYeO-FQnitwnb5vQtE';

    const viewer = new Cesium.Viewer('cesiumContainer', {
        animation: false, // Disables the animation controls (bottom left)
        timeline: false, // Disables the timeline (bottom center)
        shouldAnimate: false // Prevents automatic animations
    });

// Fixed date: 4 November 2025, 15:00 in Zurich (UTC+1)
    const zurichTime = new Date(Date.UTC(2025, 6, 4, 14, 0, 0));
// (Months are 0-indexed → 10 = November)

    viewer.clock.currentTime = Cesium.JulianDate.fromDate(zurichTime);
    viewer.clock.shouldAnimate = false; // optional — freezes the time


    try {
        const swisstopoTerrainProvider = await Cesium.CesiumTerrainProvider.fromUrl('https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1', {requestVertexNormals: true});
        //const swissBuildings = await Cesium.Cesium3DTileset.fromUrl('https://3d.geo.admin.ch/ch.swisstopo.swissbuildings3d.3d/v1/tileset.json');
        //const swissVegetation = await Cesium.Cesium3DTileset.fromUrl('https://3d.geo.admin.ch/ch.swisstopo.vegetation.3d/v1/tileset.json');
        const swissImageryLayer = new Cesium.ImageryLayer(
            new Cesium.WebMapTileServiceImageryProvider({
                url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/{TileMatrixSet}/{TileMatrix}/{TileCol}/{TileRow}.jpeg',
                tileMatrixSetID: '3857',
                minimunLevel: 0,
                maximumLevel: 28,
                layer: 'ch.swisstopo.swissimage',
                style: 'default',
                credit: new Cesium.Credit('geo.admin.ch'),

                // https://wmts.geo.admin.ch/1.0.0/WMTSCapabilities.xml
                rectangle: new Cesium.Rectangle.fromDegrees(
                    5.96,  // West (border with France)
                    45.82, // South (near Ticino)
                    10.49, // East (border with Austria)
                    47.81  // North (border with Germany)
                ),

            }),
        );
        viewer.imageryLayers.add(swissImageryLayer);
        viewer.terrainProvider = swisstopoTerrainProvider;
        //viewer.scene.primitives.add(swissBuildings);
        //viewer.scene.primitives.add(swissVegetation);
    } catch (error) {
        console.error(`Error : ${error}`);
    }

    viewer.scene.globe.depthTestAgainstTerrain = true; // Hide objects behind mountains

// Point camera (currently Belpmoos)


//lat: 46.91138,
    //lng: 7.4983,

    const defaultCamera = {
        lat: 47.004226,
        lng: 7.603225,
        alt: 2000,
        heading: 0,
        pitch: -45,
    };
    const initialDestination = Cesium.Cartesian3.fromDegrees(
        defaultCamera.lng,
        defaultCamera.lat,
        defaultCamera.alt
    );

    const initialOrientation = {
        heading: Cesium.Math.toRadians(defaultCamera.heading),
        pitch: Cesium.Math.toRadians(defaultCamera.pitch)
    };


    window.addEventListener("beforeunload", () => {
        const camera = viewer.camera;
        const pos = Cesium.Cartographic.fromCartesian(camera.positionWC);
        const savedView = {
            lng: Cesium.Math.toDegrees(pos.longitude),
            lat: Cesium.Math.toDegrees(pos.latitude),
            alt: pos.height,
            heading: Cesium.Math.toDegrees(camera.heading),
            pitch: Cesium.Math.toDegrees(camera.pitch),
        };
        localStorage.setItem("savedCameraView", JSON.stringify(savedView));
    });

    const savedCameraView = JSON.parse(localStorage.getItem("savedCameraView"));

    if (savedCameraView) {
        viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(
                savedCameraView.lng,
                savedCameraView.lat,
                savedCameraView.alt
            ),
            orientation: {
                heading: Cesium.Math.toRadians(savedCameraView.heading),
                pitch: Cesium.Math.toRadians(savedCameraView.pitch),
            },
        });
    } else {
        // fallback to default
        viewer.camera.setView({
            destination: initialDestination,
            orientation: initialOrientation,
        });
    }

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// SUITABILITY
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────


    let suitabilityGeojson = null;

    function getDiscreteColor(v) {

        if (v < 0.1) return Cesium.Color.fromCssColorString("#0d0887").withAlpha(0.6);
        if (v < 0.2) return Cesium.Color.fromCssColorString("#3f059c").withAlpha(0.6);
        if (v < 0.3) return Cesium.Color.fromCssColorString("#6700a8").withAlpha(0.6);
        if (v < 0.4) return Cesium.Color.fromCssColorString("#8f0da4").withAlpha(0.6);
        if (v < 0.5) return Cesium.Color.fromCssColorString("#b12a90").withAlpha(0.6);
        if (v < 0.6) return Cesium.Color.fromCssColorString("#cc4778").withAlpha(0.6);
        if (v < 0.7) return Cesium.Color.fromCssColorString("#e16462").withAlpha(0.6);
        if (v < 0.8) return Cesium.Color.fromCssColorString("#f2844b").withAlpha(0.6);
        if (v < 0.9) return Cesium.Color.fromCssColorString("#fca636").withAlpha(0.6);
        if (v < 1.0) return Cesium.Color.fromCssColorString("#fcce25").withAlpha(0.6);

        return Cesium.Color.fromCssColorString("#f0f921").withAlpha(0.6);
    }

    async function loadSuitabilityGeoJSON() {

        if (suitabilityGeojson) {
            viewer.dataSources.remove(suitabilityGeojson, true);
            suitabilityGeojson = null;
        }

        suitabilityGeojson = await Cesium.GeoJsonDataSource.load(
            "tiles/suitability/gb_suitability_klein.geojson",
            {
                stroke: Cesium.Color.BLACK,
                strokeWidth: 1,
                clampToGround: true
            }
        );

        viewer.dataSources.add(suitabilityGeojson);

        const entities = suitabilityGeojson.entities.values;

        entities.forEach(entity => {
            if (!entity.properties || !entity.properties.VALUE) return;
            if (!entity.polygon) return;

            const v = Number(entity.properties.VALUE.getValue());
            const color = getDiscreteColor(v);

            entity.polygon.material = color;
            entity.polygon.outline = true;
            entity.polygon.outlineColor = Cesium.Color.BLACK;

            // Disable all picking / popups
            entity.description = undefined;
            entity.name = undefined;
            entity.polygon.allowPicking = false;
        });
    }

    document.getElementById("suitabilityGeoToggle").addEventListener("change", function () {
        if (this.checked) {
            loadSuitabilityGeoJSON();
        } else {
            if (suitabilityGeojson) {
                viewer.dataSources.remove(suitabilityGeojson, true);
                suitabilityGeojson = null;
            }
        }
    });


// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// BUILDINGS AND VEGETATION VISIBILITY TOGGLES
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

// Function to toggle Imagery Layer (for heatmap)
    function toggleImageryLayer(layer, isVisible) {
        if (!layer) return;

        const imageryLayers = viewer.imageryLayers;

        if (isVisible) {
            if (imageryLayers.indexOf(layer) === -1) {
                imageryLayers.add(layer); // Add if not already present
            }
        } else {
            if (imageryLayers.indexOf(layer) !== -1) {
                imageryLayers.remove(layer, false); // `false` keeps it in memory for re-adding
            }
        }
    }

// Function to toggle visibility of 3D Tilesets
    function toggleTileset(tileset, isVisible) {
        if (tileset) {
            tileset.show = isVisible;
        }
    }

// Ensure swissBuildings and swissVegetation are defined globally
    let swissBuildings, swissVegetation;

// Wait for the tilesets to load, then store them globally
    async function loadSwissTopoData() {
        try {
            const swisstopoTerrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(
                'https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1',
                {requestVertexNormals: true}
            );

            swissBuildings = await Cesium.Cesium3DTileset.fromUrl(
                'https://3d.geo.admin.ch/ch.swisstopo.swissbuildings3d.3d/v1/tileset.json'
            );
            swissVegetation = await Cesium.Cesium3DTileset.fromUrl(
                'https://3d.geo.admin.ch/ch.swisstopo.vegetation.3d/v1/tileset.json'
            );

// Add to scene
            viewer.scene.primitives.add(swissBuildings);
            viewer.scene.primitives.add(swissVegetation);

// Set initial visibility based on checkboxes
            toggleTileset(swissBuildings, document.getElementById("buildingsToggle").checked);
            toggleTileset(swissVegetation, document.getElementById("vegetationToggle").checked);

            viewer.terrainProvider = swisstopoTerrainProvider;
        } catch (error) {
            console.error(`Error loading SwissTopo data: ${error}`);
        }
    }

// Call function to load the data
    loadSwissTopoData();

// Add event listeners for checkboxes
    document.getElementById("vegetationToggle").addEventListener("change", function () {
        toggleTileset(swissVegetation, this.checked);
    });

    document.getElementById("buildingsToggle").addEventListener("change", function () {
        toggleTileset(swissBuildings, this.checked);
    });


// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// INFO BUTTON
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

// Toggle Info Panel visibility
    document.getElementById('showInfoBtn').addEventListener('click', function () {
        const infoPanel = document.getElementById('infoPanel');
        infoPanel.style.display = (infoPanel.style.display === 'none' || infoPanel.style.display === '') ? 'block' : 'none';
    });


    document.addEventListener('mousedown', function (e) {
        const infoPanel = document.getElementById('infoPanel');
        const infoBtn = document.getElementById('showInfoBtn');
        if (!infoPanel.contains(e.target) && !infoBtn.contains(e.target)) {
            infoPanel.style.display = 'none';
        }
    });

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// DRAW POLYGON FOR PLACING TURBINES
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

    let drawing = false;
    let activeShapePoints = [];
    let activeShape;
    let floatingPoint;
    // Track all helper‐point entities so we can hide them later
    let activePointEntities = [];

    // helper function to toggle Cesium default event handling, so no interference!
    function toggleCesiumDefaultHandlers(enable) {
        const screenSpaceHandler = viewer.screenSpaceEventHandler;
        if (!screenSpaceHandler) return;

        if (!enable) {
            screenSpaceHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
            screenSpaceHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
        } else {

            screenSpaceHandler.setInputAction((movement) => {
                const picked = viewer.scene.pick(movement.position);

                // Completely ignore clicks on suitability polygons
                if (picked && picked.id && picked.id.dataSource === suitabilityGeojson) {
                    return; // ← Prevent popup
                }

                // normal selection
                viewer.selectedEntity = Cesium.defined(picked) ? picked.id : undefined;
            }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

            screenSpaceHandler.setInputAction(() => {
                viewer.selectedEntity = undefined;
            }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
        }
    }


    function toggleCameraInteractions(enable) {
        const controller = viewer.scene.screenSpaceCameraController;

        controller.enableRotate = enable;    // Right-drag to orbit scene
        controller.enableTranslate = enable; // Middle-drag to pan
        controller.enableLook = enable;      // Free-look mode (CTRL or similar)

        controller.enableTilt = true;        // Keep tilt allowed always
        controller.enableZoom = true;        // Keep zooming always
    }


    const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);

    // START DRAWING WITH LEFT CLICK
    handler.setInputAction((event) => {
        const picked = viewer.scene.pick(event.position);
        if (Cesium.defined(picked) && picked.id && picked.id.model) {
            // clicked a turbine → don’t start/continue a polygon
            return;
        }
        const earthPosition = viewer.scene.pickPosition(event.position);
        if (!Cesium.defined(earthPosition)) return;

        if (!drawing) {
            drawing = true;
            toggleCesiumDefaultHandlers(false);
            toggleCameraInteractions(false);
            activeShapePoints = [earthPosition];
            floatingPoint = createPoint(earthPosition);
            activeShape = drawShape(activeShapePoints);
        }

        activeShapePoints.push(earthPosition);
        createPoint(earthPosition);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // MOVE FLOATING POINT ON MOUSE MOVE
    handler.setInputAction((event) => {
        if (!drawing) return;
        const newPosition = viewer.scene.pickPosition(event.endPosition);
        if (!Cesium.defined(newPosition)) return;

        floatingPoint.position.setValue(newPosition);
        activeShapePoints.pop();
        activeShapePoints.push(newPosition);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // global storage
    const polygonTurbineRecords = [];
    let rotatingBlades = [];

    // RIGHT-CLICK: FINISH POLYGON AND PLACE CHOSEN NUMBER AND HUBHEIGHT OF TURBINES
    handler.setInputAction(async (clickEvent) => {
        // only finish drawing if we’re in draw‐mode; otherwise let selectHandler handle it
        if (!drawing) {
            return;
        }

        // finish drawing

        drawing = false;
        toggleCesiumDefaultHandlers(true);
        toggleCameraInteractions(true);
        // remove the floating preview point from the end of the array
        activeShapePoints.pop();

        // hide helper points
        activePointEntities.forEach(ent => ent.show = false);
        activePointEntities = [];

        // remove the floating preview point and temporary shape
        viewer.entities.remove(floatingPoint);
        viewer.entities.remove(activeShape);

        // draw the final polygon
        const polygonEntity = drawPolygon(activeShapePoints);

        // insert the values chosen by the user

        //const H = parseInt(document.getElementById('turbineHeight').value, 10);   // hub height
        const H = 100;

        // before pushing into polygonTurbineRecords
        const positionsCopy = activeShapePoints.slice(); // copy the final vertices

        // FIONA'S CHANGES
        let placedPositions = null;

        const newTurbines = await placeTurbinesInPolygon(
            activeShapePoints,
            H,
            (pp) => { placedPositions = pp; }
        );

        // store them so we never delete others, **and** remember N, H, and positions
        polygonTurbineRecords.push({
            polygon: polygonEntity,
            polygonVertices: positionsCopy,       // <-- keep the polygon geometry
            turbines: newTurbines,
            // store the actual turbine positions for API + later edits
             positions: placedPositions ?? [],     // <-- turbine ground positions only
            hubHeight: H
        });

        const polyRec = polygonTurbineRecords[polygonTurbineRecords.length - 1];

        showPolygonOptions(polyRec)
        showPolygonOutput(polyRec)
        // compute AEP for the whole polygon turbine set
        await computeAndUpdateOutputWind(polyRec);




    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);


    // TEMPORARY SHAPE
    function drawShape(positionData) {
        return viewer.entities.add({
            polygon: {
                hierarchy: new Cesium.CallbackProperty(() => {
                    return new Cesium.PolygonHierarchy(positionData);
                }, false),
                material: new Cesium.ColorMaterialProperty(
                    Cesium.Color.fromCssColorString('#ffcba4').withAlpha(0.5)
                ),
            },
        });
    }

    // FINAL POLYGON SHAPE
    function drawPolygon(positionData) {
        return viewer.entities.add({
            polygon: {
                hierarchy: new Cesium.PolygonHierarchy(positionData),
                material: Cesium.Color.fromCssColorString('#fadfad').withAlpha(0),
            },
        });
    }

    // VISUAL HELPER POINT
    function createPoint(worldPosition) {
        const ent = viewer.entities.add({
            position: worldPosition,
            point: {
                pixelSize: 8,
                color: Cesium.Color.fromCssColorString('#faf0e6'),
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
        });
        activePointEntities.push(ent);
        return ent;
    }


// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// PLACE TURBINES
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────


    // PLACE TURBINES INSIDE THE POLYGON
    async function placeTurbinesInPolygon(cartesians, hubHeight, onPlacedPositions_callback_function /* optional */ ) {
        const newEntities = [];

        // 1) Determine rotor radius based on hubHeight
        let rotorRadius;
        if (hubHeight === 150) rotorRadius = 450;
        else if (hubHeight === 125) rotorRadius = 350;
        else if (hubHeight === 100) rotorRadius = 250;
        else {
            console.error("Invalid hub height selected!");
            return [];
        }

        const rotorDiameter = rotorRadius * 2;

        // 2) Generate hexagonal positions
        const positions = generateHexagonalTurbinePositions(cartesians, rotorDiameter);

        // Important: Check if positions are generated
        if (positions.length === 0) {
            console.warn("No turbine positions could be generated. Polygon may be too small or spacing too large.");
            return [];
        }

        // 3) Sample terrain height
        const cartos = positions.map(([lon, lat]) =>
            new Cesium.Cartographic(
                Cesium.Math.toRadians(lon),
                Cesium.Math.toRadians(lat),
                0
            )
        );

        const detailed = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, cartos);
        // Collect *actual* placed ground positions (Cartesian3)
        const placedGroundPositions = [];

        // 4) Place turbines
        detailed.forEach(c => {
            const groundPos = Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, c.height);
            placedGroundPositions.push(groundPos);

            const cfg = {
                mastAndNacelleUri: `/tiles/turbines/mastandnacelle${hubHeight}.glb`,
                bladesAndHubUri: `/tiles/turbines/bladesandhub${hubHeight}center.glb`,
                hubheight: hubHeight
            };

            // Place mast + nacelle
            const mast = viewer.entities.add({
                name: "Wind Turbine",
                position: groundPos,
                model: {
                    uri: cfg.mastAndNacelleUri,
                    scale: 1,
                    runAnimations: false
                },
                description: `Initial hub height: ${cfg.hubheight} meters`
            });
            newEntities.push(mast);

            // Place blades at hub height
            const hubPos = Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, c.height + cfg.hubheight);

            const blades = viewer.entities.add({
                position: hubPos,
                orientation: Cesium.Transforms.headingPitchRollQuaternion(
                    hubPos,
                    new Cesium.HeadingPitchRoll(0, 0, 0)
                ),
                model: { uri: cfg.bladesAndHubUri, scale: 1, runAnimations: false }
            });
            newEntities.push(blades);
            rotatingBlades.push(blades);
        });

        // NEW: report placed positions back to caller if requested
        if (typeof onPlacedPositions_callback_function === "function") {
            onPlacedPositions_callback_function(placedGroundPositions);
        }

        return newEntities;
    }


    //ROTATE BLADES
    let rotationSpeed = Cesium.Math.toRadians(30); // 30° per second

    viewer.scene.preUpdate.addEventListener((scene, time) => {
        let deltaTime = Cesium.JulianDate.secondsDifference(time, viewer.clock.currentTime);  // Time difference between frames
        viewer.clock.currentTime = time;

        for (let blades of rotatingBlades) {
            let hpr = Cesium.HeadingPitchRoll.fromQuaternion(blades.orientation.getValue(time));

            // Compute deltaPitch as a product of the speed and deltaTime
            let deltaPitch = rotationSpeed * deltaTime;
            var startTime = Cesium.JulianDate.now();  // Start time
            var elapsedTime = Cesium.JulianDate.secondsDifference(time, startTime);
            var spinDuration = 10;  // Time to complete one full rotation (in seconds)


            // Update the pitch (and ensure we don't modify heading or roll)
            hpr.pitch = Cesium.Math.toRadians((elapsedTime / spinDuration) * 360);  // Increment pitch
            hpr.heading = 0;          // Keep heading constant
            hpr.roll = 0;             // Keep roll constant

            // Apply the updated rotation to the blades
            blades.orientation.setValue(
                Cesium.Transforms.headingPitchRollQuaternion(
                    blades.position.getValue(time),
                    hpr
                )
            );

            // Optional: Log heading, pitch, and roll for debugging
            //console.log(`Heading: ${hpr.heading}, Pitch: ${hpr.pitch}, Roll: ${hpr.roll}`);
        }
    });


// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

//defining globals
    let isDragging = false;
    let clickTimeout = null;
    let offset = null;
    let selectedGroup = null; // will hold [mastEntity, bladesEntity]
    let isMKeyDown = false;
    const sizeHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    const moveHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    let selectedPolygonRef = null;
    let moveCircleEntity = null;
    let resizeMode = false;

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// PRESSING E TO CLEAR THE SELECTION AND EXIT THE FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

    document.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();


        if (key === 'e') {
            // Exit all modes
            turbineSelectMode = false;
            resizeMode = false;
            viewer._container.style.cursor = '';

            if (selectedTurbineRef) {
                selectedTurbineRef.entities.forEach(ent => ent.model.color = undefined);
                selectedTurbineRef = null;
                document.getElementById('turbineOptions').style.display = 'none';
            }

            if (selectedPolygonRef) {
                selectedPolygonRef.polygon.polygon.material =
                    Cesium.Color.fromCssColorString('#fadfad').withAlpha(0.0);
                selectedPolygonRef = null;
                document.getElementById('polygonOptions').style.display = 'none';
            }

            if (clickTimeout !== null) {
                clearTimeout(clickTimeout);
                clickTimeout = null;
            }

            if (moveCircle) {
                viewer.entities.remove(moveCircle);
                moveCircle = null;
            }
        }
    });


// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// FUNCTION I: RIGHT CLICK + S TO SELECT A SINGLE TURBINE
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// TODO ENFORCE MINIMUM TURBINE DISTANCE
    let selectedTurbineRef = null;    // { entities: [mast, blades], record: polygonRecord }
    let turbineSelectMode = false;

// KEYDOWN / KEYUP TO TOGGLE S MODE
    window.addEventListener('keydown', e => {
        if (e.key.toLowerCase() === 's') {
            turbineSelectMode = true;
            viewer._container.style.cursor = 'crosshair';
        }
    });

    window.addEventListener('keyup', e => {
        if (e.key.toLowerCase() === 's') {
            turbineSelectMode = false;
            viewer._container.style.cursor = '';
        }
    });


    // define handler
    const turbineHandler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);

    // CHANGE CURSOR WHEN HOVERING OVER TURBINE
    turbineHandler.setInputAction(moveEvt => {
        if (turbineSelectMode) {
            const picked = viewer.scene.pick(moveEvt.endPosition);
            viewer._container.style.cursor = (picked && picked.id && picked.id.model)
                ? 'crosshair'
                : '';
        } else if (resizeMode) {
            const picked = viewer.scene.pick(moveEvt.endPosition);
            viewer._container.style.cursor = (picked && picked.id && picked.id.model)
                ? 'zoom-in'
                : '';
        } else {
            viewer._container.style.cursor = '';
        }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // RIGHT-CLICK + S: PICK A SINGLE TURBINE (MAST+BLADES TOGETHER)
    turbineHandler.setInputAction(clickEvt => {
        if (!turbineSelectMode) return;

        const picked = viewer.scene.pick(clickEvt.position);
        if (!Cesium.defined(picked) || !picked.id || !picked.id.model) return;

        // find parent polygon record
        const now = viewer.clock.currentTime;
        let parentRec = null;
        for (const rec of polygonTurbineRecords) {
            if (rec.turbines.includes(picked.id)) {
                parentRec = rec;
                break;
            }
        }
        if (!parentRec) return;

        // index of clicked entity in rec.turbines
        const idx = parentRec.turbines.indexOf(picked.id);

        // determine mast vs blades by URI
        const isMast = picked.id.model.uri.getValue(now)
            .includes('mastandnacelle');
        const mate = parentRec.turbines[isMast ? idx + 1 : idx - 1];
        if (!mate) return;

        // always [mast, blades]
        const group = isMast
            ? [picked.id, mate]
            : [mate, picked.id];

        // clear previous highlight
        if (selectedTurbineRef) {
            selectedTurbineRef.entities.forEach(ent => {
                ent.model.color = undefined;
            });
            document.getElementById('turbineOptions').style.display = 'none';
        }

        // highlight new group
        group.forEach(ent => {
            ent.model.color = new Cesium.ConstantProperty(
                Cesium.Color.fromCssColorString('#f8c373').withAlpha(0.6)
            );
        });


        // store & show options
        selectedTurbineRef = {entities: group, record: parentRec};
        showTurbineOptions(selectedTurbineRef);

        const mastEnt = group[0];     // always mast, because you built group as [mast, blades]



        let single_output = mastEnt.windOutput_kWh / 1000;
        single_output = Math.round(single_output/100) * 100;
        const output_text = `${single_output} MWh/year`;

        setSelectedWindOutput(output_text);



    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

    // showTurbineOptions: un-hide panel & set dropdown to current height
    function showTurbineOptions(ref) {
        const panel = document.getElementById('turbineOptions');
        panel.style.display = 'block';

        const now = viewer.clock.currentTime;
        const mast = ref.entities[0];
        const uri = mast.model.uri.getValue(now);
        const h = uri.includes('125') ? 125
            : uri.includes('100') ? 100
                : 150;

        document.getElementById('turbineHubHeight').value = String(h);
    }


    // CHANGE HUB HEIGHT FOR SELECTED TURBINE
    document.getElementById('turbineHubHeight').addEventListener('change', async function () {
        if (!selectedTurbineRef) return;
        const newH = parseInt(this.value, 10);
        const now = viewer.clock.currentTime;

        // remove old mast+blades
        const oldGroup = selectedTurbineRef.entities;
        oldGroup.forEach(e => viewer.entities.remove(e));
        rotatingBlades = rotatingBlades.filter(b => !oldGroup.includes(b));

        // compute base position
        const carto = Cesium.Cartographic.fromCartesian(
            oldGroup[0].position.getValue(now)
        );

        // add new mast
        const groundPos = Cesium.Cartesian3.fromRadians(
            carto.longitude, carto.latitude, carto.height
        );
        const mast = viewer.entities.add({
            position: groundPos,
            model: {uri: `/tiles/turbines/mastandnacelle${newH}.glb`, scale: 1}
        });

        // add new blades
        const hubPos = Cesium.Cartesian3.fromRadians(
            carto.longitude, carto.latitude, carto.height + newH
        );
        const blades = viewer.entities.add({
            position: hubPos,
            orientation: Cesium.Transforms.headingPitchRollQuaternion(
                hubPos, new Cesium.HeadingPitchRoll(0, 0, 0)
            ),
            model: {uri: `/tiles/turbines/bladesandhub${newH}center.glb`, scale: 1}
        });
        rotatingBlades.push(blades);

        // update record
        const rec = selectedTurbineRef.record;
        rec.turbines = rec.turbines
            .filter(e => !oldGroup.includes(e))
            .concat([mast, blades]);
        // FIONA'S CHANGES
        rec.hubHeight = newH;

        // highlight new ones
        [mast, blades].forEach(ent => {
            ent.model.color = new Cesium.ConstantProperty(
                Cesium.Color.fromCssColorString('#f8c373').withAlpha(0.6)
            );
        });

        // update selection
        selectedTurbineRef.entities = [mast, blades];

        // FIONA'S CHANGES
        showPolygonOptions(selectedTurbineRef)
        showPolygonOutput(selectedTurbineRef)
        await computeAndUpdateOutputWind(selectedTurbineRef);
    });


    // DELETE SINGLE TURBINE

    document.getElementById('deleteTurbineBtn').onclick = async () => {
        if (!selectedTurbineRef) return;

        const rec = selectedTurbineRef.record;

        // --- compute turbine index BEFORE modifying arrays ---
        // We assume selectedTurbineRef.entities = [mast, blades]
        const mastEntity = selectedTurbineRef.entities[0];
        const mastIdxInRec = rec.turbines.indexOf(mastEntity);
        const turbineIndex = mastIdxInRec >= 0 ? Math.floor(mastIdxInRec / 2) : -1;

        // remove from view
        selectedTurbineRef.entities.forEach(e => viewer.entities.remove(e));
        rotatingBlades = rotatingBlades.filter(b => !selectedTurbineRef.entities.includes(b));

        // remove from record: turbines (entities)
        rec.turbines = rec.turbines.filter(e => !selectedTurbineRef.entities.includes(e));

        // remove from record: positions (one per turbine)
        if (turbineIndex >= 0 && Array.isArray(rec.positions)) {
            rec.positions.splice(turbineIndex, 1);
        }

        // clear selection & hide panel
        selectedTurbineRef = null;
        document.getElementById('turbineOptions').style.display = 'none';

        // recompute polygon output (and per-turbine outputs)
        await computeAndUpdateOutputWind(rec);
    };



// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// FUNCTION II: RIGHT CLICK TO SELECT POLYGON
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

    const selectHandler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);

    selectHandler.setInputAction((clickEvent) => {
        if (drawing) return;
        if (isMKeyDown) return;
        const picked = viewer.scene.pick(clickEvent.position);
        if (!Cesium.defined(picked) || !picked.id || !picked.id.polygon) return;

        // find in YOUR store
        const ref = polygonTurbineRecords.find(r => r.polygon === picked.id);
        if (!ref) return;

        // un‐highlight old
        if (selectedPolygonRef) {
            selectedPolygonRef.polygon.polygon.material =
                Cesium.Color.fromCssColorString('#fadfad').withAlpha(0.0);
        }

        // highlight new
        ref.polygon.polygon.material = Cesium.Color.fromCssColorString('#fffab1').withAlpha(0.6);
        selectedPolygonRef = ref;
        showPolygonOptions(ref);
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

    selectHandler.setInputAction((moveEvent) => {
        const picked = viewer.scene.pick(moveEvent.endPosition);
        const overPoly = picked && polygonTurbineRecords.some(r => r.polygon === picked.id);
        viewer._container.style.cursor = overPoly ? 'pointer' : '';
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    document.getElementById('deletePolygonBtn').onclick = () => {
        if (!selectedPolygonRef) return;

        selectedPolygonRef.turbines.forEach(e => viewer.entities.remove(e));
        // if you track panels: selectedPolygonRef.panels.forEach(...)
        viewer.entities.remove(selectedPolygonRef.polygon);

        const idx = polygonTurbineRecords.indexOf(selectedPolygonRef);
        if (idx !== -1) {
            polygonTurbineRecords.splice(idx, 1);
        }

        selectedPolygonRef = null;
        document.getElementById('polygonOptions').style.display = 'none';
        // FIONA'S CHANGES
        closePolygonOutput()
    };

    function showPolygonOptions(ref) {
        const panel = document.getElementById('polygonOptions');
        panel.style.display = 'block';

        // set the hub-height select to the current value
        const hubSel = document.getElementById('polyHubHeight');
        hubSel.value = String(ref.hubHeight);
    }

    // whenever the user picks a new hub height in the panel:
    document.getElementById('polyHubHeight').addEventListener('change', async function () {
        if (!selectedPolygonRef) return;

        const newH = parseInt(this.value, 10);
        const ref = selectedPolygonRef;

        // 1) remove old turbines
        ref.turbines.forEach(e => viewer.entities.remove(e));

        // FIONA'S CHANGES
        let placedPositions = null;

        const verts = getPolygonVerticesCartesian(ref);
        // 2) place new ones at the same polygon & count
        const replacements = await placeTurbinesInPolygon(
            verts,
            newH,
            (pp)=>{ placedPositions = pp; }
        );

        // 3) update the record
        ref.turbines = replacements;
        ref.hubHeight = newH;

        // FIONA'S CHANGES
        // update turbine positions to the actual placed ground positions
        if (placedPositions) ref.positions = placedPositions;
        await computeAndUpdateOutputWind(ref);
    });


   // FIONA'S CHANGES

    async function runOptimization() {
        const loaderEl = document.getElementById("optimizerLoader");
        loaderEl.hidden = false;

        const loader = getCanvasLoader();  // <-- ensures not null
        loader.start();

        let ref = null

      try {
        ref = await optimizePolygon(selectedPolygonRef, viewer, rotatingBlades);
      } finally {
          loader.stop();
          loaderEl.hidden = true;
      }
     await computeAndUpdateOutputWind(ref);
    }

    document.getElementById("optimizePolygonBtn").addEventListener("click", runOptimization);



// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// FUNCTION III: RIGHT CLICK + R TO RESIZE TURBINE
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────


    // KEYDOWN / KEYUP TO TOGGLE S MODE
    window.addEventListener('keydown', e => {
        if (e.key.toLowerCase() === 'r') {
            resizeMode = true;
            viewer._container.style.cursor = 'zoom-in';
        }
    });

    window.addEventListener('keyup', e => {
        if (e.key.toLowerCase() === 'r') {
            resizeMode = false;
            // clear any hover cursor
            viewer._container.style.cursor = '';
        }
    });

    sizeHandler.setInputAction((click) => {
        if (!resizeMode) return;

        const picked = viewer.scene.pick(click.position);
        if (!Cesium.defined(picked) || !picked.id || !picked.id.model) return;

        const pos = picked.id.position.getValue(Cesium.JulianDate.now());
        const carto = Cesium.Cartographic.fromCartesian(pos);
        const entities = viewer.entities.values.filter(ent => {
            if (!ent.position) return false;
            const c = Cesium.Cartographic.fromCartesian(ent.position.getValue(Cesium.JulianDate.now()));
            return Cesium.Math.equalsEpsilon(c.longitude, carto.longitude, Cesium.Math.EPSILON7) &&
                Cesium.Math.equalsEpsilon(c.latitude, carto.latitude, Cesium.Math.EPSILON7);
        });
        if (entities.length < 2) return;

        const models = [
            {mast: "mastandnacelle100.glb", blades: "bladesandhub100center.glb", h: 100},
            {mast: "mastandnacelle125.glb", blades: "bladesandhub125center.glb", h: 125},
            {mast: "mastandnacelle150.glb", blades: "bladesandhub150center.glb", h: 150}
        ];

        const uris = entities.map(ent => ent.model.uri.getValue(Cesium.JulianDate.now()));
        let idx = models.findIndex(m =>
            uris.some(u => u.includes(m.mast)) || uris.some(u => u.includes(m.blades))
        );
        idx = (idx + 1) % models.length;
        const next = models[idx];

        const terrainH = viewer.scene.globe.getHeight(carto) || 0;
        entities.forEach(ent => {
            const u = ent.model.uri.getValue(Cesium.JulianDate.now());
            if (u.includes("mastandnacelle")) {
                ent.model.uri = new Cesium.ConstantProperty(`/tiles/turbines/${next.mast}`);
                ent.position = Cesium.Cartesian3.fromDegrees(
                    Cesium.Math.toDegrees(carto.longitude),
                    Cesium.Math.toDegrees(carto.latitude),
                    terrainH
                );
            } else {
                ent.model.uri = new Cesium.ConstantProperty(`/tiles/turbines/${next.blades}`);
                ent.position = Cesium.Cartesian3.fromDegrees(
                    Cesium.Math.toDegrees(carto.longitude),
                    Cesium.Math.toDegrees(carto.latitude),
                    terrainH + next.h
                );
            }
        });
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);


// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// FUNCTION IV: MOVING A TURBINE BY RIGHT CLICK AND DRAGGING
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

    let moveCircle = null;

    document.addEventListener("keydown", (e) => {
        if (e.key.toLowerCase() === "m") {
            isMKeyDown = true;
            viewer._container.style.cursor = 'move';
        }
    });
    document.addEventListener("keyup", (e) => {
        if (e.key.toLowerCase() === "m") {
            isMKeyDown = false;
            viewer._container.style.cursor = '';
        }
    });

    // SELECTING THE TURBINE BY RIGHT CLICK
    moveHandler.setInputAction((down) => {
        if (!isMKeyDown) return;
        viewer.scene.screenSpaceCameraController.enableInputs = false;
        isDragging = true;
        clearTimeout(clickTimeout);

        const picked = viewer.scene.pick(down.position);
        if (!Cesium.defined(picked) || !picked.id) return;

        const pos = picked.id.position.getValue(Cesium.JulianDate.now());
        const carto = Cesium.Cartographic.fromCartesian(pos);
        selectedGroup = viewer.entities.values.filter(ent => {
            if (!ent.position) return false;
            const c = Cesium.Cartographic.fromCartesian(ent.position.getValue(Cesium.JulianDate.now()));
            return Cesium.Math.equalsEpsilon(c.longitude, carto.longitude, Cesium.Math.EPSILON7) &&
                Cesium.Math.equalsEpsilon(c.latitude, carto.latitude, Cesium.Math.EPSILON7);
        });

        // OFFSET
        const pickGlobe = viewer.scene.globe.pick(
            viewer.camera.getPickRay(down.position),
            viewer.scene
        );

        if (pickGlobe) {
            const pc = Cesium.Cartographic.fromCartesian(pickGlobe);
            offset = {
                lon: carto.longitude - pc.longitude,
                lat: carto.latitude - pc.latitude,
                height: carto.height - (viewer.scene.globe.getHeight(pc) || 0)
            };
        }

        // GET HUB HEIGHT FROM URI
        const uri = picked.id.model.uri.getValue(Cesium.JulianDate.now()) || "";
        const hubHeight = uri.includes("150") ? 150 : uri.includes("125") ? 125 : 100;
        const rotorRadius = hubHeight === 150 ? 900 : hubHeight === 125 ? 700 : 500;

        const terrainHeight = viewer.scene.globe.getHeight(carto) || 0;

        moveCircle = viewer.entities.add({
            position: Cesium.Cartesian3.fromRadians(
                carto.longitude,
                carto.latitude,
                terrainHeight + 2.0 // float slightly above terrain
            ),
            ellipse: {
                semiMajorAxis: rotorRadius,
                semiMinorAxis: rotorRadius,
                material: Cesium.Color.fromCssColorString('#b65986').withAlpha(0.4),
                heightReference: Cesium.HeightReference.NONE
            }
        });

        // DRAGGING
        moveHandler.setInputAction((move) => {
            const ray = viewer.camera.getPickRay(move.endPosition);
            const p = viewer.scene.globe.pick(ray, viewer.scene);
            if (!p || !selectedGroup) return;

            const nc = Cesium.Cartographic.fromCartesian(p);
            const th = viewer.scene.globe.getHeight(nc) || 0;

            selectedGroup.forEach(ent => {
                const uri = ent.model.uri.getValue(Cesium.JulianDate.now());
                if (uri.includes("mastandnacelle")) {
                    ent.position = Cesium.Cartesian3.fromDegrees(
                        Cesium.Math.toDegrees(nc.longitude + offset.lon),
                        Cesium.Math.toDegrees(nc.latitude + offset.lat),
                        th + offset.height
                    );
                } else {
                    const h = uri.includes("100") ? 100 :
                        uri.includes("125") ? 125 : 150;
                    ent.position = Cesium.Cartesian3.fromDegrees(
                        Cesium.Math.toDegrees(nc.longitude + offset.lon),
                        Cesium.Math.toDegrees(nc.latitude + offset.lat),
                        th + h + offset.height
                    );
                }
            });

            if (moveCircle) {
                moveCircle.position = Cesium.Cartesian3.fromRadians(
                    nc.longitude + offset.lon,
                    nc.latitude + offset.lat,
                    th + offset.height + 2.0
                );
            }
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    }, Cesium.ScreenSpaceEventType.RIGHT_DOWN);

    document.addEventListener("mouseup", () => {
        isMKeyDown = false;
        viewer._container.style.cursor = '';
        viewer.scene.screenSpaceCameraController.enableInputs = true;
    });


    // STOP DRAGGING
    moveHandler.setInputAction(() => {
        moveHandler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        isDragging = false;
        selectedGroup = null;
        viewer.scene.screenSpaceCameraController.enableInputs = true;

        if (moveCircle) {
            viewer.entities.remove(moveCircle);
            moveCircle = null;
        }
        isMKeyDown = false;                 // <-- ADD THIS
        viewer._container.style.cursor = ''; // <-- and this
    }, Cesium.ScreenSpaceEventType.RIGHT_UP);


// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// FUNCTION V: ADDING A NEW TURBINE BY N + RIGHT CLICK
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

    let addTurbineMode = false;

    window.addEventListener('keydown', e => {
        if (e.key.toLowerCase() === 'n') {
            addTurbineMode = true;
            viewer._container.style.cursor = 'copy';
            viewer.scene.screenSpaceCameraController.enableInputs = false;
        }
    });
    window.addEventListener('keyup', e => {
        if (e.key.toLowerCase() === 'n') {
            addTurbineMode = false;
            viewer._container.style.cursor = '';
            viewer.scene.screenSpaceCameraController.enableInputs = true;
        }
    });

    const addTurbineHandler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);

    addTurbineHandler.setInputAction(async function (clickEvt) {
        if (!addTurbineMode) return;

        let earthPosition = viewer.scene.pickPosition(clickEvt.position);

        // Fallback: pick globe if terrain fails
        if (!Cesium.defined(earthPosition)) {
            earthPosition = viewer.scene.globe.pick(
                viewer.camera.getPickRay(clickEvt.position),
                viewer.scene
            );
        }
        if (!Cesium.defined(earthPosition)) {
            alert("Couldn't pick a position on the globe.");
            return;
        }

        // Get selected hub height
        //const H = parseInt(document.getElementById('turbineHeight').value, 10);
        const H = 100;

        // Sample terrain height at that position
        const carto = Cesium.Cartographic.fromCartesian(earthPosition);
        const terrainHeights = await Cesium.sampleTerrainMostDetailed(
            viewer.terrainProvider, [carto]
        );
        const groundHeight = terrainHeights[0].height;

        // Place mast & nacelle
        const groundPos = Cesium.Cartesian3.fromRadians(
            carto.longitude, carto.latitude, groundHeight
        );
        const mast = viewer.entities.add({
            name: "Wind Turbine",
            position: groundPos,
            model: {
                uri: `tiles/turbines/mastandnacelle${H}.glb`,
                scale: 1,
                runAnimations: false
            },
            description: `Hub height: ${H} meters`
        });

        // Place blades at hub height
        const hubPos = Cesium.Cartesian3.fromRadians(
            carto.longitude, carto.latitude, groundHeight + H
        );
        const blades = viewer.entities.add({
            position: hubPos,
            orientation: Cesium.Transforms.headingPitchRollQuaternion(
                hubPos, new Cesium.HeadingPitchRoll(0, 0, 0)
            ),
            model: {
                uri: `tiles/turbines/bladesandhub${H}center.glb`,
                scale: 1,
                runAnimations: false
            }
        });
        rotatingBlades.push(blades);

        // Add the new turbine to polygonTurbineRecords as a single-turbine "polygon"
        const record = {
            polygon: null,             // Not part of a polygon
            turbines: [mast, blades],  // Mast and blades
            positions: [earthPosition],// Store position as array for compatibility
            hubHeight: H
        };
        polygonTurbineRecords.push(record);

        // Highlight the new turbine and show options panel
        if (selectedTurbineRef) {
            selectedTurbineRef.entities.forEach(ent => ent.model.color = undefined);
            document.getElementById('turbineOptions').style.display = 'none';
        }
        mast.model.color = new Cesium.ConstantProperty(
            Cesium.Color.fromCssColorString('#f8c373').withAlpha(0.6)
        );
        blades.model.color = new Cesium.ConstantProperty(
            Cesium.Color.fromCssColorString('#f8c373').withAlpha(0.6)
        );

        selectedTurbineRef = {entities: [mast, blades], record: record};
        showTurbineOptions(selectedTurbineRef);

        // FIONA'S CHANGES
        await computeAndUpdateOutputWind(selectedTurbineRef);

    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

};

main();