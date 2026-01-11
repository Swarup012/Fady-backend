// src/controllers/notification.controller.js
const notificationService = require('../services/notification.service');
const notificationQueueService = require('../services/notification-queue.service');
const { supabaseAdmin } = require('../config/supabase.config');
const crypto = require('crypto');

module.exports = {
  // Get user notification preferences
  getPreferences: async (req, res) => {
    try {
      const userId = req.user.id;
      const email = req.user.email;

      let preferences = await notificationService.getPreferences(email);

      // If no preferences exist, create default ones
      if (!preferences) {
        preferences = await notificationService.createDefaultPreferences(userId, email);
      }

      res.json({
        success: true,
        data: preferences
      });
    } catch (error) {
      console.error('Error getting notification preferences:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get notification preferences',
        error: error.message
      });
    }
  },

  // Update user notification preferences
  updatePreferences: async (req, res) => {
    try {
      const userId = req.user.id;
      const email = req.user.email;
      const updates = req.body;

      const preferences = await notificationService.updatePreferences(email, updates);

      res.json({
        success: true,
        message: 'Notification preferences updated successfully',
        data: preferences
      });
    } catch (error) {
      console.error('Error updating notification preferences:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update notification preferences',
        error: error.message
      });
    }
  },

  // Get unsubscribe page (public)
  getUnsubscribePage: async (req, res) => {
    try {
      const { token } = req.params;

      const { data: preferences, error } = await supabaseAdmin
        .from('notification_preferences')
        .select('email, unsubscribed_all')
        .eq('unsubscribe_token', token)
        .single();

      if (error || !preferences) {
        return res.status(404).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Invalid Unsubscribe Link</title>
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
              .container { max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
              h1 { color: #dc2626; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>❌ Invalid Link</h1>
              <p>This unsubscribe link is invalid or has expired.</p>
            </div>
          </body>
          </html>
        `);
      }

      if (preferences.unsubscribed_all) {
        return res.send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Already Unsubscribed</title>
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
              .container { max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
              h1 { color: #059669; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>✓ Already Unsubscribed</h1>
              <p>You have already unsubscribed from all notifications for <strong>${preferences.email}</strong>.</p>
            </div>
          </body>
          </html>
        `);
      }

      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Unsubscribe from Notifications</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
            .container { max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            h1 { color: #1f2937; }
            button { background: #dc2626; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-size: 16px; margin-top: 20px; }
            button:hover { background: #b91c1c; }
            .cancel { background: #6b7280; margin-left: 10px; }
            .cancel:hover { background: #4b5563; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Unsubscribe from Notifications</h1>
            <p>Are you sure you want to unsubscribe <strong>${preferences.email}</strong> from all feature completion notifications?</p>
            <p style="color: #6b7280; font-size: 14px;">You will no longer receive emails when features you voted for or commented on are completed.</p>
            
            <form method="POST" action="/api/notifications/unsubscribe/${token}">
              <button type="submit">Yes, Unsubscribe</button>
              <button type="button" class="cancel" onclick="window.close()">Cancel</button>
            </form>
          </div>
        </body>
        </html>
      `);
    } catch (error) {
      console.error('Error showing unsubscribe page:', error);
      res.status(500).send('An error occurred');
    }
  },

  // Confirm unsubscribe (public)
  confirmUnsubscribe: async (req, res) => {
    try {
      const { token } = req.params;

      const { data: preferences, error } = await supabaseAdmin
        .from('notification_preferences')
        .select('email')
        .eq('unsubscribe_token', token)
        .single();

      if (error || !preferences) {
        return res.status(404).send('Invalid unsubscribe link');
      }

      // Update preferences to unsubscribe
      await supabaseAdmin
        .from('notification_preferences')
        .update({
          unsubscribed_all: true,
          notify_on_completion: false,
          notify_on_progress: false,
          notify_on_comments: false,
          updated_at: new Date().toISOString()
        })
        .eq('unsubscribe_token', token);

      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Unsubscribed Successfully</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
            .container { max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            h1 { color: #059669; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✓ Successfully Unsubscribed</h1>
            <p>You have been unsubscribed from all notifications for <strong>${preferences.email}</strong>.</p>
            <p style="color: #6b7280; font-size: 14px; margin-top: 20px;">
              You can update your preferences anytime by logging into your account.
            </p>
          </div>
        </body>
        </html>
      `);
    } catch (error) {
      console.error('Error confirming unsubscribe:', error);
      res.status(500).send('An error occurred');
    }
  },

  // Get notification history for user
  getHistory: async (req, res) => {
    try {
      const email = req.user.email;
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;

      const { data: history, error, count } = await supabaseAdmin
        .from('notification_history')
        .select('*', { count: 'exact' })
        .eq('recipient_email', email)
        .order('sent_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      res.json({
        success: true,
        data: {
          history,
          total: count,
          limit,
          offset
        }
      });
    } catch (error) {
      console.error('Error getting notification history:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get notification history',
        error: error.message
      });
    }
  },

  // Manually trigger queue processing (internal/testing)
  processQueue: async (req, res) => {
    try {
      console.log('📬 Manually triggering notification queue processing...');
      
      const result = await notificationQueueService.processNotificationQueue();

      res.json({
        success: true,
        message: 'Queue processing completed',
        data: result
      });
    } catch (error) {
      console.error('Error processing queue:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to process queue',
        error: error.message
      });
    }
  },

  // Get queue status (internal)
  getQueueStatus: async (req, res) => {
    try {
      const { data: pending, error: pendingError } = await supabaseAdmin
        .from('notification_queue')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      const { data: processing, error: processingError } = await supabaseAdmin
        .from('notification_queue')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'processing');

      const { data: recent, error: recentError } = await supabaseAdmin
        .from('notification_queue')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      const { data: recentSent, error: sentError } = await supabaseAdmin
        .from('notification_history')
        .select('*', { count: 'exact', head: true })
        .gte('sent_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      res.json({
        success: true,
        data: {
          pending_count: pending || 0,
          processing_count: processing || 0,
          sent_last_24h: recentSent || 0,
          recent_queue_items: recent || []
        }
      });
    } catch (error) {
      console.error('Error getting queue status:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get queue status',
        error: error.message
      });
    }
  }
};
