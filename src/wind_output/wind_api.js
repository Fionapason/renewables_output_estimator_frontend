import * as Cesium from "cesium";

const WIND_API_BASE = "http://localhost:8000";

// SET OUTPUT
export async function computeAndUpdateOutputWind(ref) {
    if (!ref) {
        setPolygonWindOutput("—");
        return;
    }

    const mastEntity = null

    try {
        setPolygonWindOutput("computing…");
        setSelectedWindOutput("computing…");

        const payload = await buildAnnualWindPayloadFromPolygonRef(ref);

        const result = await callComputeAnnualWind(payload);

        const kwh = result?.annual_kWh ?? result?.annual_kWh; // keep simple
        if (kwh == null) {
            setPolygonWindOutput("API ok, missing annual_kWh");
            return;
        }
        const mwh = kwh / 1000
        const rec = ref.record ?? ref;

        // --- write per-turbine outputs back onto the record ---
        const per = result?.per_turbine_kWh;
        if (per != null) {
            // Ensure we have a place to store turbine outputs
            // We'll store by turbine id: rec.turbineOutputs_kWh = { id: kWh }
            rec.turbineOutputs_kWh = rec.turbineOutputs_kWh ?? {};

            if (Array.isArray(per)) {
                // Assumption: array aligns with payload.turbines order
                payload.turbines.forEach((t, idx) => {
                    const val = per[idx];
                    if (val != null) rec.turbineOutputs_kWh[t.id] = val;
                });
            } else if (typeof per === "object") {
                // Map keyed by turbine id
                Object.entries(per).forEach(([id, val]) => {
                    if (val != null) rec.turbineOutputs_kWh[id] = val;
                });
            } else {
                console.warn("per_turbine_kWh has unexpected type:", typeof per);
            }

            // Optional convenience: also attach output onto each *mast* entity for easy label display
            // (Assumes turbines are stored as [mast, blades, mast, blades, ...])
            if (Array.isArray(rec.turbines) && rec.turbines.length >= 2) {
                for (let i = 0; i < payload.turbines.length; i++) {
                    const turbineId = payload.turbines[i].id;
                    const kWh = rec.turbineOutputs_kWh[turbineId];
                    const mastEntity = rec.turbines[i * 2]; // 0,2,4,... are masts

                    if (mastEntity && kWh != null) {
                        mastEntity.windOutput_kWh = kWh; // custom property
                        mastEntity.description = `Hub height: ${rec.hubHeight} m<br/>Annual: ${Math.round(kWh / 1000)} MWh`;
                    }
                }
            }
        }

        const mwhTotal = kwh / 1000;
        setPolygonWindOutput(`${Math.round(mwhTotal)} MWh/year`);
        if (mastEntity != null) {

            let single_output = mastEntity.windOutput_kWh / 1000;
            single_output = Math.round(single_output);
            const output_text = `${single_output} MWh/year`;

            setSelectedWindOutput(output_text);
        }
    } catch (e) {
        console.error(e);
        setPolygonWindOutput(`error`);
        setSelectedWindOutput(`error`);
    }
}

// Display calculated Output
function setPolygonWindOutput(text_polygon) {

    const el_polyongturbine = document.getElementById("polygonturbine_windOutput");
    if (el_polyongturbine) el_polyongturbine.textContent = `output: ${text_polygon}`;
}

export function setSelectedWindOutput(text_single) {
    const el_singleturbine = document.getElementById("singleturbine_windOutput");
    if (el_singleturbine) el_singleturbine.textContent = `output: ${text_single}`
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


// Build API input for Wind AEP from a "turbine ref" record (single or multi)
// Python DTO expects:
// { output: "annual", turbines: [{ id, lon, lat, hub_height_m }, ...] }
async function buildAnnualWindPayloadFromPolygonRef(ref) {
    if (!ref) throw new Error("No turbine ref");

    const record = ref.record ?? ref;

    // IMPORTANT: support your polygon record shape directly:
    // record.positions is the ground Cartesian3[] for ALL turbines
    const positionsArr = Array.isArray(record.positions)
        ? record.positions
        : Array.from(record.positions ?? []);

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

    return {
        output: "annual",
        turbines: turbineDTOs
    };
}




//-----------------VALUE RETRIEVERS-----------------

// Retrieve Tilt from UI
function getTiltModeFromUI(ref) {
    if (document.getElementById("tilt30Btn")?.classList.contains("active")) return 30;
    if (document.getElementById("tilt75Btn")?.classList.contains("active")) return 75;

    return (ref.y === 0.65) ? 75 : 30;; // default if auto is active or none is set
}