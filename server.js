require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { errorHandler } = require('./src/middleware/errorHandler');

// Route imports
const authRoutes = require('./src/routes/auth.routes');
const userRoutes = require('./src/routes/user.routes');
const itemRoutes = require('./src/routes/item.routes');
const claimRoutes = require('./src/routes/claim.routes');
const supplyRoutes = require('./src/routes/supply.routes');
const roomRoutes = require('./src/routes/room.routes');
const bookingRoutes = require('./src/routes/booking.routes');
const notificationRoutes = require('./src/routes/notification.routes');
const statsRoutes = require('./src/routes/stats.routes');

const app = express();
const PORT = process.env.BACKEND_PORT || 5000;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'H.I.V.E. Campus Utility API is operating smoothly',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/claims', claimRoutes);
app.use('/api/supplies', supplyRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/stats', statsRoutes);

// 404 Route handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `API endpoint '${req.method} ${req.originalUrl}' not found`,
    error: 'ENDPOINT_NOT_FOUND'
  });
});

// Central Error Handler
app.use(errorHandler);

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`=========================================`);
    console.log(`🚀 H.I.V.E. Campus Backend Server Running`);
    console.log(`📡 URL: http://0.0.0.0:${PORT}`);
    console.log(`=========================================`);
  });
}

module.exports = app;
