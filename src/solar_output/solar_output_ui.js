export function showPolygonPVOutput(ref) {
        // FIONA'S CHANGES
        const panel = document.getElementById("polygonoutputPVPanel");
        if (panel) panel.style.display = "block";

}

export function closePolygonPVOutput() {
    removePolygonPVTradeoff();
    const panel = document.getElementById("polygonoutputPVPanel");
    if (panel) panel.style.display = "none";
}
// Display calculated Output
export function setPVOutput_Annual(text) {
    const el = document.getElementById("pvOutput_Annual");
    if (el) el.textContent = `Annual Energy Output: ${text}`;
}

export function setPVOutput_Winter(text) {
    const el = document.getElementById("pvOutput_Winter");
    if (el) el.textContent = `Winter Energy Output: ${text}`;
}

export function setPVOutput_Summer(text) {
    const el = document.getElementById("pvOutput_Summer");
    if (el) el.textContent = `Summer Energy Output: ${text}`;
}

export function setPolygonPVTradeoff(annual_change_percent, winter_change_percent, summer_change_percent) {
    const el_annual = document.getElementById("annual_pv_delta");
    const el_winter = document.getElementById("winter_pv_delta");
    const el_summer = document.getElementById("summer_pv_delta");

    const annual_percent = Number(annual_change_percent);
    el_annual.hidden = false;
    el_annual.textContent = `${annual_percent >= 0 ? "+" : ""}${annual_percent.toFixed(1)}%`;
    el_annual.className = "delta " + (annual_percent > 0 ? "pos" : annual_percent < 0 ? "neg" : "zero");

    const winter_percent = Number(winter_change_percent);
    el_winter.hidden = false;
    el_winter.textContent = `${winter_percent >= 0 ? "+" : ""}${winter_percent.toFixed(1)}%`;
    el_winter.className = "delta " + (winter_percent > 0 ? "pos" : winter_percent < 0 ? "neg" : "zero");

    const summer_percent = Number(summer_change_percent);
    el_summer.hidden = false;
    el_summer.textContent = `${summer_percent >= 0 ? "+" : ""}${summer_percent.toFixed(1)}%`;
    el_summer.className = "delta " + (summer_percent > 0 ? "pos" : summer_percent < 0 ? "neg" : "zero");
}

export function removePolygonPVTradeoff() {
    const el_annual = document.getElementById("annual_pv_delta");
    const el_winter = document.getElementById("winter_pv_delta");
    const el_summer = document.getElementById("summer_pv_delta");

    el_annual.hidden = true;
    el_winter.hidden = true;
    el_summer.hidden = true;
}