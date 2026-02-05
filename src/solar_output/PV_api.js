import {entityLonLat} from "./geometry_helpers.js";
import * as Cesium from "cesium";

const PV_API_BASE = "http://localhost:8000";

// SET OUTPUT
export async function computeAndUpdatePVOutput(ref) {
    if (!ref) {
        setPVOutput("—");
        return;
    }

    try {
        setPVOutput("computing…");

        if (ref.no_one_or_multiple_rows == 0) {
            setPVOutput("–");
            return;
        }

        const payload = await buildAnnualPayloadFromPVPolygonRef(ref);

        const result = await callComputeAnnualPV(payload);

        const kwh = result?.annual_kWh ?? result?.annual_kWh; // keep simple
        if (kwh == null) {
            setPVOutput("API ok, missing annual_kWh");
            return;
        }
        setPVOutput(`${Math.round(kwh)} kWh/year`);
    } catch (e) {
        console.error(e);
        setPVOutput(`error`);
    }
}

// Display calculated Output
function setPVOutput(text) {
    console.log("Entered setPVOutput")
    const el = document.getElementById("pvOutput");
    if (el) el.textContent = `Annual Energy Output: ${text}`;
}

// harmonize UI and polygon spacing
export function setSpacingUI(spacing) {
    const el = document.getElementById("polygonPanelSpacing");
    if (el) el.value = spacing;
}

// Make API Call
async function callComputeAnnualPV(payload) {
    const res = await fetch(`${PV_API_BASE}/compute-annual`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await res.text());
    return await res.json(); // expects { annual_kWh: number }
}


// construct API input from the polygon
async function buildAnnualPayloadFromPVPolygonRef(ref) {

    if (!ref) throw new Error("No polygon ref");
    const panelsArr = Array.isArray(ref.panels) ? ref.panels : Array.from(ref.panels ?? []);
    if (panelsArr.length === 0) throw new Error("Polygon has no panels");

    const gcr = getGCRFromUIorfallback(ref);

    const rows = ref.no_one_or_multiple_rows;
    const tilt_deg = getTiltModeFromUI(ref);

    // For each panel, construct the DTO for the API Call
    const panelDTOs = panelsArr
        .map((ent, i) => {
            const ll = entityLonLat(ent);
            if (!ll) return null;
            const now = Cesium.JulianDate.now();
            const az = ent.properties?.azimuth_deg?.getValue?.(now) ?? 180;

            console.log("Entity: " + ent)
            return {
                id: `${ref.id}_p${i}`,
                lon: ll.lon,
                lat: ll.lat,
                tilt_deg: tilt_deg,
                azimuth_deg: az,
            };
        })
        .filter(Boolean);

    return {
        output: "annual",
        gcr: gcr,
        no_one_or_multiple_rows: Math.max(rows, 1),
        panels: panelDTOs
    };
}

//-----------------VALUE RETRIEVERS-----------------

// Retrieve Tilt from UI
function getTiltModeFromUI(ref) {
    if (document.getElementById("tilt30Btn")?.classList.contains("active")) return 30;
    if (document.getElementById("tilt75Btn")?.classList.contains("active")) return 75;

    return (ref.y === 0.65) ? 75 : 30;; // default if auto is active or none is set
}

// Get GCR from UI, but if UI input is invalid, make a guess
function getGCRFromUIorfallback(ref) {

    const gcrEl = document.getElementById("polygonGCR");
    const uiVal = gcrEl && gcrEl.value !== "" ? Number(gcrEl.value) : NaN;

    if (!Number.isNaN(uiVal)) return uiVal;

    const panel_length = ref.y;
    const pitch = Math.max(ref.spacing, 0.1);
    return Math.min(panel_length / pitch, 1.0);
}

