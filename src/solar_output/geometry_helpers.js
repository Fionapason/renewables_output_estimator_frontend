import * as Cesium from "cesium";

export function cartesianCentroidLonLat(cartesianPositions) {
    // TODO CHECK WHAT DOES THIS CODE DO?
    const avgX = cartesianPositions.reduce((s, p) => s + p.x, 0) / cartesianPositions.length;
    const avgY = cartesianPositions.reduce((s, p) => s + p.y, 0) / cartesianPositions.length;
    const avgZ = cartesianPositions.reduce((s, p) => s + p.z, 0) / cartesianPositions.length;

    const c = new Cesium.Cartesian3(avgX, avgY, avgZ);
    const carto = Cesium.Cartographic.fromCartesian(c);

    return {
        lon: Cesium.Math.toDegrees(carto.longitude),
        lat: Cesium.Math.toDegrees(carto.latitude),
    };
}

export function entityLonLat(ent) {
    const pos = ent.position?.getValue?.(Cesium.JulianDate.now());
    if (!pos) return null;
    const carto = Cesium.Cartographic.fromCartesian(pos);
    return {
        lon: Cesium.Math.toDegrees(carto.longitude),
        lat: Cesium.Math.toDegrees(carto.latitude),
    };
}


// Count "rows" from panel entity positions by clustering their local-North coordinate.
// This is an estimate; good enough to start.
// TODO CHECK IF THIS MAKES ANY SENSE
export function estimateRowsFromPanels(panelEntities, anchorCartesian, toleranceMeters = 1.5) {
    if (!panelEntities || panelEntities.length === 0) return 0;

    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(anchorCartesian);

    // Extract north coordinate (meters) for each panel
    const panelsArr = Array.from(panelEntities);

// Extract north coordinate (meters) for each panel
    const norths = panelsArr
        .map(ent => ent.position?.getValue?.(Cesium.JulianDate.now()))
        .filter(Boolean)
        .map(world => {
            const local = Cesium.Matrix4.multiplyByPoint(
                Cesium.Matrix4.inverse(enu, new Cesium.Matrix4()),
                world,
                new Cesium.Cartesian3()
            );
            return local.y;
        })
        .sort((a, b) => a - b);


    if (norths.length === 0) return 0;

    // 1D clustering
    let rows = 1;
    let current = norths[0];
    for (let i = 1; i < norths.length; i++) {
        // assume if northern coordinate between panels
        if (Math.abs(norths[i] - current) > toleranceMeters) {
            rows++;
            current = norths[i];
        }
    }
    return rows;
}