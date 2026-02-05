export function showPolygonPVOutput(ref) {
        // FIONA'S CHANGES
        const panel = document.getElementById("polygonoutputPVPanel");
        if (panel) panel.style.display = "block";

}

export function closePolygonPVOutput() {
    const panel = document.getElementById("polygonoutputPVPanel");
    if (panel) panel.style.display = "none";
}