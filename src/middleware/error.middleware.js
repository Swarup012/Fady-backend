const config = require('../config/env.config');

const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Supabase specific errors
  if (err.code === 'PGRST116') {
    return res.status(404).json({
      success: false,
      message: 'Resource not found'
    });
  }

  if (err.code === '23505') {
    return res.status(409).json({
      success: false,
      message: 'Resource already exists'
    });
  }

  // Default error
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  res.status(statusCode).json({
    success: false,
    message,
    ...(config.nodeEnv === 'development' && { stack: err.stack })
  });
};

// Handle 404 routes
const notFound = (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
};

module.exports = { errorHandler, notFound };
