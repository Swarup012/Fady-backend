const widgetService = require('../services/widget.service');
const { supabaseAdmin } = require('../config/supabase.config');
const ResponseUtil = require('../utils/response.util');

/**
 * Widget Controller
 * Handles widget API requests for embeddable feedback widget
 */
class WidgetController {
  /**
   * Identify external user
   * Called when FeedyWidget.identify() is invoked
   */
  async identify(req, res) {
    try {
      const { apiKey, widgetId } = req.query;
      const { id, email, name, ...context } = req.body;

      if (!id) {
        return ResponseUtil.error(res, 'User ID is required', 400);
      }

      if (!apiKey) {
        return ResponseUtil.error(res, 'API key is required', 400);
      }

      // Validate origin
      const origin = req.headers.origin;
      const validation = await widgetService.validateWidgetOrigin(apiKey, origin);

      if (!validation.valid) {
        return ResponseUtil.error(res, validation.error, 403);
      }

      const widget = validation.widget;

      // If widgetId provided, verify it matches
      if (widgetId && widget.id !== widgetId) {
        return ResponseUtil.error(res, 'Widget ID does not match API key', 403);
      }

      // Create or update external user
      const externalUser = await widgetService.createOrUpdateExternalUser({
        widget_instance_id: widget.id,
        external_user_id: id,
        email: email || null,
        name: name || null,
        context: context || {},
      });

      return ResponseUtil.success(res, {
        external_user_id: externalUser.id,
        widget_id: widget.id,
        message: 'User identified successfully',
      });
    } catch (error) {
      console.error('❌ Widget identify error:', error);
      return ResponseUtil.error(res, error.message, 500);
    }
  }

  /**
   * Get feedback list for widget
   */
  async getFeedback(req, res) {
    try {
      const { apiKey, widgetId } = req.query;
      const { status, limit = 20, offset = 0 } = req.query;

      if (!apiKey) {
        return ResponseUtil.error(res, 'API key is required', 400);
      }

      // Validate origin
      const origin = req.headers.origin;
      const validation = await widgetService.validateWidgetOrigin(apiKey, origin);

      if (!validation.valid) {
        return ResponseUtil.error(res, validation.error, 403);
      }

      const widget = validation.widget;

      // If widgetId provided, verify it matches
      if (widgetId && widget.id !== widgetId) {
        return ResponseUtil.error(res, 'Widget ID does not match API key', 403);
      }

      // Get posts from widget's default board
      let query = supabaseAdmin
        .from('posts')
        .select(`
          id,
          title,
          description,
          status,
          category,
          upvotes,
          created_at,
          updated_at,
          external_user_id,
          external_users!inner (
            external_user_id,
            name,
            email
          )
        `)
        .eq('board_id', widget.default_board_id)
        .eq('is_archived', false)
        .order('upvotes', { ascending: false })
        .order('created_at', { ascending: false })
        .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

      // Filter by status if provided
      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Transform data to match expected format
      const feedback = data.map(item => ({
        id: item.id,
        title: item.title,
        description: item.description,
        status: item.status,
        category: item.category,
        vote_count: item.upvotes,
        created_at: item.created_at,
        updated_at: item.updated_at,
        external_user_id: item.external_user_id,
        user: {
          id: item.external_users.external_user_id,
          name: item.external_users.name,
          email: item.external_users.email,
        },
      }));

      return ResponseUtil.success(res, {
        feedback,
        total: feedback.length,
        limit: parseInt(limit),
        offset: parseInt(offset),
      });
    } catch (error) {
      console.error('❌ Get widget feedback error:', error);
      return ResponseUtil.error(res, error.message, 500);
    }
  }

  /**
   * Create feedback from widget
   */
  async createFeedback(req, res) {
    try {
      const { apiKey, widgetId } = req.query;
      const { title, description, category, external_user_id } = req.body;

      if (!apiKey) {
        return ResponseUtil.error(res, 'API key is required', 400);
      }

      if (!title) {
        return ResponseUtil.error(res, 'Title is required', 400);
      }

      // Validate origin
      const origin = req.headers.origin;
      const validation = await widgetService.validateWidgetOrigin(apiKey, origin);

      if (!validation.valid) {
        return ResponseUtil.error(res, validation.error, 403);
      }

      const widget = validation.widget;

      // If widgetId provided, verify it matches
      if (widgetId && widget.id !== widgetId) {
        return ResponseUtil.error(res, 'Widget ID does not match API key', 403);
      }

      // Get external user
      let externalUser;
      if (external_user_id) {
        externalUser = await widgetService.getExternalUserByExternalId(
          widget.id,
          external_user_id
        );
      }

      // Get board to find its organization
      const { data: board, error: boardError } = await supabaseAdmin
        .from('boards')
        .select('organization_id')
        .eq('id', widget.default_board_id)
        .single();

      if (boardError) {
        console.warn('⚠️ Could not find board organization:', boardError);
      }

      // Create post with all required fields
      const postData = {
        board_id: widget.default_board_id,
        title,
        description: description || null,
        status: "open",
        upvotes: 0,
        comment_count: 0,
        is_pinned: false,
        is_archived: false,
        external_user_id: externalUser?.id || null,
      };

      // Add organization_id if board has one
      if (board && board.organization_id) {
        postData.organization_id = board.organization_id;
      }

      const { data, error } = await supabaseAdmin
        .from('posts')
        .insert([postData])
        .select()
        .single();

      if (error) throw error;

      console.log('✅ Widget post created:', data.id);

      return ResponseUtil.success(res, 'Feedback created successfully', {
        feedback: data,
      });
    } catch (error) {
      console.error('❌ Create widget feedback error:', error);
      return ResponseUtil.error(res, error.message, 500);
    }
  }

  /**
   * Vote on feedback from widget
   */
  async vote(req, res) {
    try {
      const { apiKey, widgetId } = req.query;
      const { feedback_id, external_user_id } = req.body;

      if (!apiKey) {
        return ResponseUtil.error(res, 'API key is required', 400);
      }

      if (!feedback_id) {
        return ResponseUtil.error(res, 'Feedback ID is required', 400);
      }

      if (!external_user_id) {
        return ResponseUtil.error(res, 'External user ID is required', 400);
      }

      // Validate origin
      const origin = req.headers.origin;
      const validation = await widgetService.validateWidgetOrigin(apiKey, origin);

      if (!validation.valid) {
        return ResponseUtil.error(res, validation.error, 403);
      }

      const widget = validation.widget;

      // If widgetId provided, verify it matches
      if (widgetId && widget.id !== widgetId) {
        return ResponseUtil.error(res, 'Widget ID does not match API key', 403);
      }

      // Get external user
      const externalUser = await widgetService.getExternalUserByExternalId(
        widget.id,
        external_user_id
      );

      if (!externalUser) {
        return ResponseUtil.error(res, 'External user not found', 404);
      }

      // Check if user already voted
      const { data: existingVote, error: voteError } = await supabaseAdmin
        .from('upvotes')
        .select('*')
        .eq('post_id', feedback_id)
        .eq('external_user_id', externalUser.id)
        .single();

      if (voteError && voteError.code !== 'PGRST116') throw voteError;

      if (existingVote) {
        // Remove vote (toggle)
        await supabaseAdmin
          .from('upvotes')
          .delete()
          .eq('post_id', feedback_id)
          .eq('external_user_id', externalUser.id);

        // Decrement vote count
        await supabaseAdmin.rpc('decrement_vote_count', {
          post_id: feedback_id,
        });

        return ResponseUtil.success(res, 'Vote removed', {
          voted: false,
        });
      }

      // Add vote
      await supabaseAdmin
        .from('upvotes')
        .insert({
          post_id: feedback_id,
          external_user_id: externalUser.id,
        });

      // Increment vote count
      await supabaseAdmin.rpc('increment_vote_count', {
        post_id: feedback_id,
      });

      return ResponseUtil.success(res, 'Vote added', {
        voted: true,
      });
    } catch (error) {
      console.error('❌ Widget vote error:', error);
      return ResponseUtil.error(res, error.message, 500);
    }
  }

  /**
   * Get widget configuration
   * Returns widget settings for initialization
   */
  async getConfig(req, res) {
    try {
      const { apiKey, widgetId } = req.query;

      if (!apiKey) {
        return ResponseUtil.error(res, 'API key is required', 400);
      }

      // Validate origin
      const origin = req.headers.origin;
      const validation = await widgetService.validateWidgetOrigin(apiKey, origin);

      if (!validation.valid) {
        return ResponseUtil.error(res, validation.error, 403);
      }

      const widget = validation.widget;

      // If widgetId provided, verify it matches
      if (widgetId && widget.id !== widgetId) {
        return ResponseUtil.error(res, 'Widget ID does not match API key', 403);
      }

      // Get board info
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
          settings: widget.settings,
        },
        board: board || null,
      });
    } catch (error) {
      console.error('❌ Get widget config error:', error);
      return ResponseUtil.error(res, error.message, 500);
    }
  }
}

module.exports = new WidgetController();
