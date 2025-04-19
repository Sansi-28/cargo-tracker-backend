const mongoose = require('mongoose');

// --- Helper function for generating a simple tracking ID ---
// In a real app, you might use a more robust unique ID generator like UUID
const generateTrackingId = () => {
    const prefix = "CARGO";
    const randomNum = Math.floor(100000 + Math.random() * 900000); // 6 random digits
    return `${prefix}${randomNum}`;
};

// --- Embedded Schema for Location Data ---
const LocationSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Location name is required'],
        trim: true
    },
    // Add coordinates for map integration (optional but recommended)
    latitude: {
        type: Number
    },
    longitude: {
        type: Number
    },
    timestamp: { // Optional: timestamp when this location was reached/passed/relevant
        type: Date
    }
}, { _id: false }); // Don't create separate _id for embedded locations


// --- Main Shipment Schema ---
const ShipmentSchema = new mongoose.Schema({
    trackingId: {
        type: String,
        unique: true,
        required: true,
        default: generateTrackingId // Generate ID on creation
    },
    containerId: {
        type: String,
        required: [true, 'Container ID is required'],
        trim: true,
    },
    origin: {
        type: LocationSchema,
        required: [true, 'Origin location is required'],
    },
    destination: {
        type: LocationSchema,
        required: [true, 'Destination location is required'],
    },
    // Route: Array of locations including origin, waypoints, and destination.
    // This will be primarily managed by the pre-save hook.
    route: [LocationSchema],
    currentLocation: {
        type: LocationSchema, // Represents the last known location
    },
    estimatedETA: {
        type: Date,
    },
    status: {
        type: String,
        enum: ['Pending', 'In Transit', 'Delayed', 'Delivered', 'Cancelled'],
        default: 'Pending',
    },

    detailedRouteGeometry: {
        // Store GeoJSON LineString object
        type: {
           type: String,
           enum: ['LineString'],
           // required: true // Make optional, fallback if routing fails
        },
        coordinates: {
           type: [[Number]], // Array of [longitude, latitude] pairs
           // required: true
        }
    },

    // Optional fields
    actualDeliveryDate: {
        type: Date,
    },
    notes: {
        type: String,
        trim: true
    }
}, {
    timestamps: true // Adds createdAt and updatedAt fields automatically
});


// --- Instance Method for Simple ETA Calculation ---
// NOTE: This is a placeholder. Real ETA requires complex logic.
ShipmentSchema.methods.calculateSimpleETA = function() {
    // 'this' refers to the document instance

    console.log(`Calculating ETA for Shipment ${this.trackingId}, Status: ${this.status}`);

    // Don't calculate if delivered or route is invalid/too short
    if (this.status === 'Delivered' || !Array.isArray(this.route) || this.route.length < 2) {
        console.log(`Skipping ETA calculation (Status: ${this.status}, Route points: ${this.route?.length})`);
        // If delivered, ETA should ideally be null or the actual delivery date? Return null for now.
        return this.status === 'Delivered' ? null : this.estimatedETA;
    }

    const now = new Date();
    // Example: Assume each leg of the journey takes ~2 days
    const averageTimePerLegMs = 2 * 24 * 60 * 60 * 1000;

    let remainingLegs = 0;
    let currentFound = false;
    const currentLocName = this.currentLocation?.name;

    // Find current location index in the planned route
    if (currentLocName) {
        for(let i = 0; i < this.route.length; i++) {
            // Check if route item and its name exist before comparing
            if (this.route[i]?.name === currentLocName) {
                currentFound = true;
                // Legs remaining = total points - 1 (destination index) - current index
                remainingLegs = this.route.length - 1 - i;
                console.log(`Current location '${currentLocName}' found at route index ${i}. Remaining legs: ${remainingLegs}`);
                break;
            }
        }
        // If current location isn't exactly on a route point, estimate based on full route?
        // Or maybe based on the *last known* point on the route? For simplicity, let's assume full route if not found.
        if (!currentFound) {
            remainingLegs = this.route.length - 1; // Default to full route if current unknown on route
            console.log(`Current location '${currentLocName}' not found on route. Assuming full route legs: ${remainingLegs}`);
        }
    } else {
         // Assume start from origin if no current location provided yet
         remainingLegs = this.route.length - 1; // Start from origin
         console.log(`No current location name provided. Assuming start from origin. Legs: ${remainingLegs}`);
    }

    // Ensure remaining legs isn't negative
    remainingLegs = Math.max(0, remainingLegs);

    if (remainingLegs === 0) {
        // If at destination or beyond, ETA could be now or already passed
        console.log("At or past destination according to route. ETA is now.");
        // If status isn't Delivered yet, maybe it should be? Or set ETA to now.
        return now;
    }

    // Calculate final ETA
    const estimatedDurationMs = remainingLegs * averageTimePerLegMs;
    const calculatedETA = new Date(now.getTime() + estimatedDurationMs);
    console.log("Calculated ETA:", calculatedETA.toISOString());
    return calculatedETA;
};


// --- Middleware: Runs before saving a document (`.save()`) ---
ShipmentSchema.pre('save', function(next) { // MUST use 'function' to access 'this' (the document)
    console.log(`Running pre-save hook for Shipment ${this.trackingId || '(new)'}...`);

    let originObj, destObj;

    // Ensure origin/destination are plain objects for manipulation
    if (this.origin) {
        originObj = this.origin.toObject ? this.origin.toObject() : { ...this.origin };
    }
    if (this.destination) {
        destObj = this.destination.toObject ? this.destination.toObject() : { ...this.destination };
    }

    // --- Set Initial State for New Documents ---
    if (this.isNew) {
        // Set initial currentLocation to origin if origin exists
        if (originObj && !this.currentLocation) {
             this.currentLocation = { ...originObj, timestamp: new Date() };
             console.log("Set initial currentLocation to origin.");
        }
        // Add timestamp to origin location in the object used for route building
         if (originObj) {
            originObj.timestamp = this.currentLocation?.timestamp || new Date();
        }
    }

    // --- Rebuild the 'route' array from origin, intermediates (if any), and destination ---
    // Only rebuild if key fields change, to avoid unnecessary modifications
     if (this.isNew || this.isModified('origin') || this.isModified('destination') || this.isModified('route')) {
        console.log("Rebuilding route array...");
        let finalRoute = [];

        // 1. Add Origin
        if (originObj) {
            finalRoute.push({ ...originObj }); // Add a copy
        }

        // 2. Add Intermediate Points (from original 'route' field if provided)
        // Use get() to access potentially unsaved 'route' if modified but not saved yet
        const intermediatePointsInput = this.get('route', null, { getters: false }) || [];
        const intermediatePoints = intermediatePointsInput
            .map(loc => (loc.toObject ? loc.toObject() : { ...loc })) // Convert to plain objects
            .filter(loc => // Filter out any that match origin/destination names
                loc && loc.name && // Ensure loc and name exist
                (!originObj || loc.name !== originObj.name) &&
                (!destObj || loc.name !== destObj.name)
            );

        if(intermediatePoints.length > 0) {
            console.log(`Adding ${intermediatePoints.length} intermediate points.`);
            finalRoute = finalRoute.concat(intermediatePoints);
        }


        // 3. Add Destination
        if (destObj) {
            // Avoid adding destination if it's the same name as the last point in the route already
            const lastPoint = finalRoute[finalRoute.length - 1];
             if (!lastPoint || lastPoint.name !== destObj.name) {
                 finalRoute.push({ ...destObj }); // Add a copy
             } else {
                  console.log("Destination name matches last route point, not adding duplicate.");
             }
        }

        // 4. Remove Duplicates based on name (simple check)
        const uniqueRoute = [];
        const names = new Set();
        for (const loc of finalRoute) {
             if (loc && loc.name && !names.has(loc.name)) {
                uniqueRoute.push(loc); // Add unique named location
                names.add(loc.name);
            } else if (loc && loc.name && names.has(loc.name)) {
                 console.log(`Skipping duplicate name in route: ${loc.name}`);
            } else {
                 console.warn("Skipping invalid/unnamed location during route uniqueness check:", loc);
            }
        }

        console.log(`Final unique route points: ${uniqueRoute.length}`);
        this.route = uniqueRoute; // Assign the constructed, ordered, unique route
     } else {
          console.log("Route calculation skipped (origin/destination/route not modified).");
     }


    // --- Update ETA if relevant fields changed ---
    // Recalculate if new, route changed, destination changed, or current location changed
    if (this.isNew || this.isModified('route') || this.isModified('destination') || this.isModified('currentLocation')) {
        console.log("Recalculating ETA due to changes...");
        try {
            // Ensure 'calculateSimpleETA' exists before calling
            if (typeof this.calculateSimpleETA === 'function') {
                 this.estimatedETA = this.calculateSimpleETA(); // Call the instance method
            } else {
                 console.error("ERROR: this.calculateSimpleETA is not a function on the document!");
                 // Handle this error state appropriately - maybe don't change ETA?
            }
        } catch (e) {
            console.error("Error occurred during ETA calculation:", e);
            // Decide how to handle: pass error? set ETA to null? Log and continue?
            // For now, just log it and continue saving without updated ETA
        }
    }

    console.log("Pre-save hook finished.");
    next(); // Proceed with the save operation
});


// --- Export the Mongoose Model ---
// Ensure this line is AFTER all schema, method, and middleware definitions
module.exports = mongoose.model('Shipment', ShipmentSchema);