const Shipment = require('../models/Shipment');
const { getRouteGeometryFromOSRM } = require('../utils/routingService'); // Import the routing helper

// @desc    Get all shipments
// @route   GET /api/shipments
// @access  Public
exports.getAllShipments = async (req, res) => {
  try {
    // Fetch all shipments, sort by creation date descending
    const shipments = await Shipment.find().sort({ createdAt: -1 });
    res.json(shipments);
  } catch (err) {
    console.error("Error fetching all shipments:", err.message);
    res.status(500).send('Server Error');
  }
};

// @desc    Get single shipment by ID (MongoDB _id) or trackingId
// @route   GET /api/shipments/:id
// @access  Public
exports.getShipmentById = async (req, res) => {
  try {
    let shipment = await Shipment.findById(req.params.id);

    // If not found by _id, try finding by trackingId as a fallback
    if (!shipment) {
        shipment = await Shipment.findOne({ trackingId: req.params.id });
    }

    if (!shipment) {
      return res.status(404).json({ msg: 'Shipment not found' });
    }
    res.json(shipment);
  } catch (err) {
    console.error(`Error fetching shipment ${req.params.id}:`, err.message);
    // Handle invalid MongoDB ObjectId format
    if (err.kind === 'ObjectId') {
      // Try searching by trackingId again just in case the format was misleading
       const shipmentByTrackingId = await Shipment.findOne({ trackingId: req.params.id });
        if (shipmentByTrackingId) {
            return res.json(shipmentByTrackingId);
        }
       return res.status(404).json({ msg: 'Shipment not found (invalid ID format)' });
    }
    res.status(500).send('Server Error');
  }
};

// @desc    Create a new shipment and calculate its route
// @route   POST /api/shipments
// @access  Public (or Private if auth added)
exports.createShipment = async (req, res) => {
  // Destructure expected fields from request body
  const {
    containerId,
    origin, // Expecting { name, latitude?, longitude? }
    destination, // Expecting { name, latitude?, longitude? }
    route: intermediateRoutePoints, // Optional array of intermediate waypoints
    status,
    notes
  } = req.body;

  try {
    // --- Basic Validation ---
    if (!containerId || !origin?.name || !destination?.name) {
        return res.status(400).json({ msg: 'Missing required fields: containerId, origin name, destination name' });
    }
    // Check for necessary coordinates for routing (can be made optional later if needed)
    const hasOriginCoords = typeof origin?.latitude === 'number' && typeof origin?.longitude === 'number';
    const hasDestCoords = typeof destination?.latitude === 'number' && typeof destination?.longitude === 'number';

    if (!hasOriginCoords || !hasDestCoords) {
         // Decide if this is a hard error or just a warning preventing detailed route calculation
         console.warn(`Shipment creation for ${containerId} is missing coordinates for origin or destination. Detailed route cannot be calculated.`);
         // Allow creation but without detailed route? Or return error?
         // For now, allow creation, detailed route will be null.
        // return res.status(400).json({ msg: 'Origin and Destination must have valid latitude and longitude for route calculation.' });
    }
    // --- End Validation ---


    // --- Prepare Waypoints for Routing Service ---
    // Only include points that have valid coordinates
    const waypointsForRouting = [
        origin,
        ...(intermediateRoutePoints || []).filter(p => p && typeof p.latitude === 'number' && typeof p.longitude === 'number'), // Filter valid intermediates
        destination
    ].filter(p => p && typeof p.latitude === 'number' && typeof p.longitude === 'number'); // Ensure all points used for routing are valid


    // --- Call Routing Service (OSRM) ---
    let detailedGeometry = null;
    if (waypointsForRouting.length >= 2) {
        console.log(`Attempting to get detailed route for ${waypointsForRouting.length} waypoints.`);
        detailedGeometry = await getRouteGeometryFromOSRM(waypointsForRouting);
        if (!detailedGeometry) {
            console.warn(`Could not retrieve detailed route geometry for shipment ${containerId}. Proceeding without it.`);
        } else {
            console.log(`Successfully retrieved detailed route geometry for shipment ${containerId}.`);
        }
    } else {
        console.warn(`Not enough valid waypoints with coordinates (${waypointsForRouting.length}) to calculate route for shipment ${containerId}.`);
    }
    // --- End Routing Service Call ---


    // --- Create New Shipment Instance ---
    const newShipment = new Shipment({
      containerId,
      origin,
      destination,
      // Pass intermediate points to pre-save hook for inclusion in basic 'route' array
      route: intermediateRoutePoints || [],
      status,
      notes,
      // Add the fetched detailed geometry (will be null if routing failed)
      detailedRouteGeometry: detailedGeometry,
      // trackingId, currentLocation, estimatedETA, and the basic 'route' array
      // will be handled/refined by the pre-save hook in the model
    });

    // --- Save the Shipment (pre-save hook runs here) ---
    const shipment = await newShipment.save();

    console.log(`Shipment created successfully: ${shipment.trackingId}`);
    // Return the newly created shipment document
    res.status(201).json(shipment);

  } catch (err) {
    console.error("Error creating shipment:", err); // Log the full error
    if (err.name === 'ValidationError') {
         return res.status(400).json({ msg: 'Validation Error', errors: err.errors });
    }
    // Handle unique index violation (e.g., duplicate trackingId if generation wasn't unique)
    if (err.code === 11000) {
         // Determine which field caused the error if possible (might need parsing err.message)
         return res.status(400).json({ msg: 'Error: Duplicate value detected for a unique field (e.g., trackingId).' });
    }
    // General server error
    res.status(500).send('Server Error');
  }
};


// @desc    Update shipment's current location
// @route   POST /api/shipments/:id/update-location
// @access  Public (or Private)
exports.updateShipmentLocation = async (req, res) => {
  // Expecting new location details in the body
  const { locationName, latitude, longitude } = req.body;

  if (!locationName) {
     return res.status(400).json({ msg: 'Location name is required in the request body' });
  }

  try {
    let shipment = await Shipment.findById(req.params.id);
     if (!shipment) {
        // Fallback check by trackingId
        shipment = await Shipment.findOne({ trackingId: req.params.id });
    }

    if (!shipment) {
      return res.status(404).json({ msg: 'Shipment not found' });
    }

    // Prevent updates if already delivered
    if (shipment.status === 'Delivered') {
         return res.status(400).json({ msg: 'Cannot update location for delivered shipments.' });
    }

    console.log(`Updating location for shipment ${shipment.trackingId} to ${locationName}`);

    // Update current location details
    shipment.currentLocation = {
        name: locationName,
        latitude: typeof latitude === 'number' ? latitude : undefined, // Include coords if valid numbers
        longitude: typeof longitude === 'number' ? longitude : undefined,
        timestamp: new Date()
    };

    // Update status logic
    if (shipment.status === 'Pending') {
        shipment.status = 'In Transit';
        console.log(`Shipment status changed to In Transit.`);
    }
     // If the new location matches the destination name, mark as Delivered
    if (shipment.destination?.name === locationName) {
        shipment.status = 'Delivered';
        shipment.actualDeliveryDate = new Date();
        // shipment.estimatedETA = null; // ETA calculation in pre-save will handle this
        console.log(`Shipment status changed to Delivered.`);
    } else if (shipment.status !== 'Delayed' && shipment.status !== 'Cancelled') {
        // If not delivered ensure it is 'In Transit' unless manually set otherwise
         shipment.status = 'In Transit';
    }

    // The pre-save hook will automatically recalculate ETA when we save
    await shipment.save();

    res.json(shipment); // Return the updated shipment

  } catch (err) {
    console.error(`Error updating location for shipment ${req.params.id}:`, err.message);
     if (err.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Shipment not found (invalid ID format)' });
    }
     if (err.name === 'ValidationError') {
         return res.status(400).json({ msg: 'Validation Error during update', errors: err.errors });
    }
    res.status(500).send('Server Error');
  }
};


// @desc    Get calculated ETA for a shipment
// @route   GET /api/shipments/:id/eta
// @access  Public
// NOTE: This endpoint might become less critical if ETA is always updated on save
// via the pre-save hook. However, it can be useful for forcing a recalculation check.
exports.getShipmentETA = async (req, res) => {
    try {
        let shipment = await Shipment.findById(req.params.id);
        if (!shipment) {
            // Fallback check by trackingId
            shipment = await Shipment.findOne({ trackingId: req.params.id });
        }

        if (!shipment) {
           return res.status(404).json({ msg: 'Shipment not found' });
        }

        // We can either return the stored ETA or force a recalculation here
        let eta;
        if (typeof shipment.calculateSimpleETA === 'function') {
             console.log(`Recalculating ETA on demand for ${shipment.trackingId}`);
             eta = shipment.calculateSimpleETA();
             // Optionally, save this recalculated ETA back?
             // shipment.estimatedETA = eta;
             // await shipment.save(); // Be cautious about triggering saves in GET requests
        } else {
            console.warn(`calculateSimpleETA method not found on shipment ${shipment.trackingId}. Returning stored ETA.`);
            eta = shipment.estimatedETA; // Fallback to stored value
        }


        res.json({
            shipmentId: shipment._id,
            trackingId: shipment.trackingId,
            estimatedETA: eta // Return the calculated or stored ETA
        });

    } catch (err) {
        console.error(`Error getting ETA for shipment ${req.params.id}:`, err.message);
        if (err.kind === 'ObjectId') {
            return res.status(404).json({ msg: 'Shipment not found (invalid ID format)' });
        }
        res.status(500).send('Server Error');
    }
};