export function showPolygonPVOutput(ref) {
        // FIONA'S CHANGES
        const panel = document.getElementById("polygonoutputPVPanel");
        if (panel) panel.style.display = "block";

}

export function closePolygonPVOutput() {
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
    if (el) el.textContent = `Annual Energy Output: ${text}`;
}

export function setPVOutput_Summer(text) {
    const el = document.getElementById("pvOutput_Summer");
    if (el) el.textContent = `Annual Energy Output: ${text}`;
}