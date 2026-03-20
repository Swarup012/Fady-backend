// src/services/notification-queue.service.js
const { supabaseAdmin } = require('../config/supabase.config');
const notificationService = require('./notification.service');

const notificationQueueService = {
  /**
   * Helper function to retry database queries with exponential backoff
   * Handles intermittent network failures
   */
  async retryQuery(queryFn, maxRetries = 3, baseDelay = 1000) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await queryFn();
      } catch (err) {
        lastError = err;
        console.error(`Query attempt ${attempt}/${maxRetries} failed:`, err.message);
        
        if (attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt - 1);
          console.log(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  },

  /**
   * Main queue processor - runs every minute via cron
   * Processes all pending notifications that are ready
   */
  async processNotificationQueue() {
    try {
      console.log('\n╔══════════════════════════════════════════════════════════════════╗');
      console.log('║  🔄 [DEBUG] processNotificationQueue - STARTED                   ║');
      console.log('╚══════════════════════════════════════════════════════════════════╝');
      console.log('   📍 Current Time (ISO):', new Date().toISOString());
      console.log('   📍 Current Time (Local):', new Date().toString());

      // Get all pending notifications that are ready to be processed
      // Use retry logic to handle intermittent network failures
      let pendingNotifications, error;
      let queryTimeUsed = null;
      
      try {
        // Remove timezone suffix (Z) for proper comparison with stored timestamps
        // Supabase stores timestamps without Z, so we need to match that format
        const nowWithoutZ = new Date().toISOString().replace('Z', '');
        queryTimeUsed = nowWithoutZ;
        
        console.log('   📍 Query Time (without Z):', nowWithoutZ);
        console.log('   ⏳ Fetching pending notifications from database...');
        
        const result = await this.retryQuery(async () => {
          const { data, error: queryError } = await supabaseAdmin
            .from('notification_queue')
            .select('*')
            .eq('status', 'pending')
            .lte('scheduled_for', nowWithoutZ)
            .order('scheduled_for', { ascending: true });
          
          if (queryError) throw queryError;
          return { data, error: null };
        });
        
        pendingNotifications = result.data;
        error = result.error;
        
        console.log('   ✅ Database query completed');
      } catch (retryError) {
        console.error('   ❌ Error fetching pending notifications after retries:', retryError);
        console.log('══════════════════════════════════════════════════════════════════\n');
        return { success: false, error: retryError.message };
      }

      if (error) {
        console.error('   ❌ Error fetching pending notifications:', error);
        console.log('══════════════════════════════════════════════════════════════════\n');
        return { success: false, error: error.message };
      }

      if (!pendingNotifications || pendingNotifications.length === 0) {
        console.log('   ℹ️  No pending notifications to process');
        console.log('   📍 Query used time:', queryTimeUsed);
        
        // Let's also check what's in the queue for debugging
        const { data: allQueue } = await supabaseAdmin
          .from('notification_queue')
          .select('id, post_id, status, scheduled_for, created_at')
          .order('created_at', { ascending: false })
          .limit(5);
        
        if (allQueue && allQueue.length > 0) {
          console.log('   📋 Recent queue entries (for debugging):');
          allQueue.forEach(q => {
            console.log(`      - ID: ${q.id} | Status: ${q.status} | Scheduled: ${q.scheduled_for}`);
          });
        } else {
          console.log('   📋 Queue is completely empty');
        }
        
        console.log('══════════════════════════════════════════════════════════════════\n');
        return { success: true, processed: 0 };
      }
      
      console.log(`   📬 Found ${pendingNotifications.length} pending notifications:`);
      pendingNotifications.forEach((n, i) => {
        console.log(`      [${i + 1}] Post ID: ${n.post_id}`);
        console.log(`          Scheduled: ${n.scheduled_for}`);
        console.log(`          Created: ${n.created_at}`);
        console.log(`          Status: ${n.status}`);
      });

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
      console.log('\n┌──────────────────────────────────────────────────────────────────┐');
      console.log(`│  🔄 [DEBUG] processBatch - Processing ${batch.length} notification(s)`);
      console.log('└──────────────────────────────────────────────────────────────────┘');

      // Mark all notifications in batch as 'processing'
      const notificationIds = batch.map(n => n.id);
      console.log('   📝 Notification IDs:', notificationIds.join(', '));
      
      await supabaseAdmin
        .from('notification_queue')
        .update({ status: 'processing', updated_at: new Date().toISOString() })
        .in('id', notificationIds);
      console.log('   ✅ Marked as "processing"');

      // Get all posts for this batch
      const postIds = batch.map(n => n.post_id);
      console.log('   📝 Post IDs:', postIds.join(', '));
      console.log('   ⏳ Fetching posts with board & org data...');
      
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
        console.error('   ❌ Error fetching posts:', postsError);
        console.log('   📋 Posts returned:', posts);
        await this.markBatchAsFailed(notificationIds, 'Failed to fetch posts');
        return { processed: batch.length, sent: 0, failed: batch.length };
      }

      console.log(`   ✅ Found ${posts.length} post(s)`);
      posts.forEach((p, i) => {
        console.log(`      [${i + 1}] "${p.title}" (ID: ${p.id})`);
        console.log(`          Board: ${p.boards?.name} (${p.boards?.slug})`);
        console.log(`          Org: ${p.boards?.organizations?.name} (ID: ${p.boards?.organizations?.id})`);
        console.log(`          Is Private: ${p.boards?.is_private}`);
      });

      // Flatten board and organization data
      const enrichedPosts = posts.map(post => ({
        ...post,
        board_name: post.boards?.name,
        board_slug: post.boards?.slug,
        is_private: post.boards?.is_private,
        organization: post.boards?.organizations
      }));

      // Group posts by user email
      console.log('\n   👥 Grouping posts by interested users...');
      const userPostsMap = await notificationService.groupPostsByUser(enrichedPosts);

      const userCount = Object.keys(userPostsMap).length;
      const userEmails = Object.keys(userPostsMap);
      
      console.log(`\n   📧 Users who will receive emails: ${userCount}`);
      userEmails.forEach(email => {
        const userData = userPostsMap[email];
        console.log(`      ✉️  ${email}`);
        console.log(`         User ID: ${userData.userId || 'N/A'}`);
        console.log(`         Tracking Code: ${userData.trackingCode || 'N/A'}`);
        console.log(`         Posts: ${userData.posts.length}`);
      });

      if (userCount === 0) {
        console.log('   ⚠️  No eligible users to notify - marking as sent');
        await supabaseAdmin
          .from('notification_queue')
          .update({ status: 'sent', updated_at: new Date().toISOString() })
          .in('id', notificationIds);
        return { processed: batch.length, sent: 0, failed: 0 };
      }

      // Get organization for email template
      const organization = enrichedPosts[0].organization;
      console.log(`\n   🏢 Organization for email template: ${organization?.name} (ID: ${organization?.id})`);

      // Send batched notifications
      console.log('   ⏳ Calling sendBatchedNotifications...');
      const sendResult = await notificationService.sendBatchedNotifications(
        userPostsMap,
        organization
      );
      console.log(`   ✅ sendBatchedNotifications returned: sent=${sendResult.sent}, failed=${sendResult.failed}`);

      // Mark notifications as sent
      await supabaseAdmin
        .from('notification_queue')
        .update({ status: 'sent', updated_at: new Date().toISOString() })
        .in('id', notificationIds);

      console.log(`   ✅ Batch complete: ${sendResult.sent} sent, ${sendResult.failed} failed`);
      console.log('────────────────────────────────────────────────────────────────────\n');

      return {
        processed: batch.length,
        sent: sendResult.sent,
        failed: sendResult.failed
      };
    } catch (error) {
      console.error('   ❌ Error processing batch:', error);
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
