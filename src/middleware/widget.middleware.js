const widgetService = require('../services/widget.service');

/**
 * Widget Origin Validation Middleware
 * Validates that requests come from allowed domains
 */
const validateWidgetOrigin = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    const origin = req.headers.origin;

    if (!origin) {
      return res.status(400).json({
        success: false,
        error: 'Origin header required',
      });
    }

    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error: 'API key required',
      });
    }

    const validation = await widgetService.validateWidgetOrigin(apiKey, origin);

    if (!validation.valid) {
      return res.status(403).json({
        success: false,
        error: validation.error,
      });
    }

    // Attach widget to request
    req.widget = validation.widget;
    next();
  } catch (error) {
    console.error('❌ Widget origin validation error:', error);
    return res.status(500).json({
      success: false,
      error: 'Origin validation failed',
    });
  }
};

module.exports = { validateWidgetOrigin };
