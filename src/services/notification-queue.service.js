// src/services/notification-queue.service.js
const { supabaseAdmin } = require('../config/supabase.config');
const notificationService = require('./notification.service');

const notificationQueueService = {
  /**
   * Main queue processor - runs every minute via cron
   * Processes all pending notifications that are ready
   */
  async processNotificationQueue() {
    try {
      console.log('🔄 Processing notification queue...');

      // Get all pending notifications that are ready to be processed
      const { data: pendingNotifications, error } = await supabaseAdmin
        .from('notification_queue')
        .select('*')
        .eq('status', 'pending')
        .lte('scheduled_for', new Date().toISOString())
        .order('scheduled_for', { ascending: true });

      if (error) {
        console.error('Error fetching pending notifications:', error);
        return { success: false, error: error.message };
      }

      if (!pendingNotifications || pendingNotifications.length === 0) {
        console.log('✅ No pending notifications to process');
        return { success: true, processed: 0 };
      }

      console.log(`📬 Found ${pendingNotifications.length} pending notifications`);

      // Group notifications by time window for batching
      // Posts completed within 10 minutes of each other will be batched together
      const batches = this.groupNotificationsByBatch(pendingNotifications);

      console.log(`📦 Grouped into ${batches.length} batches`);

      let totalProcessed = 0;
      let totalSent = 0;
      let totalFailed = 0;

      // Process each batch
      for (const batch of batches) {
        const result = await this.processBatch(batch);
        totalProcessed += result.processed;
        totalSent += result.sent;
        totalFailed += result.failed;
      }

      console.log(`✅ Queue processing complete: ${totalProcessed} processed, ${totalSent} sent, ${totalFailed} failed`);

      return {
        success: true,
        processed: totalProcessed,
        sent: totalSent,
        failed: totalFailed
      };
    } catch (error) {
      console.error('Error in processNotificationQueue:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Group notifications into batches
   * Notifications within 10 minutes of each other are batched together
   */
  groupNotificationsByBatch(notifications) {
    const BATCH_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
    const batches = [];
    let currentBatch = [];
    let batchStartTime = null;

    for (const notification of notifications) {
      const scheduledTime = new Date(notification.scheduled_for).getTime();

      if (!batchStartTime) {
        // First notification in batch
        batchStartTime = scheduledTime;
        currentBatch.push(notification);
      } else if (scheduledTime - batchStartTime <= BATCH_WINDOW_MS) {
        // Within batch window
        currentBatch.push(notification);
      } else {
        // Outside batch window, start new batch
        batches.push(currentBatch);
        currentBatch = [notification];
        batchStartTime = scheduledTime;
      }
    }

    // Add last batch
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    return batches;
  },

  /**
   * Process a single batch of notifications
   */
  async processBatch(batch) {
    try {
      console.log(`🔄 Processing batch of ${batch.length} notifications`);

      // Mark all notifications in batch as 'processing'
      const notificationIds = batch.map(n => n.id);
      await supabaseAdmin
        .from('notification_queue')
        .update({ status: 'processing', updated_at: new Date().toISOString() })
        .in('id', notificationIds);

      // Get all posts for this batch
      const postIds = batch.map(n => n.post_id);
      const { data: posts, error: postsError } = await supabaseAdmin
        .from('posts')
        .select(`
          *,
          boards!inner(
            id,
            name,
            slug,
            is_private,
            organization_id,
            organizations!inner(
              id,
              name,
              slug
            )
          )
        `)
        .in('id', postIds);

      if (postsError || !posts || posts.length === 0) {
        console.error('Error fetching posts:', postsError);
        await this.markBatchAsFailed(notificationIds, 'Failed to fetch posts');
        return { processed: batch.length, sent: 0, failed: batch.length };
      }

      // Flatten board and organization data
      const enrichedPosts = posts.map(post => ({
        ...post,
        board_name: post.boards?.name,
        board_slug: post.boards?.slug,
        is_private: post.boards?.is_private,
        organization: post.boards?.organizations
      }));

      // Group posts by user email
      console.log('👥 Grouping posts by interested users...');
      const userPostsMap = await notificationService.groupPostsByUser(enrichedPosts);

      const userCount = Object.keys(userPostsMap).length;
      console.log(`📧 Will send emails to ${userCount} users`);

      if (userCount === 0) {
        console.log('ℹ️  No eligible users to notify');
        await supabaseAdmin
          .from('notification_queue')
          .update({ status: 'sent', updated_at: new Date().toISOString() })
          .in('id', notificationIds);
        return { processed: batch.length, sent: 0, failed: 0 };
      }

      // Get organization for email template
      const organization = enrichedPosts[0].organization;

      // Send batched notifications
      const sendResult = await notificationService.sendBatchedNotifications(
        userPostsMap,
        organization
      );

      // Mark notifications as sent
      await supabaseAdmin
        .from('notification_queue')
        .update({ status: 'sent', updated_at: new Date().toISOString() })
        .in('id', notificationIds);

      console.log(`✅ Batch processed: ${sendResult.sent} sent, ${sendResult.failed} failed`);

      return {
        processed: batch.length,
        sent: sendResult.sent,
        failed: sendResult.failed
      };
    } catch (error) {
      console.error('Error processing batch:', error);
      await this.markBatchAsFailed(batch.map(n => n.id), error.message);
      return { processed: batch.length, sent: 0, failed: batch.length };
    }
  },

  /**
   * Mark batch as failed
   */
  async markBatchAsFailed(notificationIds, errorMessage) {
    try {
      // First, get current retry counts
      const { data: notifications } = await supabaseAdmin
        .from('notification_queue')
        .select('id, retry_count')
        .in('id', notificationIds);

      // Update each with incremented retry count
      if (notifications) {
        for (const notif of notifications) {
          await supabaseAdmin
            .from('notification_queue')
            .update({
              status: 'failed',
              error_message: errorMessage,
              retry_count: (notif.retry_count || 0) + 1,
              updated_at: new Date().toISOString()
            })
            .eq('id', notif.id);
        }
      }
    } catch (error) {
      console.error('Error marking batch as failed:', error);
    }
  },

  /**
   * Cleanup old processed notifications (older than 30 days)
   */
  async cleanupOldNotifications() {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const { error } = await supabaseAdmin
        .from('notification_queue')
        .delete()
        .in('status', ['sent', 'failed'])
        .lt('created_at', thirtyDaysAgo.toISOString());

      if (error) {
        console.error('Error cleaning up old notifications:', error);
        return { success: false, error: error.message };
      }

      console.log('✅ Old notifications cleaned up');
      return { success: true };
    } catch (error) {
      console.error('Error in cleanupOldNotifications:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Get queue statistics
   */
  async getQueueStats() {
    try {
      const { data, error } = await supabaseAdmin
        .from('notification_queue')
        .select('status, count')
        .groupBy('status');

      if (error) {
        console.error('Error fetching queue stats:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error in getQueueStats:', error);
      return null;
    }
  }
};

module.exports = notificationQueueService;
