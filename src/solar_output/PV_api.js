import './geometry_helpers.js'
import {cartesianCentroidLonLat, entityLonLat, estimateRowsFromPanels} from "./geometry_helpers.js";
import * as Cesium from "cesium";

const PV_API_BASE = "http://localhost:8000";

// SET OUTPUT
export async function computeAndUpdateOutput(ref) {
    if (!ref) {
        setPVOutput("—");
        return;
    }

    try {
        setPVOutput("computing…");


        const gcr = getGCRFromUIorfallback(ref);
        const payload = await buildAnnualPayloadFromPolygonRef(ref, gcr);

        const result = await callComputeAnnual(payload);

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
    const el = document.getElementById("pvOutput");
    if (el) el.textContent = `output: ${text}`;
}

// harmonize UI and polygon spacing
export function setSpacingUI(spacing) {
    const el = document.getElementById("polygonPanelSpacing");
    if (el) el.value = spacing;
}

// Make API Call
async function callComputeAnnual(payload) {
    const res = await fetch(`${PV_API_BASE}/compute-annual`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await res.text());
    return await res.json(); // expects { annual_kWh: number }
}


// construct API input from the polygon
async function buildAnnualPayloadFromPolygonRef(ref, gcr) {

    if (!ref) throw new Error("No polygon ref");
    const panelsArr = Array.isArray(ref.panels) ? ref.panels : Array.from(ref.panels ?? []);
    if (panelsArr.length === 0) throw new Error("Polygon has no panels");

    // Get center of polygon
    const center = cartesianCentroidLonLat(ref.positions);

    // Anchor for row estimation (cartesian)
    const anchorCartesian = Cesium.Cartesian3.fromDegrees(center.lon, center.lat);
    const rows = estimateRowsFromPanels(ref.panels, anchorCartesian, 1.5);


    const azimuth_deg = await getAzimuthDegForPolygon(ref);
    const tilt_deg = getTiltModeFromUI(ref);

    // If south: constant azimuth
    // If downslope: you’ll later replace this with per-panel downslope azimuth
    const constantAz = (ref.orientation === "south") ? 180 : 180;

    // For each panel, construc the DTO for the API Call
    const panelDTOs = panelsArr
        .map((ent, i) => {
            const ll = entityLonLat(ent);
            if (!ll) return null;
            return {
                id: `${ref.id}_p${i}`,
                lon: ll.lon,
                lat: ll.lat,
                tilt_deg: tilt_deg,
                azimuth_deg: constantAz, // TODO GET AZIMUTH
            };
        })
        .filter(Boolean);

    return {
        output: "annual",
        gcr: gcr,
        rows: Math.max(rows, 1),
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

// Retrieve Azimuth from Polygon
async function getAzimuthDegForPolygon(ref) {
    // TODO

    // If your Python expects azimuth for each panel/system:
    // - south-facing -> 180
    // - downslope -> you can start with 180 as placeholder, or compute properly later
    return ref.orientation === "south" ? 180 : 180;
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

