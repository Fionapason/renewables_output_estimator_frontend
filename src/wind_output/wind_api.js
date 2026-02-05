import * as Cesium from "cesium";
import {
    generateCandidateLonLat,
    getPolygonVerticesCartesian,
    placeTurbinesAtLonLat,
    removePolygonTurbines
} from "./optimizer_helpers.js";
import {setPolygonWindOutput, setSelectedWindOutput} from "./output_ui.js";

const WIND_API_BASE = "http://localhost:8080";

// SET OUTPUT
export async function computeAndUpdateOutputWind(ref, selectedMast = null) {
    if (!ref) {
        setPolygonWindOutput("—");
        setSelectedWindOutput("—");
        return;
    }

    try {
        setPolygonWindOutput("Computing…");
        setSelectedWindOutput("Computing…");

        const payload = await buildAnnualWindPayloadFromPolygonRef(ref);
        const result = await callComputeAnnualWind(payload);

        const total_kWh = result?.annual_kWh;
        if (total_kWh == null) {
            setPolygonWindOutput("API ok, missing annual_kWh");
            setSelectedWindOutput("—");
            return;
        }

        const rec = ref.record ?? ref;

        // --- store per turbine outputs ---
        const per = result?.per_turbine_kWh;
        rec.turbineOutputs_kWh = rec.turbineOutputs_kWh ?? {};

        if (per != null) {
            if (Array.isArray(per)) {
                payload.turbines.forEach((t, idx) => {
                    const val = per[idx];
                    if (val != null) rec.turbineOutputs_kWh[t.id] = val;
                });
            } else if (typeof per === "object") {
                Object.entries(per).forEach(([id, val]) => {
                    if (val != null) rec.turbineOutputs_kWh[id] = val;
                });
            }
        }

        // --- attach outputs onto mast entities (optional convenience) ---
        if (Array.isArray(rec.turbines) && rec.turbines.length >= 2 && payload?.turbines?.length) {
            for (let i = 0; i < payload.turbines.length; i++) {
                const turbineId = payload.turbines[i].id;
                const kWh = rec.turbineOutputs_kWh[turbineId];
                const mast = rec.turbines[i * 2]; // assumes [mast, blades, mast, blades,...]
                if (mast && kWh != null) {
                    mast.windOutput_kWh = kWh;
                    mast.turbineId = mast.turbineId ?? turbineId; // ensure it exists
                    const rounded_MWh = Math.round((kWh / 1000) / 100) * 100;
                    mast.description = `Hub height: ${rec.hubHeight} m<br/>Annual Energy Output: ${rounded_MWh} MWh/year`;
                }
            }
        }

        // --- total polygon output ---
        const roundedTotal_MWh = Math.round((total_kWh / 1000) / 100) * 100;
        setPolygonWindOutput(`${roundedTotal_MWh} MWh/year`);

        // --- selected turbine output (works for polygon turbine AND single turbine) ---
        if (selectedMast) {
            const id = selectedMast.turbineId;
            const sel_kWh = id ? rec.turbineOutputs_kWh?.[id] : selectedMast.windOutput_kWh;

            if (sel_kWh != null) {
                const roundedSel_MWh = Math.round((sel_kWh / 1000) / 100) * 100;
                setSelectedWindOutput(`${roundedSel_MWh} MWh/year`);
            } else {
                setSelectedWindOutput("—");
            }
        } else {
            setSelectedWindOutput("—");
        }

    } catch (e) {
        console.error(e);
        setPolygonWindOutput("ERROR");
        setSelectedWindOutput("ERROR");
    }
}


// Make API Call
async function callComputeAnnualWind(payload) {
    const res = await fetch(`${WIND_API_BASE}/compute-annual`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await res.text());
    return await res.json(); // expects { annual_kWh: number }
}

export async function optimizePolygon(selectedPolygonRef, viewer, rotatingBlades) {
    if (!selectedPolygonRef) return;

    const ref = selectedPolygonRef;

    // Hub height from panel (already synced in showPolygonOptions)
    const hubHeight = parseInt(document.getElementById("polyHubHeight").value, 10) || ref.hubHeight || 100;

    // Rotor diameter: you should replace this with real turbine metadata later
    // (Right now you used rotorRadius=250/350/450, so diameter=500/700/900)
    const rotorDiameter_m = (hubHeight === 150) ? 900 : (hubHeight === 125) ? 700 : 500;

    // Minimum spacing in rotor diameters (D) — replace with UI value later if you add one
    const min_spacing_D = 1.0;

    // Candidate density:
    // - interior spacing smaller than min spacing (so optimizer can choose 0.5D shifts etc.)
    // - boundary sampled more densely
    const interiorSpacing_m = rotorDiameter_m * (min_spacing_D * 0.5);
    const boundaryStep_m = rotorDiameter_m * 0.25;

    const verts = getPolygonVerticesCartesian(ref);
    console.log("Exited getPolygonVerticesCartesian")
    if (!verts || verts.length < 3) return;

    // 1) Generate candidate lon/lat
    const candidateLonLat = generateCandidateLonLat(verts, interiorSpacing_m, boundaryStep_m);
    console.log("Entered generateCandidateLonLat")
    if (candidateLonLat.length === 0) return;

    // 2) Sample terrain height for candidates (hub_elevation_m = ground height)
    const cartos = candidateLonLat.map(([lon, lat]) =>
        new Cesium.Cartographic(Cesium.Math.toRadians(lon), Cesium.Math.toRadians(lat), 0)
    );
    const detailed = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, cartos);

    const candidates = detailed.map((c, i) => ({
        id: `c${i}`,
        lon: Cesium.Math.toDegrees(c.longitude),
        lat: Cesium.Math.toDegrees(c.latitude),
        hub_elevation_m: c.height
    }));

    // 3) Build DTO
    const dto = {
        hub_height_m: hubHeight,
        rotor_diameter_m: rotorDiameter_m,
        min_spacing_D: min_spacing_D,
        candidates
    };

    // 4) Call optimizer
    let result;
    try {
        const res = await fetch(WIND_API_BASE + "/optimize-annual", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(dto)
        });
        if (!res.ok) throw new Error(await res.text());
        result = await res.json();
    } catch (e) {
        console.error("Optimize API error:", e);
        return;
    }

    // Expected: { turbines: [{lat,lon,hub_elevation_m?}, ...], num_turbines, total_aep_kwh }
    const optimized = result?.turbines ?? [];
    if (optimized.length === 0) return;

    // 5) Remove old (hex) turbines before placing new ones
    removePolygonTurbines(ref, viewer, rotatingBlades);

    // 6) Place optimized turbines
    const lonLatList = optimized.map(t => [t.lon, t.lat]);
    const newEntities = await placeTurbinesAtLonLat(lonLatList, hubHeight, viewer, rotatingBlades);

    // 7) Update record + recompute AEP
    ref.turbines = newEntities;
    ref.hubHeight = hubHeight;

    // store turbine ground positions (for compute-annual payload)
    // NOTE: we can reuse terrain heights we already sampled if you want,
    // but simplest is: derive ground positions from the mast entities
    const now = Cesium.JulianDate.now();
    ref.positions = [];
    for (let i = 0; i < newEntities.length; i += 2) { // mast indices 0,2,4,...
        const mast = newEntities[i];
        const p = mast.position?.getValue(now);
        if (p) ref.positions.push(p);
    }

    return ref
}


// Build API input for Wind AEP from a "turbine ref" record (single or multi)
// Python DTO expects:
// { output: "annual", turbines: [{ id, lon, lat, hub_height_m }, ...] }
async function buildAnnualWindPayloadFromPolygonRef(ref) {
    if (!ref) throw new Error("No turbine ref");

    const record = ref.record ?? ref;

    // Prefer LIVE mast positions (so drag/move immediately affects payload)
    const now = Cesium.JulianDate.now();

    let positionsArr = [];

    // If we have actual entities, derive positions from masts
    if (Array.isArray(record.turbines) && record.turbines.length > 0) {
        for (const ent of record.turbines) {
            const uri = ent?.model?.uri?.getValue?.(now) || "";
            if (!uri.includes("mastandnacelle")) continue;

            const p = ent.position?.getValue?.(now);
            if (p) positionsArr.push(p);
        }
    }

    // Fallback: stored positions (older path)
    if (positionsArr.length === 0) {
        positionsArr = Array.isArray(record.positions)
            ? record.positions
            : Array.from(record.positions ?? []);
    }

    if (positionsArr.length === 0) throw new Error("No turbine positions in ref");


    const hubHeight =
        Number(record.hubHeight) ||
        Number(document.getElementById("turbineHeight")?.value) ||
        100;

    const baseId = record.id ?? ref.id ?? "turbine";

    const turbineDTOs = positionsArr
        .map((pos, i) => {
            if (!Cesium.defined(pos)) return null;

            const carto = Cesium.Cartographic.fromCartesian(pos);
            return {
                id: `${baseId}_t${i}`,
                lon: Cesium.Math.toDegrees(carto.longitude),
                lat: Cesium.Math.toDegrees(carto.latitude),
                hub_height_m: Math.round(hubHeight)
            };
        })
        .filter(Boolean);

    if (turbineDTOs.length === 0) throw new Error("Could not build turbine DTOs");

    console.log("[payload turbines]", turbineDTOs.map(t => [t.id, t.lon.toFixed(5), t.lat.toFixed(5)]));

    return {
        output: "annual",
        turbines: turbineDTOs
    };
}