const express = require('express');
const router = express.Router();
const {
  getAllShipments,
  getShipmentById,
  createShipment,
  updateShipmentLocation,
  getShipmentETA
} = require('../controllers/shipmentController');

// GET all shipments
router.get('/', getAllShipments);

// POST create a new shipment
router.post('/', createShipment);

// GET a single shipment by ID or Tracking ID
router.get('/:id', getShipmentById);

// POST update shipment location
router.post('/:id/update-location', updateShipmentLocation);

// GET shipment ETA
router.get('/:id/eta', getShipmentETA);

module.exports = router;