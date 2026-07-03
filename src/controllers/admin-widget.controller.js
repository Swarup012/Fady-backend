const widgetService = require('../services/widget.service');
const { supabaseAdmin } = require('../config/supabase.config');
const ResponseUtil = require('../utils/response.util');

/**
 * Admin Widget Controller
 * Handles widget management for organization owners/admins
 */
class AdminWidgetController {
  /**
   * Get all widgets for the current organization
   */
  async getWidgets(req, res) {
    try {
      const organizationId = req.organization?.id;

      if (!organizationId) {
        return ResponseUtil.error(res, 'Organization context required', 400);
      }

      const widgets = await widgetService.getOrganizationWidgets(organizationId);

      return ResponseUtil.success(res, 'Widgets retrieved successfully', {
        widgets: widgets.map((w) => widgetService.sanitizeWidget(w)),
        total: widgets.length,
      });
    } catch (error) {
      console.error('❌ Get widgets error:', error);
      return ResponseUtil.error(res, error.message, 500);
    }
  }

  /**
   * Create a new widget (returns api_secret once).
   */
  async createWidget(req, res) {
    try {
      const organizationId = req.organization?.id;

      if (!organizationId) {
        return ResponseUtil.error(res, 'Organization context required', 400);
      }

      const { name, default_board_id, allowed_domains, branding, settings } = req.body;

      if (!default_board_id) {
        return ResponseUtil.error(res, 'Default board is required', 400);
      }

      const { data: board, error: boardError } = await supabaseAdmin
        .from('boards')
        .select('id')
        .eq('id', default_board_id)
        .eq('organization_id', organizationId)
        .single();

      if (boardError || !board) {
        return ResponseUtil.error(res, 'Board not found or does not belong to your organization', 404);
      }

      const widget = await widgetService.createWidget({
        organization_id: organizationId,
        name,
        default_board_id,
        allowed_domains,
        branding,
        settings,
      });

      return ResponseUtil.success(res, 'Widget created successfully', {
        widget: widgetService.sanitizeWidget(widget),
        api_secret: widget.api_secret,
        api_secret_notice:
          'Copy this API secret now. It is used server-side for HMAC signing and will not be shown again.',
      });
    } catch (error) {
      console.error('❌ Create widget error:', error);
      return ResponseUtil.error(res, error.message, 500);
    }
  }

  /**
   * Get widget by ID
   */
  async getWidget(req, res) {
    try {
      const { id } = req.params;
      const organizationId = req.organization?.id;

      const widget = await widgetService.getWidgetById(id);

      if (!widget) {
        return ResponseUtil.error(res, 'Widget not found', 404);
      }

      if (widget.organization_id !== organizationId) {
        return ResponseUtil.error(res, 'Access denied', 403);
      }

      return ResponseUtil.success(res, 'Widget retrieved successfully', {
        widget: widgetService.sanitizeWidget(widget),
      });
    } catch (error) {
      console.error('❌ Get widget error:', error);
      return ResponseUtil.error(res, error.message, 500);
    }
  }

  /**
   * Update widget
   */
  async updateWidget(req, res) {
    try {
      const { id } = req.params;
      const organizationId = req.organization?.id;
      const { name, default_board_id, allowed_domains, branding, settings } = req.body;

      const widget = await widgetService.getWidgetById(id);

      if (!widget) {
        return ResponseUtil.error(res, 'Widget not found', 404);
      }

      if (widget.organization_id !== organizationId) {
        return ResponseUtil.error(res, 'Access denied', 403);
      }

      if (default_board_id) {
        const { data: board, error: boardError } = await supabaseAdmin
          .from('boards')
          .select('id')
          .eq('id', default_board_id)
          .eq('organization_id', organizationId)
          .single();

        if (boardError || !board) {
          return ResponseUtil.error(res, 'Board not found or does not belong to your organization', 404);
        }
      }

      const updatedWidget = await widgetService.updateWidget(id, {
        name,
        default_board_id,
        allowed_domains,
        branding,
        settings,
      });

      return ResponseUtil.success(res, 'Widget updated successfully', {
        widget: widgetService.sanitizeWidget(updatedWidget),
      });
    } catch (error) {
      console.error('❌ Update widget error:', error);
      return ResponseUtil.error(res, error.message, 500);
    }
  }

  /**
   * Delete widget
   */
  async deleteWidget(req, res) {
    try {
      const { id } = req.params;
      const organizationId = req.organization?.id;

      const widget = await widgetService.getWidgetById(id);

      if (!widget) {
        return ResponseUtil.error(res, 'Widget not found', 404);
      }

      if (widget.organization_id !== organizationId) {
        return ResponseUtil.error(res, 'Access denied', 403);
      }

      await widgetService.deleteWidget(id);

      return ResponseUtil.success(res, 'Widget deleted successfully');
    } catch (error) {
      console.error('❌ Delete widget error:', error);
      return ResponseUtil.error(res, error.message, 500);
    }
  }

  /**
   * Rotate API secret (returns new secret once).
   */
  async rotateApiSecret(req, res) {
    try {
      const { id } = req.params;
      const organizationId = req.organization?.id;

      const widget = await widgetService.getWidgetById(id);

      if (!widget) {
        return ResponseUtil.error(res, 'Widget not found', 404);
      }

      if (widget.organization_id !== organizationId) {
        return ResponseUtil.error(res, 'Access denied', 403);
      }

      const updated = await widgetService.rotateApiSecret(id);

      return ResponseUtil.success(res, 'API secret rotated successfully', {
        widget: widgetService.sanitizeWidget(updated),
        api_secret: updated.api_secret,
        api_secret_notice:
          'Copy this new API secret now. Update your server-side signing code. It will not be shown again.',
      });
    } catch (error) {
      console.error('❌ Rotate API secret error:', error);
      return ResponseUtil.error(res, error.message, 500);
    }
  }

  /**
   * Ensure legacy widgets have an api_secret (one-time admin action).
   */
  async ensureApiSecret(req, res) {
    try {
      const { id } = req.params;
      const organizationId = req.organization?.id;

      const widget = await widgetService.getWidgetById(id);

      if (!widget) {
        return ResponseUtil.error(res, 'Widget not found', 404);
      }

      if (widget.organization_id !== organizationId) {
        return ResponseUtil.error(res, 'Access denied', 403);
      }

      if (widget.api_secret) {
        return ResponseUtil.success(res, 'Widget already has an API secret', {
          widget: widgetService.sanitizeWidget(widget),
          has_api_secret: true,
        });
      }

      const updated = await widgetService.rotateApiSecret(id);

      return ResponseUtil.success(res, 'API secret generated', {
        widget: widgetService.sanitizeWidget(updated),
        api_secret: updated.api_secret,
        api_secret_notice: 'Copy this API secret now. It will not be shown again.',
      });
    } catch (error) {
      console.error('❌ Ensure API secret error:', error);
      return ResponseUtil.error(res, error.message, 500);
    }
  }
}

module.exports = new AdminWidgetController();
