import * as Cesium from "cesium";
import {
    generateCandidateLonLat,
    getPolygonVerticesCartesian,
    placeTurbinesAtLonLat,
    removePolygonTurbines
} from "./optimizer_helpers.js";
import {
    setPolygonWindOutput_Annual, setPolygonWindOutput_Winter, setPolygonWindOutput_Summer, setSelectedWindOutput_Annual,
    setSelectedWindOutput_Winter, setSelectedWindOutput_Summer, setPolygonWindTradeoff, removePolygonWindTradeoff,

} from "./output_ui.js";

const WIND_API_BASE = "http://localhost:8080";

// SET OUTPUT
export async function computeAndUpdateOutputWind(ref, selectedMast = null) {

    try {
        removePolygonWindTradeoff();
        setPolygonWindOutput_Annual("Computing…");
        setSelectedWindOutput_Annual("Computing…");

        setPolygonWindOutput_Winter("—");
        setPolygonWindOutput_Summer("—");

        setSelectedWindOutput_Winter("—");
        setSelectedWindOutput_Summer("—");

        const payload = await buildAnnualWindPayloadFromPolygonRef(ref);
        const result = await callComputeWind(payload);

        console.error("[wind] API result keys:", Object.keys(result || {}));
        console.error("[wind] API per-turbine maps:", {
            annual: result?.per_turbine_annual,
            winter: result?.per_turbine_winter,
            summer: result?.per_turbine_summer,
        });


        const total_kWh = result?.annual_kWh;
        if (total_kWh == null) {
            setPolygonWindOutput_Annual("API ok, missing annual_kWh");
            setSelectedWindOutput_Annual("—");
            return;
        }
        const winter_kWh = result?.winter_kWh;
        const summer_kWh = result?.summer_kWh;

        const rec = ref.record ?? ref;

        // --- store per turbine outputs ---
        const annual_per_turbine = result?.per_turbine_annual;
        rec.turbineOutputs_kWh_annual = rec.turbineOutputs_kWh_annual ?? {};

        const winter_per_turbine = result?.per_turbine_winter;
        const summer_per_turbine = result?.per_turbine_summer;

        rec.turbineOutputs_kWh_winter = rec.turbineOutputs_kWh_winter ?? {};
        rec.turbineOutputs_kWh_summer = rec.turbineOutputs_kWh_summer ?? {};


        if (annual_per_turbine != null) {
            if (Array.isArray(annual_per_turbine)) {
                payload.turbines.forEach((t, idx) => {
                    const val = annual_per_turbine[idx];
                    if (val != null) rec.turbineOutputs_kWh_annual[t.id] = val;
                });
            } else if (typeof annual_per_turbine === "object") {
                Object.entries(annual_per_turbine).forEach(([id, val]) => {
                    if (val != null) rec.turbineOutputs_kWh_annual[id] = val;
                });
            }
        }

        if (winter_per_turbine != null) {
            if (Array.isArray(winter_per_turbine)) {
                payload.turbines.forEach((t, idx) => {
                    const val = winter_per_turbine[idx];
                    if (val != null) rec.turbineOutputs_kWh_winter[t.id] = val;
                });
            } else if (typeof winter_per_turbine === "object") {
                Object.entries(winter_per_turbine).forEach(([id, val]) => {
                    if (val != null) rec.turbineOutputs_kWh_winter[id] = val;
                });
            }
        }

        if (summer_per_turbine != null) {
            if (Array.isArray(summer_per_turbine)) {
                payload.turbines.forEach((t, idx) => {
                    const val = summer_per_turbine[idx];
                    if (val != null) rec.turbineOutputs_kWh_summer[t.id] = val;
                });
            } else if (typeof summer_per_turbine === "object") {
                Object.entries(summer_per_turbine).forEach(([id, val]) => {
                    if (val != null) rec.turbineOutputs_kWh_summer[id] = val;
                });
            }
        }

        // --- attach outputs onto mast entities (optional convenience) ---
        if (Array.isArray(rec.turbines) && rec.turbines.length >= 2 && payload?.turbines?.length) {
            for (let i = 0; i < payload.turbines.length; i++) {
                const turbineId = payload.turbines[i].id;

                const annual_kWh = rec.turbineOutputs_kWh_annual[turbineId];
                const winter_kWh = rec.turbineOutputs_kWh_winter[turbineId];
                const summer_kWh = rec.turbineOutputs_kWh_summer[turbineId];

                const mast = rec.turbines[i * 2]; // assumes [mast, blades, mast, blades,...]
                if (mast && annual_kWh != null && winter_kWh != null && summer_kWh != null) {
                    mast.windAnnualOutput_kWh = annual_kWh;
                    mast.windWinterOutput_kWh = winter_kWh;
                    mast.windSummerOutput_kWh = summer_kWh;
                    mast.turbineId = mast.turbineId ?? turbineId; // ensure it exists

                    const annual_MWh = annual_kWh / 1000;
                    const winter_MWh = winter_kWh / 1000;

                    // round annual first
                    const rounded_annual_MWh = Math.round(annual_MWh / 100) * 100;

                    // round winter
                    const rounded_winter_MWh = Math.round(winter_MWh / 100) * 100;

                    // force consistency
                    const rounded_summer_MWh = rounded_annual_MWh - rounded_winter_MWh;

                    mast.description = `Hub height: ${rec.hubHeight} m<br/>Annual Energy Output: ${rounded_annual_MWh} MWh/year<br/>Winter Energy Output: ${rounded_winter_MWh} MWh<br/>Summer Energy Output: ${rounded_summer_MWh} MWh`;
                }
            }
        }

        // --- total polygon output ---
        const roundedTotal_MWh = Math.round((total_kWh / 1000) / 100) * 100;
        setPolygonWindOutput_Annual(`${roundedTotal_MWh} MWh/year`);

        const roundedWinter_MWh = Math.round((winter_kWh / 1000) / 100) * 100;
        setPolygonWindOutput_Winter(`${roundedWinter_MWh} MWh`);

        const roundedSummer_Mwh = Math.round( (summer_kWh / 1000) / 100 ) * 100;
        setPolygonWindOutput_Summer(`${roundedSummer_Mwh} MWh`);

        // --- selected turbine output (works for polygon turbine AND single turbine) ---
        if (selectedMast) {
            const id = selectedMast.turbineId;
            const selected_annual_kWh = id ? rec.turbineOutputs_kWh_annual?.[id] : selectedMast.windAnnualOutput_kWh;
            const selected_winter_kWh = id ? rec.turbineOutputs_kWh_winter?.[id] : selectedMast.windWinterOutput_kWh;
            const selected_summer_kWh = id ? rec.turbineOutputs_kWh_summer?.[id] : selectedMast.windSummerOutput_kWh;

            console.log("Selected turbine debug:", {
                turbineId: selectedMast?.turbineId,
                annualKeys: rec?.turbineOutputs_kWh_annual
                    ? Object.keys(rec.turbineOutputs_kWh_annual)
                    : null,
                winterKeys: rec?.turbineOutputs_kWh_winter
                    ? Object.keys(rec.turbineOutputs_kWh_winter)
                    : null,
                summerKeys: rec?.turbineOutputs_kWh_summer
                    ? Object.keys(rec.turbineOutputs_kWh_summer)
                    : null,
            });


            if (selected_annual_kWh !== null) {
                const roundedSel_MWh_annual = Math.round((selected_annual_kWh / 1000) / 100) * 100;
                const roundedSel_MWh_winter = Math.round((selected_winter_kWh / 1000) / 100) * 100;
                const roundedSel_MWh_summer = Math.round((selected_summer_kWh / 1000) / 100) * 100;

                setSelectedWindOutput_Annual(`${roundedSel_MWh_annual} MWh/year`);
                setSelectedWindOutput_Winter(`${roundedSel_MWh_winter} MWh/year`);
                setSelectedWindOutput_Summer(`${roundedSel_MWh_summer} MWh/year`);
            } else {
                setSelectedWindOutput_Annual("—");
                setSelectedWindOutput_Winter("—");
                setSelectedWindOutput_Summer("—");
            }
        } else {
            setSelectedWindOutput_Annual("—");
            setSelectedWindOutput_Winter("—");
            setSelectedWindOutput_Summer("—");
        }

        if (ref.annual_best != null) {
            const annual_change_percent = Math.round((total_kWh / ref.annual_best - 1) * 100);
            const winter_change_percent = Math.round((winter_kWh / ref.winter_best - 1) * 100);
            const summer_change_percent = Math.round((summer_kWh / ref.summer_best - 1) * 100);
            setPolygonWindTradeoff(annual_change_percent, winter_change_percent, summer_change_percent)
        } else {
            console.log("NOT FIRST!")
        }

    } catch (e) {
        console.error(e);
        setPolygonWindOutput_Annual("ERROR");
        setSelectedWindOutput_Annual("ERROR");

        setSelectedWindOutput_Annual("—");
        setSelectedWindOutput_Winter("—");
        setPolygonWindOutput_Winter("—");
        setPolygonWindOutput_Summer("—");
    }
}


// Make API Call
async function callComputeWind(payload) {
    const res = await fetch(`${WIND_API_BASE}/compute-wind`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await res.text());
    return await res.json(); // expects { annual_kWh: number }
}

export async function optimizePolygon(selectedPolygonRef, viewer, rotatingBlades, selectedMast = null) {
    if (!selectedPolygonRef) return;

    setPolygonWindOutput_Annual("Computing…");
    setSelectedWindOutput_Annual("Computing…");

    setPolygonWindOutput_Winter("—")
    setPolygonWindOutput_Summer("—")

    const ref = selectedPolygonRef;

    const turbine_params = ref.turbineParamsOverride ?? null;

    // Hub height from panel (already synced in showPolygonOptions)
    const hubHeight = parseInt(document.getElementById("polyHubHeight").value, 10) || ref.hubHeight || 100;

    // Rotor diameter: you should replace this with real turbine metadata later
    // (Right now you used rotorRadius=250/350/450, so diameter=500/700/900)
    const rotorDiameter_m = (hubHeight === 150) ? 900 : (hubHeight === 125) ? 700 : 500;

    // Minimum spacing in rotor diameters (D)
    const min_spacing_D = 1.0;

    // Candidate density:
    // - interior spacing smaller than min spacing (so optimizer can choose 0.5D shifts etc.)
    // - boundary sampled more densely
    // all will be > 100m, which is resolution of the map
    const interiorSpacing_m = rotorDiameter_m * (min_spacing_D); // * 0.5
    const boundaryStep_m = rotorDiameter_m * 0.5; // * 0.25

    const verts = getPolygonVerticesCartesian(ref);
    if (!verts || verts.length < 3) return;

    // 1) Generate candidate lon/lat
    const candidateLonLat = generateCandidateLonLat(verts, interiorSpacing_m, boundaryStep_m);
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
        minimum_distance_diameter: rotorDiameter_m,
        min_spacing_D: min_spacing_D,
        turbine_params: turbine_params,
        candidates
    };

    // 4) Call optimizer
    let result;
    try {
        const res = await fetch(WIND_API_BASE + "/optimize-annual-wind", {
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

    const rec = ref.record ?? ref;

    // keep expected structure: [mast, blades, mast, blades,...]
    rec.turbines = newEntities;
    ref.turbines = newEntities;

    // positions should be derived from masts only (but don't overwrite turbines array)
    const now = Cesium.JulianDate.now();
    const masts = newEntities.filter(e => {
      const uri = e?.model?.uri?.getValue?.(now) ?? "";
      return uri.includes("mastandnacelle");
    });
    ref.positions = masts.map(m => m.position?.getValue(now)).filter(Boolean);

    const total_annual_kWh = result?.annual_kWh ?? 0;
    const total_winter_kWh = result?.winter_kWh ?? 0;
    const total_summer_kWh = result?.summer_kWh ?? 0;

    ref.annual_best = total_annual_kWh;
    ref.winter_best = total_winter_kWh;
    ref.summer_best = total_summer_kWh;

    // --- total polygon output ---
    const roundedTotal_MWh = Math.round((total_annual_kWh / 1000) / 100) * 100;
    setPolygonWindOutput_Annual(`${roundedTotal_MWh} MWh/year`);

    const roundedWinter_MWh = Math.round((total_winter_kWh / 1000) / 100) * 100;
    setPolygonWindOutput_Winter(`${roundedWinter_MWh} MWh`);

    const roundedSummer_Mwh = Math.round( (total_summer_kWh / 1000) / 100 ) * 100;
    setPolygonWindOutput_Summer(`${roundedSummer_Mwh} MWh`);



    // --- store per turbine outputs ---
        const annual_per_turbine = result?.per_turbine_annual;
        rec.turbineOutputs_kWh_annual = rec.turbineOutputs_kWh_annual ?? {};

        const winter_per_turbine = result?.per_turbine_winter;
        const summer_per_turbine = result?.per_turbine_summer;

        rec.turbineOutputs_kWh_winter = rec.turbineOutputs_kWh_winter ?? {};
        rec.turbineOutputs_kWh_summer = rec.turbineOutputs_kWh_summer ?? {};


        if (annual_per_turbine != null) {
            if (Array.isArray(annual_per_turbine)) {
                result.turbines.forEach((t, idx) => {
                    const val = annual_per_turbine[idx];
                    if (val != null) rec.turbineOutputs_kWh_annual[t.id] = val;
                });
            } else if (typeof annual_per_turbine === "object") {
                Object.entries(annual_per_turbine).forEach(([id, val]) => {
                    if (val != null) rec.turbineOutputs_kWh_annual[id] = val;
                });
            }
        }

        if (winter_per_turbine != null) {
            if (Array.isArray(winter_per_turbine)) {
                result.turbines.forEach((t, idx) => {
                    const val = winter_per_turbine[idx];
                    if (val != null) rec.turbineOutputs_kWh_winter[t.id] = val;
                });
            } else if (typeof winter_per_turbine === "object") {
                Object.entries(winter_per_turbine).forEach(([id, val]) => {
                    if (val != null) rec.turbineOutputs_kWh_winter[id] = val;
                });
            }
        }

        if (summer_per_turbine != null) {
            if (Array.isArray(summer_per_turbine)) {
                result.turbines.forEach((t, idx) => {
                    const val = summer_per_turbine[idx];
                    if (val != null) rec.turbineOutputs_kWh_summer[t.id] = val;
                });
            } else if (typeof summer_per_turbine === "object") {
                Object.entries(summer_per_turbine).forEach(([id, val]) => {
                    if (val != null) rec.turbineOutputs_kWh_summer[id] = val;
                });
            }
        }

        // --- attach outputs onto mast entities (optional convenience) ---
        if (Array.isArray(rec.turbines) && rec.turbines.length >= 2 && result?.turbines?.length) {
            for (let i = 0; i < result.turbines.length; i++) {
                const turbineId = result.turbines[i].id;

                const annual_kWh = rec.turbineOutputs_kWh_annual[turbineId];
                const winter_kWh = rec.turbineOutputs_kWh_winter[turbineId];
                const summer_kWh = rec.turbineOutputs_kWh_summer[turbineId];

                const mast = rec.turbines[i * 2];   // now rec.turbines is masts only
                // assumes [mast, blades, mast, blades,...]
                if (mast && annual_kWh != null && winter_kWh != null && summer_kWh != null) {
                    mast.windAnnualOutput_kWh = annual_kWh;
                    mast.windWinterOutput_kWh = winter_kWh;
                    mast.windSummerOutput_kWh = summer_kWh;
                    mast.turbineId = mast.turbineId ?? turbineId; // ensure it exists

                    const annual_MWh = annual_kWh / 1000;
                    const winter_MWh = winter_kWh / 1000;

                    // round annual first
                    const rounded_annual_MWh = Math.round(annual_MWh / 100) * 100;

                    // round winter
                    const rounded_winter_MWh = Math.round(winter_MWh / 100) * 100;

                    // force consistency
                    const rounded_summer_MWh = rounded_annual_MWh - rounded_winter_MWh;

                    mast.description = `Hub height: ${rec.hubHeight} m<br/>Annual Energy Output: ${rounded_annual_MWh} MWh/year<br/>Winter Energy Output: ${rounded_winter_MWh} MWh<br/>Summer Energy Output: ${rounded_summer_MWh} MWh`;
                }
            }
        }
        // --- selected turbine output (works for polygon turbine AND single turbine) ---
        if (selectedMast) {
            const id = selectedMast.turbineId;
            const selected_annual_kWh = id ? rec.turbineOutputs_kWh_annual?.[id] : selectedMast.windAnnualOutput_kWh;
            const selected_winter_kWh = id ? rec.turbineOutputs_kWh_winter?.[id] : selectedMast.windWinterOutput_kWh;
            const selected_summer_kWh = id ? rec.turbineOutputs_kWh_summer?.[id] : selectedMast.windSummerOutput_kWh;

            console.log("Selected turbine debug:", {
                turbineId: selectedMast?.turbineId,
                annualKeys: rec?.turbineOutputs_kWh_annual
                    ? Object.keys(rec.turbineOutputs_kWh_annual)
                    : null,
                winterKeys: rec?.turbineOutputs_kWh_winter
                    ? Object.keys(rec.turbineOutputs_kWh_winter)
                    : null,
                summerKeys: rec?.turbineOutputs_kWh_summer
                    ? Object.keys(rec.turbineOutputs_kWh_summer)
                    : null,
            });


            if (selected_annual_kWh != null && selected_winter_kWh != null && selected_summer_kWh != null) {
                const roundedSel_MWh_annual = Math.round((selected_annual_kWh / 1000) / 100) * 100;
                const roundedSel_MWh_winter = Math.round((selected_winter_kWh / 1000) / 100) * 100;
                const roundedSel_MWh_summer = Math.round((selected_summer_kWh / 1000) / 100) * 100;

                setSelectedWindOutput_Annual(`${roundedSel_MWh_annual} MWh/year`);
                setSelectedWindOutput_Winter(`${roundedSel_MWh_winter} MWh/year`);
                setSelectedWindOutput_Summer(`${roundedSel_MWh_summer} MWh/year`);
            } else {
                setSelectedWindOutput_Annual("—");
                setSelectedWindOutput_Winter("—");
                setSelectedWindOutput_Summer("—");
            }
        } else {
            setSelectedWindOutput_Annual("—");
            setSelectedWindOutput_Winter("—");
            setSelectedWindOutput_Summer("—");
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

    if (positionsArr.length === 0) {
        setPolygonWindOutput_Annual("0 MWh");
        setPolygonWindOutput_Winter("—");
        setPolygonWindOutput_Summer("—");
    }


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
        turbines: turbineDTOs
    };
}