import * as Cesium from "cesium";
import {generateHexagonalTurbinePositions} from "../wind_output/turbine_placers.js"

export function getPolygonVerticesCartesian(ref) {
    // Prefer stored vertices if present
    console.log("Entered getPolygonVerticesCartesian")
    if (Array.isArray(ref.polygonVertices) && ref.polygonVertices.length >= 3) return ref.polygonVertices;

    // Fallback: read hierarchy from Cesium polygon entity
    const now = Cesium.JulianDate.now();
    const h = ref?.polygon?.polygon?.hierarchy?.getValue?.(now);
    return h?.positions ?? [];
}

export function removePolygonTurbines(ref, viewer, rotatingBladesRef) {
    console.log("Entered removePolygonTurbines")
    if (!ref || !Array.isArray(ref.turbines)) return;

    // Remove from viewer
    ref.turbines.forEach(e => viewer.entities.remove(e));

    // Remove blades from rotatingBlades
    rotatingBladesRef.length = rotatingBladesRef.length;
    for (let i = rotatingBladesRef.length - 1; i >= 0; i--) {
        if (ref.turbines.includes(rotatingBladesRef[i])) {
            rotatingBladesRef.splice(i, 1);
        }
    }

    // Clear record
    ref.turbines = [];
    ref.positions = [];
}


function lonLatFromCartesians(cartesians) {
    return cartesians.map(pt => {
        const c = Cesium.Cartographic.fromCartesian(pt);
        return [Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude)];
    });
}

// densify boundary: create extra points along polygon edges
function densifyPolygonBoundaryLonLat(polyLonLat, stepMeters) {
    if (!polyLonLat || polyLonLat.length < 3) return [];
    const pts = [];

    // meters per degree approx at mean lat
    const lats = polyLonLat.map(p => p[1]);
    const meanLatRad = Cesium.Math.toRadians(lats.reduce((a,b)=>a+b,0)/lats.length);
    const mPerDegLat = 111320;
    const mPerDegLon = 111320 * Math.cos(meanLatRad);

    function distM(a, b) {
        const dx = (b[0]-a[0]) * mPerDegLon;
        const dy = (b[1]-a[1]) * mPerDegLat;
        return Math.sqrt(dx*dx + dy*dy);
    }

    for (let i = 0; i < polyLonLat.length; i++) {
        const a = polyLonLat[i];
        const b = polyLonLat[(i+1) % polyLonLat.length];
        const d = distM(a, b);
        const n = Math.max(1, Math.floor(d / stepMeters));

        for (let k = 0; k <= n; k++) {
            const t = k / n;
            const lon = a[0] + (b[0]-a[0]) * t;
            const lat = a[1] + (b[1]-a[1]) * t;
            pts.push([lon, lat]);
        }
    }
    return pts;
}

// candidate generator: interior grid + denser boundary points
export function generateCandidateLonLat(cartesians, spacingMeters, boundaryStepMeters) {
    const interior = generateHexagonalTurbinePositions(cartesians, spacingMeters); // returns [lon,lat]

    const polyLonLat = lonLatFromCartesians(cartesians);

    const boundary = densifyPolygonBoundaryLonLat(polyLonLat, boundaryStepMeters);

    // merge + de-dup (rough)
    const seen = new Set();
    const merged = [];
    [...boundary, ...interior].forEach(([lon, lat]) => {
        const key = `${lon.toFixed(7)},${lat.toFixed(7)}`;
        if (!seen.has(key)) {
            seen.add(key);
            merged.push([lon, lat]);
        }
    });
    return merged;
}

// place turbines at explicit lon/lat list (returned by optimizer)
export async function placeTurbinesAtLonLat(lonLatList, hubHeight, viewer, rotatingBlades) {
    const newEntities = [];
    if (!lonLatList || lonLatList.length === 0) return newEntities;

    const cartos = lonLatList.map(([lon, lat]) =>
        new Cesium.Cartographic(Cesium.Math.toRadians(lon), Cesium.Math.toRadians(lat), 0)
    );

    const detailed = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, cartos);

    detailed.forEach(c => {
        const groundPos = Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, c.height);

        const mast = viewer.entities.add({
            name: "Wind Turbine",
            position: groundPos,
            model: { uri: `/tiles/turbines/mastandnacelle${hubHeight}.glb`, scale: 1, runAnimations: false },
            description: `Initial hub height: ${hubHeight} meters`
        });
        newEntities.push(mast);

        const hubPos = Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, c.height + hubHeight);
        const blades = viewer.entities.add({
            position: hubPos,
            orientation: Cesium.Transforms.headingPitchRollQuaternion(
                hubPos, new Cesium.HeadingPitchRoll(0, 0, 0)
            ),
            model: { uri: `/tiles/turbines/bladesandhub${hubHeight}center.glb`, scale: 1, runAnimations: false }
        });
        newEntities.push(blades);
        rotatingBlades.push(blades);
    });

    return newEntities;
}
