import "./style-solar.css";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "../solar_output/PV_api.js";
import {computeAndUpdatePVOutput, setSpacingUI} from "../solar_output/PV_api.js";
import {closePolygonPVOutput, showPolygonPVOutput} from "../solar_output/solar_output_ui.js"

console.log("main.js loaded");


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
// FUNCTION 0
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

//-----------------------------------------------------------
// Accurate viewer-perspective placement with pickPosition()
//-----------------------------------------------------------

    let viewerPlacementArmed = false;

    window.addEventListener("keydown", function (e) {
        if (e.key === "g" || e.key === "G") {
            viewerPlacementArmed = true;
            console.log("Viewer placement: READY (right-click on terrain)");
        }
    });

    const placementHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    placementHandler.setInputAction(async function (click) {
        if (!viewerPlacementArmed) return;
        viewerPlacementArmed = false;

        const scene = viewer.scene;

        // Most accurate method: pickPosition (uses depth buffer)
        let worldPosition = scene.pickPosition(click.position);

        if (!Cesium.defined(worldPosition)) {
            // Fallback: ray -> globe intersection
            const ray = viewer.camera.getPickRay(click.position);
            worldPosition = scene.globe.pick(ray, scene);
        }

        if (!Cesium.defined(worldPosition)) {
            console.warn("Could not determine click position on terrain.");
            return;
        }

        // Raise camera height by 1.8 m for human eye level
        let carto = Cesium.Cartographic.fromCartesian(worldPosition);
        carto.height += 1.8;

        const eyePosition = Cesium.Cartographic.toCartesian(carto);

        // Keep current camera heading
        const heading = viewer.camera.heading;
        const pitch = 0;
        const roll = 0;

        viewer.camera.flyTo({
            destination: eyePosition,
            orientation: {
                heading,
                pitch,
                roll,
            },
            duration: 0.5
        });

        console.log("Accurate camera landing achieved.");
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);


// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// FUNCTION VI: display prüfgebiete
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

// PRÜFGEBIETE TOGGLE

    let pruefgebieteLayer = null; // Global variable to hold the GeoJSON datasource

// Load the GeoJSON but don't add to viewer yet
    Cesium.GeoJsonDataSource.load('/tiles/energy/jura_pruef.geojson', {
        stroke: Cesium.Color.RED,
        fill: Cesium.Color.YELLOW.withAlpha(0.6),
        strokeWidth: 2,
        clampToGround: true
    })
        .then(function (dataSource) {
            pruefgebieteLayer = dataSource; // Store reference
            // Initially hidden, so do not add to viewer yet
        });

// Function to toggle prüfgebiete
    function togglePruefgebiete(isVisible) {
        if (!pruefgebieteLayer) return;

        if (isVisible) {
            if (!viewer.dataSources.contains(pruefgebieteLayer)) {
                viewer.dataSources.add(pruefgebieteLayer);
                //viewer.zoomTo(pruefgebieteLayer); // Optional: zoom when first displayed
            }
        } else {
            if (viewer.dataSources.contains(pruefgebieteLayer)) {
                viewer.dataSources.remove(pruefgebieteLayer, false); // false = keep in memory for re-add
            }
        }
    }

// Add event listener to your toggle checkbox
    document.getElementById("pruefgebieteToggle").addEventListener("change", function () {
        togglePruefgebiete(this.checked);
    });


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

        return Cesium.Color.fromCssColorString("#f0f921").withAlpha(0.6); // best category
    }


    async function loadSuitabilityGeoJSON() {

        // Remove existing layer if present
        if (suitabilityGeojson) {
            viewer.dataSources.remove(suitabilityGeojson, true);
            suitabilityGeojson = null;
        }

        // Load new GeoJSON
        suitabilityGeojson = await Cesium.GeoJsonDataSource.load(
            "/tiles/suitability/gb_suitability_klein.geojson",
            {
                stroke: Cesium.Color.BLACK,
                strokeWidth: 1,
                clampToGround: true
            }
        );

        suitabilityGeojson = await Cesium.GeoJsonDataSource.load(
            "/tiles/suitability/gb_suitability_klein.geojson",
            {
                stroke: Cesium.Color.BLACK,
                strokeWidth: 1,
                clampToGround: true
            }
        );

// Set the popup title for every entity
        suitabilityGeojson.entities.values.forEach(entity => {
            entity.name = "suitability";
        });


        viewer.dataSources.add(suitabilityGeojson);

        // ⚠ Wait until Cesium actually creates the polygon primitives
        const entities = suitabilityGeojson.entities.values;

        entities.forEach(entity => {
            if (!entity.properties || !entity.properties.VALUE) return;
            if (!entity.polygon) return;

            const v = Number(entity.properties.VALUE.getValue());
            const color = getDiscreteColor(v);

            entity.polygon.material = color;
            entity.polygon.outline = true;
            entity.polygon.outlineColor = Cesium.Color.BLACK;
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


// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// INFO BUTTON
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

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


// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// DRAW POLYGON FOR PLACING SOLAR PANELS
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

//HELPER FUNCTIONS

    let drawing = false;
    let activeShapePoints = [];
    let activeShape, floatingPoint;

// Track all helper-point entities so we can hide them later
    let activePointEntities = [];

    function toggleCesiumDefaultHandlers(enable) {
        const screenSpaceHandler = viewer.screenSpaceEventHandler;
        if (!screenSpaceHandler) return;

        if (!enable) {
            // Disable Cesium’s default left-click and double-click picking
            screenSpaceHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
            screenSpaceHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
        } else {
            // Reattach simple default entity selection (same as Cesium default)
            screenSpaceHandler.setInputAction((movement) => {
                const picked = viewer.scene.pick(movement.position);
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


// GLOBAL COUNTER FOR POLYGON IDs
    let polygonCounter = 1;

// Two handlers: one for drawing, one for selection
    const drawHandler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
    const selectHandler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);

// Store each polygon + its panels + orientation
    const polygonDataStore = [];
    let selectedPolygonRef = null;

// VISUAL HELPER POINT
    function createPoint(worldPosition) {
        const ent = viewer.entities.add({
            position: worldPosition,
            point: {
                pixelSize: 8,
                color: Cesium.Color.fromCssColorString('#faf0e6'),
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
            }
        });
        activePointEntities.push(ent);
        return ent;
    }

// TEMPORARY SHAPE
    function drawShape(positionData) {
        return viewer.entities.add({
            polygon: {
                hierarchy: new Cesium.CallbackProperty(() => new Cesium.PolygonHierarchy(positionData), false),
                material: Cesium.Color.fromCssColorString('#ffcba4').withAlpha(0.5)
            }
        });
    }

// FINAL POLYGON SHAPE
    function drawPolygon(positionData) {
        return viewer.entities.add({
            polygon: {
                hierarchy: new Cesium.PolygonHierarchy(positionData),
                material: Cesium.Color.fromCssColorString('#fadfad').withAlpha(0)
            }
        });
    }

// STORING POLYGON AND PANELS
    function storePolygonWithPanels(polygonEntity, panelEntities, orientation, positions, spacing, y, rows) {
        // FIONA'S CHANGE
        const panelsArray = Array.isArray(panelEntities) ? panelEntities.slice() : Array.from(panelEntities ?? []);
        polygonDataStore.push({
            id: polygonEntity.id,
            polygon: polygonEntity,
            panels: panelsArray,
            orientation: orientation,
            positions: positions.slice(),
            spacing: spacing,
            y: y,
            no_one_or_multiple_rows: rows
        });
    }


// START DRAWING WITH LEFT CLICK

    drawHandler.setInputAction((event) => {
        // 1) If clicking an existing polygon, bail so selectHandler can run
        const picked = viewer.scene.pick(event.position);
        if (picked && picked.id && polygonDataStore.find(p => p.polygon === picked.id)) {
            return;
        }

        // 2) Get earth position
        const earthPosition = viewer.scene.pickPosition(event.position);
        if (!Cesium.defined(earthPosition)) return;

        // 3) If first click, initialize drawing
        if (!drawing) {
            drawing = true;
            toggleCesiumDefaultHandlers(false);
            toggleCameraInteractions(false);
            activeShapePoints = [earthPosition];
            // add helper point
            floatingPoint = createPoint(earthPosition);
            // draw live polygon
            activeShape = drawShape(activeShapePoints);
            return;
        }

        // 4) Subsequent clicks: commit floating point & add new helper
        activeShapePoints.push(earthPosition);
        const pt = createPoint(earthPosition);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // MOVE FLOATING POINT ON MOUSE MOVE
    drawHandler.setInputAction((event) => {
        if (!drawing) return;
        const newPosition = viewer.scene.pickPosition(event.endPosition);
        if (!Cesium.defined(newPosition)) return;

        floatingPoint.position.setValue(newPosition);
        activeShapePoints.pop();
        activeShapePoints.push(newPosition);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // RIGHT-CLICK: FINISH POLYGON AND PLACE SOLAR PANELS
    drawHandler.setInputAction(async () => {
        if (!drawing) return;
        drawing = false;
        toggleCesiumDefaultHandlers(true);
        toggleCameraInteractions(true);
        // remove live preview
        viewer.entities.remove(activeShape);

        // drop the last floating preview point
        activeShapePoints.pop();

        // hide helper points
        activePointEntities.forEach(ent => ent.show = false);
        activePointEntities = [];

        // remove the floating point itself
        viewer.entities.remove(floatingPoint);

        // draw final polygon
        //const polygonEntity = drawPolygon(activeShapePoints);


        // assign a unique, stable ID
        // assign a unique, stable ID
        const polygonId = `polygon${polygonCounter++}`;

        // draw final polygon
        const polygonEntity = viewer.entities.add({
            id: polygonId,
            polygon: {
                hierarchy: new Cesium.PolygonHierarchy(activeShapePoints),
                material: Cesium.Color.fromCssColorString('#fadfad').withAlpha(0)
            }
        });


        // draw outline
        // FIONA'S CHANGE
        const outlinePositions = [...activeShapePoints, activeShapePoints[0]];

        /*const outlineEntity = viewer.entities.add({
            polyline: {
                positions: outlinePositions,
                width: 2,
                material: Cesium.Color.fromCssColorString("#fadfad"),
                clampToGround: true
            }
        });*/


        let spacing = 5;

        // place panels with that spacing
        let panels = [];
        let rows = 0;

        if (currentOrientation === 'south') {
            const result = await placeSolarPanelsFacingSouth(activeShapePoints, spacing);
            panels = result.panels;
            spacing = result.spacing; // computed spacing
            rows = result.no_one_or_multiple_rows;
            console.log(spacing);
        } else {
            const result = await placeSolarPanelsDownslope(activeShapePoints, spacing);
            panels = result.panels;
            spacing = result.spacing;
            rows = result.no_one_or_multiple_rows;
        }


        // STORE PANELS
        // Compute polygon center
        const avgX = activeShapePoints.reduce((sum, p) => sum + p.x, 0) / activeShapePoints.length;
        const avgY = activeShapePoints.reduce((sum, p) => sum + p.y, 0) / activeShapePoints.length;
        const avgZ = activeShapePoints.reduce((sum, p) => sum + p.z, 0) / activeShapePoints.length;
        const centerCartesian = new Cesium.Cartesian3(avgX, avgY, avgZ);

        // Convert to Cartographic
        const centerCarto = Cesium.Cartographic.fromCartesian(centerCartesian);

        // Sample terrain at center
        const [sampledHeight] = await Cesium.sampleTerrainMostDetailed(
            viewer.terrainProvider,
            [centerCarto]
        );

        const y = sampledHeight.height > 1500 ? 0.65 : 2.0;


        storePolygonWithPanels(
            polygonEntity,
            panels,
            currentOrientation,
            activeShapePoints,
            spacing,
            y,
            rows
        );

        selectedPolygonRef = polygonDataStore[polygonDataStore.length - 1]

        // API ANNUAL KWH CALL
        // FIONA'S CHANGES
        showPolygonOptions(selectedPolygonRef);
        setSpacingUI(selectedPolygonRef.spacing);
        showPolygonPVOutput(selectedPolygonRef);
        await computeAndUpdatePVOutput(selectedPolygonRef);

    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);


// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────


// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// FUNCTION III: PLACE SOLAR PANELS FACING DOWNSLOPE
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

    async function placeSolarPanelsDownslope(cartesianPositions, spacingDown = 5, spacingPerp = 5.7) {
        const panelEntities = [];
        // panels must fit within polygon
        if (cartesianPositions.length < 3) {
            return { panels: [], spacing: spacingDown, no_one_or_multiple_rows: 0 };
        }


        const cartoPositions = Cesium.Ellipsoid.WGS84.cartesianArrayToCartographicArray(cartesianPositions);

        const polygonDegrees = cartoPositions.map(p => [
            Cesium.Math.toDegrees(p.longitude),
            Cesium.Math.toDegrees(p.latitude)
        ]);

        const edgeBufferMeters = spacingPerp / 2;

        // Center of polygon
        const avgLon = polygonDegrees.reduce((a, b) => a + b[0], 0) / polygonDegrees.length;
        const avgLat = polygonDegrees.reduce((a, b) => a + b[1], 0) / polygonDegrees.length;

        const centerCartographic = Cesium.Cartographic.fromDegrees(avgLon, avgLat);
        const centerCartesian = Cesium.Cartesian3.fromDegrees(avgLon, avgLat);
        const enuMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(centerCartesian);

        // Estimate slope direction around center point
        const slopeOffset = 10; // meters
        const offsets = [
            {dx: -slopeOffset, dy: 0},
            {dx: slopeOffset, dy: 0},
            {dx: 0, dy: -slopeOffset},
            {dx: 0, dy: slopeOffset},
        ];

        const offsetCartographics = await Cesium.sampleTerrainMostDetailed(
            viewer.terrainProvider,
            offsets.map(({dx, dy}) => {
                const offsetENU = Cesium.Cartesian3.fromElements(dx, dy, 0);
                const world = Cesium.Matrix4.multiplyByPoint(enuMatrix, offsetENU, new Cesium.Cartesian3());
                return Cesium.Cartographic.fromCartesian(world);
            })
        );

        const dzdx = (offsetCartographics[1].height - offsetCartographics[0].height) / (2 * slopeOffset);
        const dzdy = (offsetCartographics[3].height - offsetCartographics[2].height) / (2 * slopeOffset);
        const slopeLength = Math.hypot(dzdx, dzdy);

        const downslope = {
            x: -dzdx / slopeLength,
            y: -dzdy / slopeLength
        };
        const perpendicular = {
            x: -downslope.y,
            y: downslope.x
        };

        // Generate grid in ENU space
        const gridSizeHalf = 1000; // meters
        const allPointsENU = [];

        for (let x = -gridSizeHalf; x <= gridSizeHalf; x += spacingPerp) {
            for (let y = -gridSizeHalf; y <= gridSizeHalf; y += spacingDown) {
                const e = x * perpendicular.x + y * downslope.x;
                const n = x * perpendicular.y + y * downslope.y;
                const pointENU = Cesium.Cartesian3.fromElements(e, n, 0);
                //calculate new downslope with
                //downslope =
                allPointsENU.push(pointENU);
            }
        }

        // Convert ENU points to world positions
        const worldPoints = allPointsENU.map(p =>
            Cesium.Matrix4.multiplyByPoint(enuMatrix, p, new Cesium.Cartesian3())
        );
        const cartoGrid = worldPoints.map(p => Cesium.Cartographic.fromCartesian(p));

        // Haversine distance between two lat/lon points
        function haversine(lat1, lon1, lat2, lon2) {
            const R = 6371000; // Earth radius in meters
            const toRad = Cesium.Math.toRadians;
            const dLat = toRad(lat2 - lat1);
            const dLon = toRad(lon2 - lon1);
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
            return 2 * R * Math.asin(Math.sqrt(a));
        }

        // Distance from point to polygon edge (in meters)
        function minEdgeDistance(lat, lon, polygon) {
            let minDist = Infinity;
            for (let i = 0; i < polygon.length; i++) {
                const [x1, y1] = polygon[i];
                const [x2, y2] = polygon[(i + 1) % polygon.length];

                // Project onto segment
                const dx = x2 - x1;
                const dy = y2 - y1;
                const t = Math.max(0, Math.min(1, ((lon - x1) * dx + (lat - y1) * dy) / (dx * dx + dy * dy)));
                const projLon = x1 + t * dx;
                const projLat = y1 + t * dy;
                const dist = haversine(lat, lon, projLat, projLon);
                if (dist < minDist) minDist = dist;
            }
            return minDist;
        }

        // Point-in-polygon with buffer
        function isInsideWithBuffer(point) {
            const lon = Cesium.Math.toDegrees(point.longitude);
            const lat = Cesium.Math.toDegrees(point.latitude);

            // Ray-casting PIP
            const poly = [...polygonDegrees, polygonDegrees[0]];
            let inside = false;
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
                const xi = poly[i][0], yi = poly[i][1];
                const xj = poly[j][0], yj = poly[j][1];
                const intersect = ((yi > lat) !== (yj > lat)) &&
                    (lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-10) + xi);
                if (intersect) inside = !inside;
            }

            if (!inside) return false;

            // Edge buffer check
            const edgeDist = minEdgeDistance(lat, lon, polygonDegrees);
            return edgeDist >= edgeBufferMeters;
        }

        const filtered = cartoGrid.filter(isInsideWithBuffer);
        const sampled = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, filtered);


        const allSamplePoints = [];

        sampled.forEach(s => {
            const lon = s.longitude;
            const lat = s.latitude;
            const center = Cesium.Cartographic.fromRadians(lon, lat);
            const offset = 1 / 111000; // ~0.5m in degrees
            const north = Cesium.Cartographic.fromRadians(lon, lat + offset);
            const east = Cesium.Cartographic.fromRadians(lon + offset, lat);
            allSamplePoints.push([center, north, east]);
        });

        //console.log(allSamplePoints);
        const flatPoints = allSamplePoints.flat();

        //console.log(flatPoints);


        // FIONA'S CHANGES

        const invEnu = Cesium.Matrix4.inverse(enuMatrix, new Cesium.Matrix4());
        let firstRowIndex = null;
        let multipleRows = false;

        const sampledPoints = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, flatPoints);

            for (let i = 0; i < sampledPoints.length; i += 3) {
                const [center, north, east] = [sampledPoints[i], sampledPoints[i + 1], sampledPoints[i + 2]];

                //conversion stuff
                const pCenter = Cesium.Cartesian3.fromRadians(center.longitude, center.latitude, center.height);
                const pNorth = Cesium.Cartesian3.fromRadians(north.longitude, north.latitude, north.height);
                const pEast = Cesium.Cartesian3.fromRadians(east.longitude, east.latitude, east.height);

                //get vectors pointing north and east, e.g. north center to north
                const vNorth = Cesium.Cartesian3.subtract(pNorth, pCenter, new Cesium.Cartesian3());
                const vEast = Cesium.Cartesian3.subtract(pEast, pCenter, new Cesium.Cartesian3());

                //compute the normal vector (perpendicular to ground)
                const normal = Cesium.Cartesian3.cross(vEast, vNorth, new Cesium.Cartesian3());
                Cesium.Cartesian3.normalize(normal, normal);
                //console.log(normal);
                const up = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(pCenter, new Cesium.Cartesian3());

                //gravity vector = straight down
                const down = Cesium.Cartesian3.negate(up, new Cesium.Cartesian3());

                //project onto surface
                const projection = Cesium.Cartesian3.subtract(
                    down,
                    Cesium.Cartesian3.multiplyByScalar(normal, Cesium.Cartesian3.dot(down, normal), new Cesium.Cartesian3()),
                    new Cesium.Cartesian3()
                );

                //normalize
                const downs = Cesium.Cartesian3.normalize(projection, new Cesium.Cartesian3());


                // X = downslope direction
                // Convert 2D downslope vector into ENU 3D vector
                const downslopeENU = Cesium.Cartesian3.fromElements(downslope.x, downslope.y, 0);

                // Step 2: Convert downslope direction to world space
                const downslopeWorld = Cesium.Matrix4.multiplyByPointAsVector(enuMatrix, downslopeENU, new Cesium.Cartesian3());

                // Step 3: Project downslopeWorld onto the local terrain surface
                const projection2 = Cesium.Cartesian3.subtract(
                    downslopeWorld,
                    Cesium.Cartesian3.multiplyByScalar(normal, Cesium.Cartesian3.dot(downslopeWorld, normal), new Cesium.Cartesian3()),
                    new Cesium.Cartesian3()
                );

                const downs2 = Cesium.Cartesian3.normalize(projection2, new Cesium.Cartesian3());
                //downs if you want to use the local one and downs2 if you want to use the average one

                //new so they stand up straight!!!!!
                //therefore x-axis just downslope world which is not projected to the ground yet!!!

                // flatten downs vector to make it horizontal
                const downsHorizontal = Cesium.Cartesian3.subtract(
                    downs,
                    Cesium.Cartesian3.multiplyByScalar(up, Cesium.Cartesian3.dot(downs, up), new Cesium.Cartesian3()),
                    new Cesium.Cartesian3()
                );
                Cesium.Cartesian3.normalize(downsHorizontal, downsHorizontal);

                // use flattened downslope as panel X-axis so it stands upright
                //downsHorizontal if local slope and downslopeWorld if average slope
                const xAxis = downsHorizontal;
                const yAxis = Cesium.Cartesian3.cross(up, xAxis, new Cesium.Cartesian3());
                Cesium.Cartesian3.normalize(yAxis, yAxis);


                // rotation matrix → quaternion
                const mat = new Cesium.Matrix3();
                Cesium.Matrix3.setColumn(mat, 0, xAxis, mat);
                Cesium.Matrix3.setColumn(mat, 1, yAxis, mat);
                Cesium.Matrix3.setColumn(mat, 2, up, mat);

                const orientation = Cesium.Quaternion.fromRotationMatrix(mat);

                // Apply to entity
                let gcr;
                let y;
                let modelUri;

                // sample elevation and depending on that put model for higher or lower elevation
                //console.log(center.height);
                if (center.height > 1500) {
                    if (currentTiltMode === "75" || currentTiltMode === "auto") {
                        modelUri = '/tiles/solarpanels/2solarpanelsorigin75_hoeher_ohne_fuesse_langebeine.glb';
                        y = 0.65;
                    } else {
                        modelUri = '/tiles/solarpanels/2solarpanelsorigin30gross.glb';
                        y = 2;
                    }

                } else {
                    if (currentTiltMode === "30" || currentTiltMode === "auto") {
                        modelUri = '/tiles/solarpanels/2solarpanelsorigin30_hoeher_ohne_fuesse_langebeine.glb';
                        y = 2;
                    } else {
                        modelUri = '/tiles/solarpanels/2solarpanelsorigin75klein.glb';
                        y = 0.65;
                    }
                }

                gcr = y / spacingDown;

                // add the entity

                const ent = viewer.entities.add({
                    position: pCenter,
                    orientation: orientation,
                    model: {
                        uri: modelUri,
                        minimumPixelSize: 0,
                        scale: 1.0
                    }
                });

                // FIONA'S CHANGES

                // compute "row coordinate" along the *average* downslope axis used for the grid
                const pENU = Cesium.Matrix4.multiplyByPoint(invEnu, pCenter, new Cesium.Cartesian3());
                const t = pENU.x * downslope.x + pENU.y * downslope.y; // projection onto downslope axis (ENU)
                const rowIndex = Math.round(t / spacingDown);


                if (firstRowIndex === null) firstRowIndex = rowIndex;
                else if (rowIndex !== firstRowIndex) multipleRows = true;




                // FIONA'S CHANGES
                const localPanelNormal = new Cesium.Cartesian3(1, 0, 0); // try +Y
                const q = ent.orientation.getValue(Cesium.JulianDate.now());
                const R = Cesium.Matrix3.fromQuaternion(q);
                const panelNormalWorld = Cesium.Matrix3.multiplyByVector(R, localPanelNormal, new Cesium.Cartesian3());

                const nENU = Cesium.Matrix4.multiplyByPointAsVector(invEnu, panelNormalWorld, new Cesium.Cartesian3());

                // horizontal projection by dropping vertical component
                nENU.z = 0;
                Cesium.Cartesian3.normalize(nENU, nENU);


                let azimuthDeg = Cesium.Math.toDegrees(
                    Math.atan2(nENU.x, nENU.y)   // atan2(East, North)
                );

                azimuthDeg = (azimuthDeg + 360) % 360;

                console.log("Panel azimuth = " + azimuthDeg)

                ent.properties = new Cesium.PropertyBag({ azimuth_deg: azimuthDeg });


                panelEntities.push(ent);
            }



        // FIONA'S CHANGES
        let rowCountFlag;
        // No panels means 0 rows
        if (panelEntities.length === 0) rowCountFlag = 0;
        // more than one row
        else if (multipleRows) rowCountFlag = 2;
        // exactly one row
        else rowCountFlag = 1;


        //console.log(panelEntities);
        return {
            panels: panelEntities,
            spacing: spacingDown,  // return computed spacing
            no_one_or_multiple_rows: rowCountFlag
        };


    }

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// FUNCTION II: PLACE SOLAR PANELS FACING SOUTH
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    /**
     * Places south-facing panels inside the given polygon.
     * @param {Cartesian3[]} cartesianPositions  The polygon corner positions.
     * @param {number} spacingDown  Distance between panel rows (m).
     * @param {number} spacingPerp  Distance between panel columns (m).
     * @returns {Entity[]}  The array of created panel entities.
     */
    async function placeSolarPanelsFacingSouth(cartesianPositions, spacingDown = 5, spacingPerp = 5.7) {
        //console.log(spacingDown);

        const panelEntities = [];
        // enforce minimum size
        if (cartesianPositions.length < 3) {
            return panelEntities;
        }

        // Convert to degrees for PIP tests, center, ENU frame, etc.
        const cartoPositions = Cesium.Ellipsoid.WGS84
            .cartesianArrayToCartographicArray(cartesianPositions);
        const polygonDegrees = cartoPositions.map(p => [
            Cesium.Math.toDegrees(p.longitude),
            Cesium.Math.toDegrees(p.latitude)
        ]);

        const edgeBufferMeters = spacingPerp / 2;
        const avgLon = polygonDegrees.reduce((sum, p) => sum + p[0], 0) / polygonDegrees.length;
        const avgLat = polygonDegrees.reduce((sum, p) => sum + p[1], 0) / polygonDegrees.length;
        const centerCartesian = Cesium.Cartesian3.fromDegrees(avgLon, avgLat);
        const enuMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(centerCartesian);

        // South / East unit vectors in ENU
        const southENU = Cesium.Cartesian3.fromElements(0, -1, 0);
        const eastENU = Cesium.Cartesian3.fromElements(1, 0, 0);

        // Build a regular grid just for calculations using your **parameters** spacingPerp & spacingDown
        const gridHalf = 1000;
        const allENU = [];
        for (let x = -gridHalf; x <= gridHalf; x += spacingPerp) {
            for (let y = -gridHalf; y <= gridHalf; y += spacingDown) {
                const offS = Cesium.Cartesian3.multiplyByScalar(southENU, y, new Cesium.Cartesian3());
                const offE = Cesium.Cartesian3.multiplyByScalar(eastENU, x, new Cesium.Cartesian3());
                allENU.push(Cesium.Cartesian3.add(offS, offE, new Cesium.Cartesian3()));
            }
        }

        // ENU → World → Cartographic for PIP + sampling
        const worldPts = allENU.map(p => Cesium.Matrix4.multiplyByPoint(enuMatrix, p, new Cesium.Cartesian3()));
        const cartoGrid = worldPts.map(p => Cesium.Cartographic.fromCartesian(p));

        // point-in-polygon + buffer
        function haversine(aLat, aLon, bLat, bLon) {
            const R = 6371000;
            const toR = Cesium.Math.toRadians;
            const dLat = toR(bLat - aLat), dLon = toR(bLon - aLon);
            const a = Math.sin(dLat / 2) ** 2 +
                Math.cos(toR(aLat)) * Math.cos(toR(bLat)) * Math.sin(dLon / 2) ** 2;
            return 2 * R * Math.asin(Math.sqrt(a));
        }

        function minEdgeDistance(lat, lon) {
            let minD = Infinity;
            for (let i = 0; i < polygonDegrees.length; i++) {
                const [x1, y1] = polygonDegrees[i];
                const [x2, y2] = polygonDegrees[(i + 1) % polygonDegrees.length];
                const t = Math.max(0, Math.min(1,
                    ((lon - x1) * (x2 - x1) + (lat - y1) * (y2 - y1)) /
                    ((x2 - x1) ** 2 + (y2 - y1) ** 2)
                ));
                const projLon = x1 + t * (x2 - x1);
                const projLat = y1 + t * (y2 - y1);
                minD = Math.min(minD, haversine(lat, lon, projLat, projLon));
            }
            return minD;
        }

        function insideBuffer(pt) {
            const lon = Cesium.Math.toDegrees(pt.longitude);
            const lat = Cesium.Math.toDegrees(pt.latitude);
            // simple ray‐cast
            let inside = false;
            for (let i = 0, j = polygonDegrees.length - 1; i < polygonDegrees.length; j = i++) {
                const [xi, yi] = polygonDegrees[i];
                const [xj, yj] = polygonDegrees[j];
                if (((yi > lat) !== (yj > lat)) &&
                    (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
                    inside = !inside;
                }
            }
            return inside && (minEdgeDistance(lat, lon) >= edgeBufferMeters);
        }

// Filter and sample base points
        const filtered = cartoGrid.filter(insideBuffer);
        const sampled = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, filtered);

        const aspectArray = [];
        const slopeArray = [];
        let elevation = 0;

// build triplets of [center, north, east]
        const offset = 1 / 111000; // ~0.5m in degrees, good local offset
        const allSamplePoints = [];

        sampled.forEach(s => {
            const lon = s.longitude;
            const lat = s.latitude;
            const center = Cesium.Cartographic.fromRadians(lon, lat);
            const north = Cesium.Cartographic.fromRadians(lon, lat + offset);
            const east = Cesium.Cartographic.fromRadians(lon + offset, lat);
            allSamplePoints.push([center, north, east]);
        });

// flatten triplets for single call
        const flatPoints = allSamplePoints.flat();

// sample again to get heights for north/east offsets
        const sampledPoints = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, flatPoints);

// loop through results in triplets
        for (let i = 0; i < sampledPoints.length; i += 3) {
            const [center, north, east] = [
                sampledPoints[i],
                sampledPoints[i + 1],
                sampledPoints[i + 2],
            ];

            // convert to Cartesian3
            const pCenter = Cesium.Cartesian3.fromRadians(center.longitude, center.latitude, center.height);
            const pNorth = Cesium.Cartesian3.fromRadians(north.longitude, north.latitude, north.height);
            const pEast = Cesium.Cartesian3.fromRadians(east.longitude, east.latitude, east.height);

            // compute ground vectors
            const vNorth = Cesium.Cartesian3.subtract(pNorth, pCenter, new Cesium.Cartesian3());
            const vEast = Cesium.Cartesian3.subtract(pEast, pCenter, new Cesium.Cartesian3());

            // compute normal
            const normal = Cesium.Cartesian3.cross(vEast, vNorth, new Cesium.Cartesian3());
            Cesium.Cartesian3.normalize(normal, normal);
            //console.log(normal);

            // === keep your aspect and slope logic unchanged ===

            // --- Compute local up, slope, and aspect correctly ---
            // use the Cartesian center point for surface normal reference
            const upWorld = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(pCenter, new Cesium.Cartesian3());

            // --- SLOPE ---
            const cosSlope = Cesium.Cartesian3.dot(normal, upWorld);
            const slopeRad = Math.acos(Math.min(1.0, Math.max(-1.0, cosSlope)));
            const slopeDeg = Cesium.Math.toDegrees(slopeRad);
            slopeArray.push(slopeDeg);
            //console.log(slopeDeg);

            // --- ASPECT ---
            const aseast = Cesium.Cartesian3.cross(Cesium.Cartesian3.UNIT_Z, upWorld, new Cesium.Cartesian3());
            Cesium.Cartesian3.normalize(aseast, aseast);
            const asnorth = Cesium.Cartesian3.cross(upWorld, aseast, new Cesium.Cartesian3());

            // Project surface normal into tangent plane
            const nDotUp = Cesium.Cartesian3.dot(normal, upWorld);
            const proj = Cesium.Cartesian3.subtract(
                normal,
                Cesium.Cartesian3.multiplyByScalar(upWorld, nDotUp, new Cesium.Cartesian3()),
                new Cesium.Cartesian3()
            );
            Cesium.Cartesian3.normalize(proj, proj);

            // Aspect: angle clockwise from North
            const eastComp = Cesium.Cartesian3.dot(proj, aseast);
            const northComp = Cesium.Cartesian3.dot(proj, asnorth);
            const aspectRad = Math.atan2(eastComp, northComp);
            let aspectDeg = Cesium.Math.toDegrees(aspectRad);
            if (aspectDeg > 180) aspectDeg -= 360;
            if (aspectDeg < -180) aspectDeg += 360;
            aspectArray.push(aspectDeg);


            elevation = center.height;
        }


        // Compute average aspect using unit vectors
        let sumX = 0, sumY = 0;
        for (const deg of aspectArray) {
            const rad = Cesium.Math.toRadians(deg);
            sumX += Math.cos(rad);
            sumY += Math.sin(rad);
        }

        let avgAspectDeg = Cesium.Math.toDegrees(Math.atan2(sumY, sumX));
        let roundedAspect = Math.round(avgAspectDeg / 10) * 10;
        roundedAspect = roundedAspect - 180;
        // Make sure it stays within -180° to 180°
        if (roundedAspect < -180) roundedAspect += 360;
        if (roundedAspect > 180) roundedAspect -= 360;

        // Compute average slope (arithmetic mean)
        const avgSlopeDeg = slopeArray.reduce((sum, v) => sum + v, 0) / slopeArray.length;
        //console.log(avgSlopeDeg);

        let roundedSlopeDeg = 0;
        if (avgSlopeDeg > 40) {
            roundedSlopeDeg = 100;
        } else {
            roundedSlopeDeg = Math.round(avgSlopeDeg / 10) * 10;
        }

        //console.log(avgAspectDeg);
        console.log(roundedAspect);

        //console.log(avgSlopeDeg);
        console.log(roundedSlopeDeg);

        //console.log(elevation);

        //initialize gcr look up tables:
        // Aspect values (columns)
        const aspectColumns = [-180, -170, -160, -150, -140, -130, -120, -110, -100, -90, -80, -70, -60, -50, -40, -30, -20, -10,
            0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180];

        // slope rows: 0°, 10°, 20°, 30°, 40°
        const slopeRows = [0, 10, 20, 30, 40];

        // GCR table for <1500 m.a.s.l.
        const gcrTableLow = [
            // slope rows: 0°, 10°, 20°, 30°, 40°
            [0.366, 0.366, 0.366, 0.366, 0.366, 0.366, 0.366, 0.366, 0.366, 0.366, 0.366, 0.366, 0.366, 0.366, 0.366, 0.366, 0.366, 0.366,
                0.366, 0.366, 0.366, 0.366, 0.366, 0.366, 0.366, 0.366, 0.366, 0.366, 0.366, 0.366, 0.366, 0.366, 0.366, 0.366, 0.366, 0.366, 0.366],
            [0.123, 0.127, 0.138, 0.156, 0.180, 0.210, 0.245, 0.283, 0.324, 0.366, 0.408, 0.448, 0.485, 0.518, 0.546, 0.568, 0.584, 0.594,
                0.598, 0.594, 0.584, 0.568, 0.546, 0.518, 0.485, 0.448, 0.408, 0.366, 0.324, 0.283, 0.245, 0.210, 0.180, 0.156, 0.138, 0.127, 0.123],
            [0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.045, 0.116, 0.194, 0.279, 0.366, 0.451, 0.532, 0.605, 0.668, 0.719, 0.750, 0.750, 0.750,
                0.750, 0.750, 0.750, 0.750, 0.719, 0.668, 0.605, 0.532, 0.451, 0.366, 0.279, 0.194, 0.116, 0.045, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001],
            [0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.094, 0.228, 0.366, 0.500, 0.624, 0.731, 0.750, 0.750, 0.750, 0.750,
                0.750, 0.750, 0.750, 0.750, 0.750, 0.750, 0.731, 0.624, 0.500, 0.366, 0.228, 0.094, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001],
            [0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.165, 0.366, 0.559, 0.729, 0.750, 0.750, 0.750, 0.750, 0.750, 0.750,
                0.750, 0.750, 0.750, 0.750, 0.750, 0.750, 0.750, 0.729, 0.559, 0.366, 0.165, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001]
        ];

        // GCR table for >1500 m.a.s.l.
        const gcrTableHigh = [
            [0.259, 0.259, 0.259, 0.259, 0.259, 0.259, 0.259, 0.259, 0.259, 0.259, 0.259, 0.259, 0.259, 0.259, 0.259, 0.259, 0.259, 0.259,
                0.259, 0.259, 0.259, 0.259, 0.259, 0.259, 0.259, 0.259, 0.259, 0.259, 0.259, 0.259, 0.259, 0.259, 0.259, 0.259, 0.259, 0.259, 0.259],
            [0.087, 0.090, 0.097, 0.110, 0.127, 0.148, 0.173, 0.200, 0.229, 0.259, 0.288, 0.317, 0.343, 0.366, 0.386, 0.402, 0.413, 0.420,
                0.423, 0.420, 0.413, 0.402, 0.386, 0.366, 0.343, 0.317, 0.288, 0.259, 0.229, 0.200, 0.173, 0.148, 0.127, 0.110, 0.097, 0.090, 0.087],
            [0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.032, 0.082, 0.138, 0.197, 0.259, 0.319, 0.376, 0.428, 0.472, 0.509, 0.537, 0.557, 0.570,
                0.574, 0.570, 0.557, 0.537, 0.509, 0.472, 0.428, 0.376, 0.319, 0.259, 0.197, 0.138, 0.082, 0.032, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001],
            [0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.067, 0.161, 0.259, 0.354, 0.441, 0.517, 0.579, 0.627, 0.663, 0.688, 0.702,
                0.707, 0.702, 0.688, 0.663, 0.627, 0.579, 0.517, 0.441, 0.354, 0.259, 0.161, 0.067, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001],
            [0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.117, 0.259, 0.395, 0.515, 0.612, 0.686, 0.740, 0.750, 0.750, 0.750,
                0.750, 0.750, 0.750, 0.750, 0.750, 0.740, 0.686, 0.612, 0.515, 0.395, 0.259, 0.117, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001, 0.0001]
        ];


        // Pick table based on average elevation
        const table = elevation > 1500 ? gcrTableHigh : gcrTableLow;
        const slopeIndex = slopeRows.indexOf(roundedSlopeDeg);
        const aspectIndex = aspectColumns.indexOf(roundedAspect);

        let gcr = 0.4;
        //console.log(slopeIndex);
        if (slopeIndex >= 0) {
            gcr = table[slopeIndex][aspectIndex];
        } else {
            gcr = 0.00001;
        }

        //console.log(gcr);

        let y;
        if (elevation > 1500) {
            y = 0.65;
        } else {
            y = 2;
        }
        spacingDown = y / gcr;

        //console.log(spacingDown);

        const allENU2 = [];


        for (let x = -gridHalf; x <= gridHalf; x += spacingPerp) {
            for (let y = -gridHalf; y <= gridHalf; y += spacingDown) {
                const offS2 = Cesium.Cartesian3.multiplyByScalar(southENU, y, new Cesium.Cartesian3());
                const offE2 = Cesium.Cartesian3.multiplyByScalar(eastENU, x, new Cesium.Cartesian3());
                allENU2.push(Cesium.Cartesian3.add(offS2, offE2, new Cesium.Cartesian3()));
            }
        }


        // ENU → World → Cartographic for PIP + sampling
        const worldPts2 = allENU2.map(p => Cesium.Matrix4.multiplyByPoint(enuMatrix, p, new Cesium.Cartesian3()));
        const cartoGrid2 = worldPts2.map(p => Cesium.Cartographic.fromCartesian(p));

        const filtered2 = cartoGrid2.filter(insideBuffer);
        const sampled2 = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, filtered2);
        //console.log(sampled2);

        // FIONA'S CHANGES
        // Find out if 0, 1, or multiple rows
        let firstRowIndex = null;
        let multipleRows = false;
        // project southENU onto the surface
        // For each sample, compute local frame & add a panel entity
        for (let i = 0; i < sampled2.length; i++) {
            const s2 = sampled2[i];
            const world2 = Cesium.Cartesian3.fromRadians(s2.longitude, s2.latitude, s2.height);

            // get normal from tiny north/east offset
            const north2 = Cesium.Cartesian3.fromRadians(s2.longitude, s2.latitude + 1e-6, s2.height);
            const east2 = Cesium.Cartesian3.fromRadians(s2.longitude + 1e-6, s2.latitude, s2.height);
            const vN2 = Cesium.Cartesian3.subtract(north2, world2, new Cesium.Cartesian3());
            const vE2 = Cesium.Cartesian3.subtract(east2, world2, new Cesium.Cartesian3());
            const normal2 = Cesium.Cartesian3.cross(vE2, vN2, new Cesium.Cartesian3());
            Cesium.Cartesian3.normalize(normal2, normal2);
            //console.log(normal2);


            const southWorld2 = Cesium.Matrix4.multiplyByPointAsVector(enuMatrix, southENU, new Cesium.Cartesian3());


            const proj2 = Cesium.Cartesian3.subtract(
                southWorld2,
                Cesium.Cartesian3.multiplyByScalar(normal2, Cesium.Cartesian3.dot(southWorld2, normal2), new Cesium.Cartesian3()),
                new Cesium.Cartesian3()
            );

            const xAxis = Cesium.Cartesian3.normalize(proj2, new Cesium.Cartesian3());
            const yAxis = Cesium.Cartesian3.cross(normal2, xAxis, new Cesium.Cartesian3());
            Cesium.Cartesian3.normalize(yAxis, yAxis);

            // rotation matrix → quaternion
            const mat = new Cesium.Matrix3();
            Cesium.Matrix3.setColumn(mat, 0, xAxis, mat);
            Cesium.Matrix3.setColumn(mat, 1, yAxis, mat);
            Cesium.Matrix3.setColumn(mat, 2, normal2, mat);
            const orientation = Cesium.Quaternion.fromRotationMatrix(mat);


            let modelUri;
            console.log(currentTiltMode);
            if (s2.height > 1500) {
                if (currentTiltMode === "75" || currentTiltMode === "auto") {
                    modelUri = '/tiles/solarpanels/2solarpanelsorigin75_hoeher_ohne_fuesse_langebeine.glb';
                } else {
                    modelUri = '/tiles/solarpanels/2solarpanelsorigin30gross.glb';
                }
            } else {
                if (currentTiltMode === "30" || currentTiltMode === "auto") {
                    modelUri = '/tiles/solarpanels/2solarpanelsorigin30_hoeher_ohne_fuesse_langebeine.glb';
                } else {
                    modelUri = '/tiles/solarpanels/2solarpanelsorigin75klein.glb';
                }
            }

            // FIONA'S CHANGES
            // convert panel position (world2) into the grid's coordinate system (invEnu)
            const invEnu = Cesium.Matrix4.inverse(enuMatrix, new Cesium.Matrix4());
            const pENU = Cesium.Matrix4.multiplyByPoint(invEnu, world2, new Cesium.Cartesian3());
            // compute which row this panel belongs to (y-axis is south-facing)
            const rowIndex = Math.round(pENU.y / spacingDown);

            // check if we've already seen more rows
            if (firstRowIndex === null) {
                firstRowIndex = rowIndex;
            } else if (rowIndex !== firstRowIndex) {
                multipleRows = true;
            }


            const azimuthDeg = 180;

            // add the entity

            const ent = viewer.entities.add({
                position: world2,
                orientation: orientation,
                model: {
                    uri: modelUri,
                    minimumPixelSize: 0,
                    scale: 1.0
                }
            });

            ent.properties = new Cesium.PropertyBag({ azimuth_deg: azimuthDeg });

            panelEntities.push(ent);
        }

        // FIONA'S CHANGES
        let rowCountFlag;
        // No panels means 0 rows
        if (panelEntities.length === 0) rowCountFlag = 0;
        // more than one row
        else if (multipleRows) rowCountFlag = 2;
        // exactly one row
        else rowCountFlag = 1;


        //console.log(panelEntities);
        return {
            panels: panelEntities,
            spacing: spacingDown,  // return computed spacing
            no_one_or_multiple_rows: rowCountFlag
        };

    }


// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// FUNCTION III.2 REPLACING PANELS FACING SOUTH
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    /**
     * Places south-facing panels inside the given polygon.
     * @param {Cartesian3[]} cartesianPositions  The polygon corner positions.
     * @param {number} spacingDown  Distance between panel rows (m).
     * @param {number} spacingPerp  Distance between panel columns (m).
     * @returns {Entity[]}  The array of created panel entities.
     */
    async function replaceSolarPanelsFacingSouth(cartesianPositions, spacingDown = 5, spacingPerp = 5.7) {
        //console.log(spacingDown);

        const panelEntities = [];
        if (cartesianPositions.length < 3) {
            return panelEntities;
        }

        // Convert to degrees for PIP tests, center, ENU frame, etc.
        const cartoPositions = Cesium.Ellipsoid.WGS84
            .cartesianArrayToCartographicArray(cartesianPositions);
        const polygonDegrees = cartoPositions.map(p => [
            Cesium.Math.toDegrees(p.longitude),
            Cesium.Math.toDegrees(p.latitude)
        ]);

        const edgeBufferMeters = spacingPerp / 2;
        const avgLon = polygonDegrees.reduce((sum, p) => sum + p[0], 0) / polygonDegrees.length;
        const avgLat = polygonDegrees.reduce((sum, p) => sum + p[1], 0) / polygonDegrees.length;
        const centerCartesian = Cesium.Cartesian3.fromDegrees(avgLon, avgLat);
        const enuMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(centerCartesian);

        // South / East unit vectors in ENU
        const southENU = Cesium.Cartesian3.fromElements(0, -1, 0);
        const eastENU = Cesium.Cartesian3.fromElements(1, 0, 0);

        // Build a regular grid using your **parameters** spacingPerp & spacingDown
        const gridHalf = 1000;
        const allENU = [];
        for (let x = -gridHalf; x <= gridHalf; x += spacingPerp) {
            for (let y = -gridHalf; y <= gridHalf; y += spacingDown) {
                const offS = Cesium.Cartesian3.multiplyByScalar(southENU, y, new Cesium.Cartesian3());
                const offE = Cesium.Cartesian3.multiplyByScalar(eastENU, x, new Cesium.Cartesian3());
                allENU.push(Cesium.Cartesian3.add(offS, offE, new Cesium.Cartesian3()));
            }
        }

        // ENU → World → Cartographic for PIP + sampling
        const worldPts = allENU.map(p => Cesium.Matrix4.multiplyByPoint(enuMatrix, p, new Cesium.Cartesian3()));
        const cartoGrid = worldPts.map(p => Cesium.Cartographic.fromCartesian(p));

        // point-in-polygon + buffer
        function haversine(aLat, aLon, bLat, bLon) {
            const R = 6371000;
            const toR = Cesium.Math.toRadians;
            const dLat = toR(bLat - aLat), dLon = toR(bLon - aLon);
            const a = Math.sin(dLat / 2) ** 2 +
                Math.cos(toR(aLat)) * Math.cos(toR(bLat)) * Math.sin(dLon / 2) ** 2;
            return 2 * R * Math.asin(Math.sqrt(a));
        }

        function minEdgeDistance(lat, lon) {
            let minD = Infinity;
            for (let i = 0; i < polygonDegrees.length; i++) {
                const [x1, y1] = polygonDegrees[i];
                const [x2, y2] = polygonDegrees[(i + 1) % polygonDegrees.length];
                const t = Math.max(0, Math.min(1,
                    ((lon - x1) * (x2 - x1) + (lat - y1) * (y2 - y1)) /
                    ((x2 - x1) ** 2 + (y2 - y1) ** 2)
                ));
                const projLon = x1 + t * (x2 - x1);
                const projLat = y1 + t * (y2 - y1);
                minD = Math.min(minD, haversine(lat, lon, projLat, projLon));
            }
            return minD;
        }

        function insideBuffer(pt) {
            const lon = Cesium.Math.toDegrees(pt.longitude);
            const lat = Cesium.Math.toDegrees(pt.latitude);
            // simple ray‐cast
            let inside = false;
            for (let i = 0, j = polygonDegrees.length - 1; i < polygonDegrees.length; j = i++) {
                const [xi, yi] = polygonDegrees[i];
                const [xj, yj] = polygonDegrees[j];
                if (((yi > lat) !== (yj > lat)) &&
                    (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
                    inside = !inside;
                }
            }
            return inside && (minEdgeDistance(lat, lon) >= edgeBufferMeters);
        }

        // Filter and sample
        const filtered = cartoGrid.filter(insideBuffer);
        const sampled = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, filtered);


        // FIONA'S CHANGES
        // Find out if 0, 1, or multiple rows
        let firstRowIndex = null;
        let multipleRows = false;

        // For each sample, compute local frame & add a panel entity
        for (let i = 0; i < sampled.length; i++) {
            const s = sampled[i];
            const world2 = Cesium.Cartesian3.fromRadians(s.longitude, s.latitude, s.height);

            // get normal from tiny north/east offset
            const north = Cesium.Cartesian3.fromRadians(s.longitude, s.latitude + 1e-6, s.height);
            const east = Cesium.Cartesian3.fromRadians(s.longitude + 1e-6, s.latitude, s.height);
            const vN = Cesium.Cartesian3.subtract(north, world2, new Cesium.Cartesian3());
            const vE = Cesium.Cartesian3.subtract(east, world2, new Cesium.Cartesian3());
            const normal = Cesium.Cartesian3.cross(vE, vN, new Cesium.Cartesian3());
            Cesium.Cartesian3.normalize(normal, normal);

            // project southENU onto the surface
            const southWorld = Cesium.Matrix4.multiplyByPointAsVector(enuMatrix, southENU, new Cesium.Cartesian3());
            const proj = Cesium.Cartesian3.subtract(
                southWorld,
                Cesium.Cartesian3.multiplyByScalar(normal, Cesium.Cartesian3.dot(southWorld, normal), new Cesium.Cartesian3()),
                new Cesium.Cartesian3()
            );
            //console.log(proj);
            const xAxis = Cesium.Cartesian3.normalize(proj, new Cesium.Cartesian3());
            const yAxis = Cesium.Cartesian3.cross(normal, xAxis, new Cesium.Cartesian3());
            Cesium.Cartesian3.normalize(yAxis, yAxis);

            // rotation matrix → quaternion
            const mat = new Cesium.Matrix3();
            Cesium.Matrix3.setColumn(mat, 0, xAxis, mat);
            Cesium.Matrix3.setColumn(mat, 1, yAxis, mat);
            Cesium.Matrix3.setColumn(mat, 2, normal, mat);
            const orientation = Cesium.Quaternion.fromRotationMatrix(mat);


            let modelUri;
            //console.log(s.height);

            console.log(currentTiltMode);
            if (s.height > 1500) {
                if (currentTiltMode === "75" || currentTiltMode === "auto") {
                    modelUri = '/tiles/solarpanels/2solarpanelsorigin75_hoeher_ohne_fuesse_langebeine.glb';
                } else {
                    modelUri = '/tiles/solarpanels/2solarpanelsorigin30gross.glb';
                }
            } else {
                if (currentTiltMode === "30" || currentTiltMode === "auto") {
                    modelUri = '/tiles/solarpanels/2solarpanelsorigin30_hoeher_ohne_fuesse_langebeine.glb';
                } else {
                    modelUri = '/tiles/solarpanels/2solarpanelsorigin75klein.glb';
                }
            }

            // FIONA'S CHANGES
            // convert panel position (world2) into the grid's coordinate system (invEnu)
            const invEnu = Cesium.Matrix4.inverse(enuMatrix, new Cesium.Matrix4());
            const pENU = Cesium.Matrix4.multiplyByPoint(invEnu, world2, new Cesium.Cartesian3());
            // compute which row this panel belongs to (y-axis is south-facing)
            const rowIndex = Math.round(pENU.y / spacingDown);

            // check if we've already seen more rows
            if (firstRowIndex === null) {
                firstRowIndex = rowIndex;
            } else if (rowIndex !== firstRowIndex) {
                multipleRows = true;
            }

            const azimuthDeg = 180;

            // add the entity

            const ent = viewer.entities.add({
                position: world2,
                orientation: orientation,
                model: {
                    uri: modelUri,
                    minimumPixelSize: 0,
                    scale: 1.0
                }
            });

            ent.properties = new Cesium.PropertyBag({ azimuth_deg: azimuthDeg });


            panelEntities.push(ent);
        }

        // FIONA'S CHANGES
        let rowCountFlag;
        // No panels means 0 rows
        if (panelEntities.length === 0) rowCountFlag = 0;
        // more than one row
        else if (multipleRows) rowCountFlag = 2;
        // exactly one row
        else rowCountFlag = 1;


        return {
            panels: panelEntities,
            spacing: spacingDown,  // return computed spacing
            no_one_or_multiple_rows: rowCountFlag
        };

    }

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// FUNCTION IV: LEFT PANEL TO CHOOSE THE PROPERTIES OF THE POLYGON
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

    // For new polygons, always 'south'
    let currentOrientation = 'south';

    // Only the "south" button exists
    const leftSouthBtn = document.getElementById('southBtn');

    // Right-hand polygon options
    const spacingInput = document.getElementById('polygonPanelSpacing');
    const gcrInput = document.getElementById('polygonGCR');

    // Mark it active by default
    leftSouthBtn.classList.add('active');

    // Clicking the button doesn't change anything now (optional)
    leftSouthBtn.addEventListener('click', () => {
        currentOrientation = 'south';
        leftSouthBtn.classList.add('active');
    });

    // Right-hand polygon orientation buttons (unchanged)
    const rightSouthBtn = document.getElementById('orientSouthBtn');
    const rightDownslopeBtn = document.getElementById('orientDownslopeBtn');

//tilt stuff
    let currentTiltMode = "auto"; // "30", "75", "auto"

    const tilt30Btn = document.getElementById("tilt30Btn");
    const tilt75Btn = document.getElementById("tilt75Btn");
    const tiltAutoBtn = document.getElementById("tiltAutoBtn");

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// FUNCTION V: RIGHT CLICK TO SELECT POLYGON AND SELECTION PANEL
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────


// RIGHT CLICK when not drawing: select polygon
    selectHandler.setInputAction((movement) => {
        if (drawing) return;
        const picked = viewer.scene.pick(movement.position);
        if (picked && picked.id) {
            const ref = polygonDataStore.find(p => p.id === picked.id.id);
            //console.log(polygonDataStore.id);
            //console.log(picked);
            //console.log(picked.id);
            //console.log(picked.id.id);

            const match = polygonDataStore.find(p => p.polygon === picked.id);
            //console.log(!!match);
            if (ref) {
                // un-highlight old
                if (selectedPolygonRef) {
                    selectedPolygonRef.polygon.polygon.material =
                        Cesium.Color.fromCssColorString('#fadfad').withAlpha(0);
                }
                // highlight new
                ref.polygon.polygon.material = Cesium.Color.fromCssColorString('#fadfad').withAlpha(0.2);
                showPolygonOptions(ref);
            }
        }
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);


// TILT ANGLES
    function setTiltMode(mode) {
        currentTiltMode = mode;

        [tilt30Btn, tilt75Btn, tiltAutoBtn].forEach(btn =>
            btn.classList.remove("active")
        );

        if (mode === "30") tilt30Btn.classList.add("active");
        else if (mode === "75") tilt75Btn.classList.add("active");
        else tiltAutoBtn.classList.add("active");

        // if a polygon is selected → re-render it
        if (selectedPolygonRef) {
            const spacing = selectedPolygonRef.spacing;
            updatePolygonOrientation(selectedPolygonRef, selectedPolygonRef.orientation, spacing);
        }
    }

    tilt30Btn.addEventListener("click", () => setTiltMode("30"));
    tilt75Btn.addEventListener("click", () => setTiltMode("75"));
    tiltAutoBtn.addEventListener("click", () => setTiltMode("auto"));


    function setTiltActive(btnId) {
        document.querySelectorAll("#tiltModelRow .tiltBtn").forEach(b => b.classList.remove("active"));
        document.getElementById(btnId).classList.add("active");
    }

// CURSOR CHANGES WHEN OVER POLYGON
    selectHandler.setInputAction((event) => {
        const picked = viewer.scene.pick(event.endPosition);
        viewer._container.style.cursor =
            (picked && polygonDataStore.some(p => p.polygon === picked.id)) ?
                'pointer' : '';
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);


    // DELETE BUTTON
    document.getElementById('deletePolygonBtn').onclick = () => {
        if (!selectedPolygonRef) return;
        // remove solar panel entities
        selectedPolygonRef.panels.forEach(e => viewer.entities.remove(e));
        // remove polygon entity
        viewer.entities.remove(selectedPolygonRef.polygon);
        // remove from store
        const idx = polygonDataStore.indexOf(selectedPolygonRef);
        if (idx >= 0) polygonDataStore.splice(idx, 1);
        selectedPolygonRef = null;
        // hide UI
        document.getElementById('polygonOptions').style.display = 'none';
        // FIONA'S CHANGES
        closePolygonPVOutput();
    };


    // ORIENTATION BUTTONS
    document.getElementById('orientSouthBtn').onclick = async () => {
        if (!selectedPolygonRef) return;
        const s = parseFloat(document.getElementById('polygonPanelSpacing').value) || selectedPolygonRef.spacing;
        await updatePolygonOrientation(selectedPolygonRef, 'south', s);
    };

    document.getElementById('orientDownslopeBtn').onclick = async () => {
        if (!selectedPolygonRef) return;
        const s = parseFloat(document.getElementById('polygonPanelSpacing').value) || selectedPolygonRef.spacing;
        await updatePolygonOrientation(selectedPolygonRef, 'downslope', s);
    };

    // CHANGING SPACING UPDATES PLACEMENT
    document
        .getElementById('polygonPanelSpacing')
        .addEventListener('change', async function () {
            if (!selectedPolygonRef) return;

            const v = parseFloat(this.value);
            if (isNaN(v) || v <= 0) return;

            // 1) re-place panels at new spacing
            await updatePolygonOrientation(
                selectedPolygonRef,
                selectedPolygonRef.orientation,
                v
            );

            // 2) keep store in sync
            selectedPolygonRef.spacing = v;

            // 3) compute new GCR = y / spacing
            const newGcr = selectedPolygonRef.y / v;
            // write it back into the GCR field
            gcrInput.value = newGcr.toFixed(3);
        });

    async function getTerrainHeight(cartesian) {
        const carto = Cesium.Cartographic.fromCartesian(cartesian);

        const sampled = await Cesium.sampleTerrainMostDetailed(
            viewer.terrainProvider,
            [carto]
        );

        return sampled[0].height;
    }

    // UPDATE POLYGON PLACEMENT
    // 4) Extend updatePolygonOrientation to accept spacing
    async function updatePolygonOrientation(ref, newOrientation, spacing) {
        // remove old panels
        if (currentTiltMode === "30") {
            ref.y = 2.0;           // your 30° model height
        } else if (currentTiltMode === "75") {
            ref.y = 0.65;          // your 75° model height
        } else if (currentTiltMode === "auto") {
            // auto → determined by elevation threshold (1500m)
            // use the SAME logic as in your model URI selection:
            const center = ref.positions[0];
            const elevation = await getTerrainHeight(center);
            console.log(elevation);
            if (elevation > 1500) {
                ref.y = 0.65;
            } else {
                ref.y = 2.0;
            }

        }
        ref.panels.forEach(e => viewer.entities.remove(e));

        // place new panels with computed spacing
        let result;
        if (newOrientation === 'south') {
            result = await replaceSolarPanelsFacingSouth(ref.positions, spacing);
        } else {
            result = await placeSolarPanelsDownslope(ref.positions, spacing);
        }

        // inside updatePolygonOrientation(ref, newOrientation, spacing):

        rightSouthBtn.classList.toggle("active", newOrientation === "south");
        rightDownslopeBtn.classList.toggle("active", newOrientation === "downslope");


        // destructure result
        const {panels, spacing: computedSpacing} = result;

        // update store
        ref.panels = panels;
        ref.orientation = newOrientation;
        ref.spacing = computedSpacing; // use computed spacing (for south)

        // update UI fields if they exist
        spacingInput.value = computedSpacing.toFixed(2);
        const newGcr = ref.y / computedSpacing;
        gcrInput.value = newGcr.toFixed(3);

        // --- GCR WARNING PANEL ---
        const gcrWarning = document.getElementById("gcrWarning");
        gcrWarning.style.display = newGcr > 1 ? "block" : "none";

        // highlight polygon
        /*if (newGcr > 1) {
            ref.outlineEntity.polygon.material = Cesium.Color.RED.withAlpha(0.4);
            ref.outlineEntity.polygon.outlineColor = Cesium.Color.RED;
        } else {
            ref.outlineEntity.polygon.material = Cesium.Color.YELLOW.withAlpha(0.3);
            ref.outlineEntity.polygon.outlineColor = Cesium.Color.YELLOW;
        }*/


        // API ANNUAL KWH CALL
        // FIONA'S CHANGES
        showPolygonOptions(ref);
        setSpacingUI(ref.spacing);
        showPolygonPVOutput(ref);
        await computeAndUpdatePVOutput(ref);

    }


// ACTIVATE BUTTONS

    rightSouthBtn.onclick = async () => {
        if (!selectedPolygonRef) return;

        // 1) Re‐place panels facing south
        const s = parseFloat(spacingInput.value) || selectedPolygonRef.spacing;
        await updatePolygonOrientation(selectedPolygonRef, 'south', s);

        // 2) Toggle the active class
        rightSouthBtn.classList.add('active');
        rightDownslopeBtn.classList.remove('active');
    };

    rightDownslopeBtn.onclick = async () => {
        if (!selectedPolygonRef) return;

        // 1) Re‐place panels downslope
        const s = parseFloat(spacingInput.value) || selectedPolygonRef.spacing;
        await updatePolygonOrientation(selectedPolygonRef, 'downslope', s);

        // 2) Toggle the active class
        rightDownslopeBtn.classList.add('active');
        rightSouthBtn.classList.remove('active');
    };

    // SYNC THE BUTTONS AND NUMBERS WITH THE CURRENT SELECTION
    function showPolygonOptions(ref) {
        // FIONA'S CHANGES
        selectedPolygonRef = ref;

        const spacingInput = document.getElementById("polygonPanelSpacing");
        const gcrInput = document.getElementById("polygonGCR");
        const rightSouthBtn = document.getElementById("orientSouthBtn");
        const rightDownslopeBtn = document.getElementById("orientDownslopeBtn");

        if (spacingInput) spacingInput.value = Number(ref.spacing).toFixed(2);

        // compute GCR = y / spacing
        const currentGCR = ref.y / ref.spacing;
        if (gcrInput) gcrInput.value = Number(currentGCR).toFixed(3);

        const panel = document.getElementById("polygonOptions");
        if (panel) panel.style.display = "block";

        if (rightSouthBtn) rightSouthBtn.classList.toggle("active", ref.orientation === "south");
        if (rightDownslopeBtn) rightDownslopeBtn.classList.toggle("active", ref.orientation === "downslope");
    }

// CHANGING GCR WILL CHANGE PANEL SPACING

    gcrInput.addEventListener('change', async function () {
        if (!selectedPolygonRef) return;

        const gcr = parseFloat(this.value);
        if (isNaN(gcr) || gcr <= 0) return;

        // new spacing so that gcr = y / spacing
        const newSpacing = selectedPolygonRef.y / gcr;

        spacingInput.value = newSpacing;
        await updatePolygonOrientation(
            selectedPolygonRef,
            selectedPolygonRef.orientation,
            newSpacing
        );

        // keep the store in sync
        selectedPolygonRef.spacing = newSpacing;
    });


// CLEAR SELECTION BY ENTER

    function clearSelection() {
        if (!selectedPolygonRef) return;

        // 1) reset the polygon’s material
        selectedPolygonRef.polygon.polygon.material =
            Cesium.Color.fromCssColorString('#fadfad').withAlpha(0);

        // 2) clear the JS ref
        selectedPolygonRef = null;

        // 3) hide the right-hand panel

        polygonOptions.style.display = 'none';
    }


// let Enter do the same
    document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                clearSelection();
            }
        }
    );

};

main();

