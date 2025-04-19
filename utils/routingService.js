// utils/routingService.js
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config(); // Load .env variables

const OSRM_BASE_URL = process.env.OSRM_URL;

/**
 * Fetches route geometry from OSRM.
 * @param {Array<Object>} waypoints - Array of location objects [{ latitude, longitude }, ...]
 * @returns {Promise<Object|null>} - GeoJSON LineString object or null if failed.
 */
const getRouteGeometryFromOSRM = async (waypoints) => {
    if (!OSRM_BASE_URL) {
        console.error("OSRM_URL not defined in environment variables.");
        return null;
    }
    if (!waypoints || waypoints.length < 2) {
        console.warn("Insufficient waypoints for routing.");
        return null;
    }

    // Format coordinates for OSRM: {longitude},{latitude};{longitude},{latitude};...
    const coordinatesString = waypoints
        .filter(wp => typeof wp.longitude === 'number' && typeof wp.latitude === 'number') // Ensure valid coords
        .map(wp => `${wp.longitude},${wp.latitude}`)
        .join(';');

    if (coordinatesString.split(';').length < 2) {
         console.warn("Not enough valid coordinate pairs for routing after filtering.");
         return null;
    }

    // OSRM Route service URL structure
    // overview=full: requests detailed geometry
    // geometries=geojson: specifies GeoJSON format for the geometry
    const requestUrl = `${OSRM_BASE_URL}/route/v1/driving/${coordinatesString}?overview=full&geometries=geojson`;

    console.log(`Requesting route from OSRM: ${requestUrl}`);

    try {
        const response = await axios.get(requestUrl);

        if (response.data && response.data.routes && response.data.routes.length > 0) {
            const routeGeometry = response.data.routes[0].geometry;
            console.log("Received route geometry from OSRM.");
            // Make sure it looks like a LineString before returning
            if (routeGeometry && routeGeometry.type === 'LineString' && Array.isArray(routeGeometry.coordinates)) {
                 return routeGeometry; // Return the GeoJSON LineString object
            } else {
                console.warn("OSRM response did not contain expected LineString geometry:", routeGeometry);
                return null;
            }
        } else {
            console.warn("OSRM response did not contain any routes:", response.data);
            return null;
        }
    } catch (error) {
        console.error("Error fetching route from OSRM:", error.response?.data || error.message);
        return null; // Return null on error
    }
};

module.exports = { getRouteGeometryFromOSRM };