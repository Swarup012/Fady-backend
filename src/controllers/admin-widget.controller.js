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
        widgets,
        total: widgets.length,
      });
    } catch (error) {
      console.error('❌ Get widgets error:', error);
      return ResponseUtil.error(res, error.message, 500);
    }
  }

  /**
   * Create a new widget
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

      // Verify board belongs to organization
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
        widget,
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

      // Verify widget belongs to organization
      if (widget.organization_id !== organizationId) {
        return ResponseUtil.error(res, 'Access denied', 403);
      }

      return ResponseUtil.success(res, 'Widget retrieved successfully', { widget });
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

      // Verify widget belongs to organization
      if (widget.organization_id !== organizationId) {
        return ResponseUtil.error(res, 'Access denied', 403);
      }

      // If updating default_board_id, verify it belongs to organization
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
        widget: updatedWidget,
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

      // Verify widget belongs to organization
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
}

module.exports = new AdminWidgetController();
