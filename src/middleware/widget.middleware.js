const widgetService = require('../services/widget.service');

/**
 * Widget Origin Validation Middleware
 * Validates that requests come from allowed domains
 */
const validateWidgetOrigin = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    // Same-origin requests (e.g. widget.html fetching its own API) don't send Origin.
    // Fall back to Referer header, or allow if served from same host.
    let origin = req.headers.origin;
    if (!origin) {
      const referer = req.headers.referer;
      if (referer) {
        try {
          const refUrl = new URL(referer);
          origin = refUrl.origin;
        } catch (_) {}
      }
    }

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

    const widgetId = req.query.widgetId;
    if (widgetId && validation.widget.id !== widgetId) {
      return res.status(403).json({
        success: false,
        error: 'Widget ID does not match API key',
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
