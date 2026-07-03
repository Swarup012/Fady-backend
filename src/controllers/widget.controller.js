const widgetService = require('../services/widget.service');
const clusterService = require('../services/cluster.service');
const {
  WidgetIdentityError,
  resolveVerifiedIdentity,
  trackWidgetEngagement,
} = require('../services/widget-identity.service');
const { supabaseAdmin } = require('../config/supabase.config');
const { EXTERNAL_AUTHOR_SELECT } = require('../services/post.service');
const ResponseUtil = require('../utils/response.util');

/**
 * Widget Controller — Phase 1: SDK + HMAC verified identity only.
 */
class WidgetController {
  handleIdentityError(res, error) {
    if (error instanceof WidgetIdentityError) {
      return ResponseUtil.error(res, error.message, error.statusCode);
    }
    console.error('❌ Widget error:', error);
    return ResponseUtil.error(res, error.message, 500);
  }

  /**
   * Identify external user (signed SDK payload required).
   */
  async identify(req, res) {
    try {
      const widget = req.widget;
      const { externalUser, orgEndUser } = await resolveVerifiedIdentity(widget, req.body);

      return ResponseUtil.success(res, {
        external_user_id: externalUser.id,
        org_end_user_id: orgEndUser.id,
        widget_id: widget.id,
        message: 'User identified successfully',
      });
    } catch (error) {
      return this.handleIdentityError(res, error);
    }
  }

  /**
   * Get feedback list for widget.
   */
  async getFeedback(req, res) {
    try {
      const widget = req.widget;
      const { status, limit = 20, offset = 0 } = req.query;

      let query = supabaseAdmin
        .from('posts')
        .select(`
          id,
          title,
          description,
          status,
          upvotes,
          created_at,
          updated_at,
          external_user_id,
          org_end_user_id,
          external_users (
            external_user_id,
            name,
            email
          ),
          org_end_users (
            external_user_id,
            name,
            email,
            identity_type
          )
        `)
        .eq('board_id', widget.default_board_id)
        .eq('is_archived', false)
        .order('upvotes', { ascending: false })
        .order('created_at', { ascending: false })
        .range(parseInt(offset, 10), parseInt(offset, 10) + parseInt(limit, 10) - 1);

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query;
      if (error) throw error;

      const feedback = (data || []).map((item) => {
        const endUser = item.org_end_users || item.external_users;
        return {
          id: item.id,
          title: item.title,
          description: item.description,
          status: item.status,
          vote_count: item.upvotes,
          created_at: item.created_at,
          updated_at: item.updated_at,
          external_user_id: item.external_user_id,
          org_end_user_id: item.org_end_user_id,
          user: endUser
            ? {
                id: endUser.external_user_id,
                name: endUser.name,
                email: endUser.email,
              }
            : null,
        };
      });

      return ResponseUtil.success(res, {
        feedback,
        total: feedback.length,
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
      });
    } catch (error) {
      return this.handleIdentityError(res, error);
    }
  }

  /**
   * Create feedback from widget (signed identity required).
   */
  async createFeedback(req, res) {
    try {
      const { title, description } = req.body;
      const widget = req.widget;

      if (!title) {
        return ResponseUtil.error(res, 'Title is required', 400);
      }

      const { externalUser, orgEndUser, organizationId } = await resolveVerifiedIdentity(
        widget,
        req.body,
      );

      const { data: board, error: boardError } = await supabaseAdmin
        .from('boards')
        .select('organization_id, slug')
        .eq('id', widget.default_board_id)
        .single();

      if (boardError) {
        console.warn('⚠️ Could not find board organization:', boardError);
      }

      const postData = {
        board_id: widget.default_board_id,
        title,
        description: description || null,
        status: 'open',
        upvotes: 0,
        comment_count: 0,
        is_pinned: false,
        is_archived: false,
        external_user_id: externalUser.id,
        org_end_user_id: orgEndUser.id,
        organization_id: board?.organization_id || organizationId,
      };

      const { data, error } = await supabaseAdmin
        .from('posts')
        .insert([postData])
        .select(
          `
          *,
          ${EXTERNAL_AUTHOR_SELECT},
          board:boards!board_id(id, name, slug)
        `,
        )
        .single();

      if (error) throw error;

      console.log('✅ Widget post created:', data.id);

      await widgetService.invalidateBoardPostCaches(
        widget.default_board_id,
        postData.organization_id,
        data.id,
      );

      trackWidgetEngagement(postData.organization_id, orgEndUser, 'create_post');

      clusterService
        .triggerClusterAssignment(widget.default_board_id, data.id, title, description || '')
        .catch((err) =>
          console.error('❌ Cluster assignment trigger failed (non-fatal):', err.message),
        );

      return ResponseUtil.success(res, 'Feedback created successfully', {
        feedback: data,
      });
    } catch (error) {
      return this.handleIdentityError(res, error);
    }
  }

  /**
   * Vote on feedback (signed identity required; anonymous cannot vote).
   */
  async vote(req, res) {
    try {
      const { feedback_id } = req.body;
      const widget = req.widget;

      if (!feedback_id) {
        return ResponseUtil.error(res, 'Feedback ID is required', 400);
      }

      const { externalUser, orgEndUser, organizationId } = await resolveVerifiedIdentity(
        widget,
        req.body,
      );

      const result = await widgetService.vote(feedback_id, externalUser, orgEndUser);

      const { data: post } = await supabaseAdmin
        .from('posts')
        .select('board_id, organization_id')
        .eq('id', feedback_id)
        .single();

      if (post) {
        await widgetService.invalidateBoardPostCaches(
          post.board_id,
          post.organization_id,
          feedback_id,
        );
      }

      trackWidgetEngagement(post?.organization_id || organizationId, orgEndUser, 'vote');

      return ResponseUtil.success(res, result.voted ? 'Vote added' : 'Vote removed', result);
    } catch (error) {
      return this.handleIdentityError(res, error);
    }
  }

  /**
   * Get widget configuration (public settings only).
   */
  async getConfig(req, res) {
    try {
      const widget = req.widget;

      const { data: board } = await supabaseAdmin
        .from('boards')
        .select('id, name, slug, icon')
        .eq('id', widget.default_board_id)
        .single();

      return ResponseUtil.success(res, {
        widget: {
          id: widget.id,
          name: widget.name,
          branding: widget.branding,
          settings: {
            show_voting: true,
            allow_anonymous: false,
            show_roadmap: true,
            require_sdk_identity: true,
            ...(widget.settings || {}),
          },
          has_api_secret: Boolean(widget.api_secret),
        },
        board: board || null,
      });
    } catch (error) {
      return this.handleIdentityError(res, error);
    }
  }
}

module.exports = new WidgetController();
