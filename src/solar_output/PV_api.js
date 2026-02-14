import {entityLonLat} from "./geometry_helpers.js";
import * as Cesium from "cesium";
import {setPVOutput_Annual, setPVOutput_Winter, setPVOutput_Summer, setPolygonPVTradeoff} from "./solar_output_ui.js";
import {setPolygonWindTradeoff} from "../wind_output/output_ui.js";

const PV_API_BASE = "http://localhost:8000";

// SET OUTPUT
export async function computeAndUpdatePVOutput(ref) {
    if (!ref) {
        setPVOutput_Annual("—");
        setPVOutput_Winter("—");
        setPVOutput_Summer("—");
        return;
    }

    try {
        setPVOutput_Annual("Computing…");
        setPVOutput_Winter("");
        setPVOutput_Summer("");

        if (ref.no_one_or_multiple_rows == 0) {
            setPVOutput_Annual("—");
            setPVOutput_Winter("—");
            setPVOutput_Summer("—");
            return;
        }

        const payload = await buildAnnualPayloadFromPVPolygonRef(ref);

        const result = await callComputeAnnualPV(payload);

        const annual_kwh = result?.annual_kWh ?? result?.annual_kWh; // keep simple
        const winter_kwh = result?.winter_kWh ?? result?.annual_kWh;
        const summer_kwh = annual_kwh - winter_kwh;

        if (annual_kwh == null) {
            setPVOutput_Annual("API ok, missing annual_kWh");
            return;
        }

        let rounded_annual = Math.round(annual_kwh / 100) * 100;
        let rounded_winter = Math.round(winter_kwh / 100) * 100;
        let rounded_summer = rounded_annual - rounded_winter;

        console.log(`Summer Value: ${rounded_summer}.`)

        let unit_string = "kWh";

        if (rounded_annual >= 1000) {
            rounded_annual = Math.round(rounded_annual / 1000);
            rounded_winter = Math.round(rounded_winter / 1000);
            rounded_summer = rounded_annual - rounded_winter
            unit_string = "MWh"
        }

        setPVOutput_Annual(`${rounded_annual} ${unit_string}/year`);
        setPVOutput_Winter(`${rounded_winter} ${unit_string}/year`);
        setPVOutput_Summer(`${rounded_summer} ${unit_string}/year`);


        if (ref.annual_first != null) {

            const annual_change_percent = Math.round((annual_kwh / ref.annual_first - 1) * 100);
            const winter_change_percent = Math.round((winter_kwh / ref.winter_first - 1) * 100);
            const summer_change_percent = Math.round((summer_kwh / ref.summer_first - 1) * 100);

            setPolygonPVTradeoff(annual_change_percent, winter_change_percent, summer_change_percent);

        } else {

            ref.annual_first = annual_kwh;
            ref.winter_first = winter_kwh;
            ref.summer_first = summer_kwh;

        }

    } catch (e) {
        console.error(e);
        setPVOutput_Annual(`ERROR`);
        setPVOutput_Winter("");
        setPVOutput_Summer("");
    }
}



// harmonize UI and polygon spacing
export function setSpacingUI(spacing) {
    const el = document.getElementById("polygonPanelSpacing");
    if (el) el.value = spacing;
}

// Make API Call
async function callComputeAnnualPV(payload) {
    const res = await fetch(`${PV_API_BASE}/compute-PV`, {
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

