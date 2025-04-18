const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const connectDB = require('./config/db');
const shipmentRoutes = require('./routes/shipmentRoutes');
const bodyParser = require('body-parser'); // Use body-parser explicitly

// Load env vars
dotenv.config();

// Connect to Database
connectDB();

const app = express();

// --- Middleware ---
// Enable CORS - Configure origins specifically in production
app.use(cors());

// Body Parser Middleware
// app.use(express.json({ extended: false })); // Built-in Express parser
app.use(bodyParser.json()); // Use body-parser
app.use(bodyParser.urlencoded({ extended: false }));

// --- API Routes ---
app.get('/', (req, res) => res.send('Cargo Tracker API Running')); // Simple health check
app.use('/api/shipments', shipmentRoutes);

// --- Server Startup ---
const PORT = process.env.PORT || 5001; // Default to 5001 if PORT not in .env

app.listen(PORT, () => console.log(`Server started on port ${PORT}`));