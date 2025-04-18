const Shipment = require('../models/Shipment');

// @desc    Get all shipments
// @route   GET /api/shipments
// @access  Public
exports.getAllShipments = async (req, res) => {
  try {
    const shipments = await Shipment.find().sort({ createdAt: -1 }); // Sort by newest
    res.json(shipments);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};

// @desc    Get single shipment by ID (MongoDB _id) or trackingId
// @route   GET /api/shipments/:id
// @access  Public
exports.getShipmentById = async (req, res) => {
  try {
    let shipment = await Shipment.findById(req.params.id);

    // If not found by _id, try finding by trackingId
    if (!shipment) {
        shipment = await Shipment.findOne({ trackingId: req.params.id });
    }

    if (!shipment) {
      return res.status(404).json({ msg: 'Shipment not found' });
    }
    res.json(shipment);
  } catch (err) {
    console.error(err.message);
    if (err.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Shipment not found (invalid ID format)' });
    }
    res.status(500).send('Server Error');
  }
};

// @desc    Create a new shipment
// @route   POST /api/shipments
// @access  Public (or Private if auth added)
exports.createShipment = async (req, res) => {
  const { containerId, origin, destination, route, status, notes } = req.body;

  try {
    // Basic validation
    if (!containerId || !origin || !destination || !origin.name || !destination.name) {
        return res.status(400).json({ msg: 'Missing required fields: containerId, origin.name, destination.name' });
    }

    const newShipment = new Shipment({
      containerId,
      origin, // Expecting { name, latitude?, longitude? }
      destination, // Expecting { name, latitude?, longitude? }
      route: route || [], // Expecting [{ name, latitude?, longitude? }, ...]
      status, // Optional, defaults to 'Pending'
      notes, // Optional
      // trackingId, currentLocation, estimatedETA will be set by model hooks/defaults
    });

    const shipment = await newShipment.save();
    res.status(201).json(shipment);
  } catch (err) {
    console.error(err.message);
    if (err.name === 'ValidationError') {
         return res.status(400).json({ msg: 'Validation Error', errors: err.errors });
    }
    res.status(500).send('Server Error');
  }
};

// @desc    Update shipment's current location
// @route   POST /api/shipments/:id/update-location
// @access  Public (or Private)
exports.updateShipmentLocation = async (req, res) => {
  const { locationName, latitude, longitude } = req.body; // Expect new location details

  if (!locationName) {
     return res.status(400).json({ msg: 'Location name is required in the request body' });
  }

  try {
    let shipment = await Shipment.findById(req.params.id);
     if (!shipment) {
        shipment = await Shipment.findOne({ trackingId: req.params.id });
    }

    if (!shipment) {
      return res.status(404).json({ msg: 'Shipment not found' });
    }

    // Update current location
    shipment.currentLocation = {
        name: locationName,
        latitude: latitude, // Optional
        longitude: longitude, // Optional
        timestamp: new Date()
    };

    // Optionally update status (e.g., if it wasn't 'In Transit' before)
    if (shipment.status === 'Pending') {
        shipment.status = 'In Transit';
    }
     // If the new location matches the destination name, mark as Delivered
    if (shipment.destination && shipment.destination.name === locationName) {
        shipment.status = 'Delivered';
        shipment.actualDeliveryDate = new Date();
        shipment.estimatedETA = null; // Clear ETA upon delivery
    } else {
         // Recalculate ETA based on the new location
        shipment.estimatedETA = shipment.calculateSimpleETA();
    }


    await shipment.save();
    res.json(shipment);

  } catch (err) {
    console.error(err.message);
     if (err.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Shipment not found (invalid ID format)' });
    }
    res.status(500).send('Server Error');
  }
};

// @desc    Get calculated ETA for a shipment
// @route   GET /api/shipments/:id/eta
// @access  Public
exports.getShipmentETA = async (req, res) => {
    try {
        let shipment = await Shipment.findById(req.params.id);
        if (!shipment) {
            shipment = await Shipment.findOne({ trackingId: req.params.id });
        }

        if (!shipment) {
        return res.status(404).json({ msg: 'Shipment not found' });
        }

        // Recalculate ETA (or use stored one if calculation logic is complex/external)
        const eta = shipment.calculateSimpleETA();
        // Optionally save the potentially recalculated ETA back to the DB
        // shipment.estimatedETA = eta;
        // await shipment.save();

        res.json({
            shipmentId: shipment._id,
            trackingId: shipment.trackingId,
            estimatedETA: eta
        });

    } catch (err) {
        console.error(err.message);
        if (err.kind === 'ObjectId') {
            return res.status(404).json({ msg: 'Shipment not found (invalid ID format)' });
        }
        res.status(500).send('Server Error');
    }
};