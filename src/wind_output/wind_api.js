import * as Cesium from "cesium";

const WIND_API_BASE = "http://localhost:8000";

// SET OUTPUT
export async function computeAndUpdateOutputWind(ref) {
    if (!ref) {
        setWindOutput("—");
        return;
    }

    try {
        setWindOutput("computing…");

        if (ref.no_one_or_multiple_rows == 0) {
            setWindOutput("–");
            return;
        }

        const payload = await buildAnnualWindPayloadFromPolygonRef(ref);

        const result = await callComputeAnnualWind(payload);

        const kwh = result?.annual_kWh ?? result?.annual_kWh; // keep simple
        if (kwh == null) {
            setWindOutput("API ok, missing annual_kWh");
            return;
        }
        const mwh = kwh / 1000
        setWindOutput(`${Math.round(mwh)} MWh/year`);
    } catch (e) {
        console.error(e);
        setWindOutput(`error`);
    }
}

// Display calculated Output
function setWindOutput(text) {

    const el_singleturbine = document.getElementById("singleturbine_windOutput");
    if (el_singleturbine) el_singleturbine.textContent = `output: ${text}`;

    const el_polyongturbine = document.getElementById("polygonturbine_windOutput");
    if (el_polyongturbine) el_polyongturbine.textContent = `output: ${text}`;
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
async function buildAnnualWindPayloadFromPolygonRef(ref, height) {
    if (!ref) throw new Error("No turbine ref");
    if (!height) height = 100;

    // Support both shapes:
    // 1) selectedTurbineRef = { entities:[...], record:{ positions:[Cartesian3...], hubHeight } }
    // 2) direct record-like object { positions:[...], hubHeight, id }
    const record = ref.record ?? ref;

    const positionsArr = Array.isArray(record.positions)
        ? record.positions
        : Array.from(record.positions ?? []);

    if (positionsArr.length === 0) throw new Error("No turbine positions in ref");

    // Hub height: prefer record, otherwise UI fallback, otherwise default 100
    const hubHeight =
        Number(record.hubHeight) ||
        Number(document.getElementById("turbineHeight")?.value) ||
        100;

    console.log("Fetching Output of Turbine of height: " + hubHeight + "m…")

    const turbineDTOs = positionsArr
        .map((pos, i) => {
            if (!Cesium.defined(pos)) return null;

            const carto = Cesium.Cartographic.fromCartesian(pos);
            const lon = Cesium.Math.toDegrees(carto.longitude);
            const lat = Cesium.Math.toDegrees(carto.latitude);

            // Stable id (match your PV style)
            const baseId = record.id ?? ref.id ?? "turbine";
            return {
                id: `${baseId}_t${i}`,
                lon,
                lat,
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