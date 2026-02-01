//HELPER FUNCTION: 2D point-in-polygon (ray-cast)
import * as Cesium from "cesium";

function pointInPolygon(pt, vs) {
    const [x, y] = pt;
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const [xi, yi] = vs[i], [xj, yj] = vs[j];
        const intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// SAMPLE RANDOM POINTS IN POLYGON (TO BE REPLACED BY SEARCH ALGORITHM SAMPLING POINTS BASED ON ENERGY PRODUCTION)
function computeLonLatCentroid(lonLatArray) {
    let sumLon = 0;
    let sumLat = 0;
    lonLatArray.forEach(([lon, lat]) => {
        sumLon += lon;
        sumLat += lat;
    });
    return [sumLon / lonLatArray.length, sumLat / lonLatArray.length];
}


export function generateHexagonalTurbinePositions(cartesians, Distance) {
    const minDistance = Distance;

    // Convert polygon cartesians to lon/lat
    const poly = cartesians.map(pt => {
        const c = Cesium.Cartographic.fromCartesian(pt);
        return [Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude)];
    });

    // Calculate bounding box
    let [minLon, maxLon, minLat, maxLat] = [180, -180, 90, -90];
    poly.forEach(([lon, lat]) => {
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
    });

    // Approximate meters per degree at mid-latitude
    const avgLatRad = Cesium.Math.toRadians((minLat + maxLat) / 2);
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLon = 111320 * Math.cos(avgLatRad);

    // Convert spacing from meters to degrees
    const latSpacing = (minDistance * Math.sqrt(3) / 2) / metersPerDegreeLat;
    const lonSpacing = minDistance / metersPerDegreeLon;

    const points = [];
    let rowIndex = 0;
    for (let lat = minLat; lat <= maxLat; lat += latSpacing) {
        const lonOffset = (rowIndex % 2 === 0) ? 0 : lonSpacing / 2;
        for (let lon = minLon + lonOffset; lon <= maxLon; lon += lonSpacing) {
            if (pointInPolygon([lon, lat], poly)) {
                points.push([lon, lat]);
            }
        }
        rowIndex++;
    }

    //if no valid points or only one place them in the center of the polygon
    if (points.length === 0) {
        const centroid = computeLonLatCentroid(poly);
        if (pointInPolygon(centroid, poly)) {
            points.push(centroid);
        }
    }

    return points;
}