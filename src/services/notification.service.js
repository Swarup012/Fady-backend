// src/services/notification.service.js
const { supabaseAdmin } = require('../config/supabase.config');
const emailTemplateService = require('./email-template.service');
const emailService = require('./email.service');

const notificationService = {
  /**
   * Queue a notification for a post status change
   * @param {string} postId - Post UUID
   * @param {string} oldStatus - Previous status
   * @param {string} newStatus - New status
   */
  async queueNotification(postId, oldStatus, newStatus) {
    try {
      console.log('\n╔══════════════════════════════════════════════════════════════════╗');
      console.log('║  🔔 [DEBUG] queueNotification - Post status changed             ║');
      console.log('╚══════════════════════════════════════════════════════════════════╝');
      console.log('   Post ID:', postId);
      console.log('   Old Status:', oldStatus);
      console.log('   New Status:', newStatus);
      console.log('   Timestamp:', new Date().toISOString());
      
      // Only queue if status changed to 'completed'
      if (newStatus !== 'completed' || oldStatus === 'completed') {
        console.log('   ❌ Status not eligible for notification (not a new completion)');
        console.log('══════════════════════════════════════════════════════════════════\n');
        return { success: false, message: 'Status not eligible for notification' };
      }

      // Schedule notification for 10 minutes from now (batching window)
      const scheduledFor = new Date(Date.now() + 10 * 60 * 1000);
      console.log('   ⏰ Scheduling notification for:', scheduledFor.toISOString());

      const { data, error } = await supabaseAdmin
        .from('notification_queue')
        .insert({
          post_id: postId,
          notification_type: 'status_completed',
          scheduled_for: scheduledFor.toISOString(),
          status: 'pending'
        })
        .select()
        .single();

      if (error) {
        console.error('   ❌ Error queueing notification:', error);
        console.log('══════════════════════════════════════════════════════════════════\n');
        return { success: false, error: error.message };
      }

      console.log('   ✅ Notification queued successfully!');
      console.log('   Queue Entry ID:', data.id);
      console.log('══════════════════════════════════════════════════════════════════\n');
      return { success: true, data };
    } catch (error) {
      console.error('Error in queueNotification:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Get all interested users for a post
   * Returns users who created, voted, or commented
   */
  async getInterestedUsers(postId) {
    try {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🔍 [DEBUG] getInterestedUsers called');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('   Post ID:', postId);
      console.log('   Calling RPC: get_interested_users_for_post...');
      
      const { data, error } = await supabaseAdmin.rpc('get_interested_users_for_post', {
        p_post_id: postId
      });

      if (error) {
        console.error('   ❌ RPC Error:', error);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        return [];
      }

      console.log('   ✅ RPC returned', (data || []).length, 'interested users:');
      (data || []).forEach((user, index) => {
        console.log(`   [${index + 1}] Email: ${user.email}`);
        console.log(`       User ID: ${user.user_id || 'N/A (tracked user)'}`);
        console.log(`       Tracking Code: ${user.tracking_code || 'N/A'}`);
        console.log(`       Reasons: ${JSON.stringify(user.reasons)}`);
      });
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      return data || [];
    } catch (error) {
      console.error('Error in getInterestedUsers:', error);
      return [];
    }
  },

  /**
   * Check if user has access to a post (for private boards)
   */
  async canUserAccessPost(post, userEmail, trackingCode) {
    try {
      // Get board details
      const { data: board, error: boardError } = await supabaseAdmin
        .from('boards')
        .select('is_private, organization_id')
        .eq('id', post.board_id)
        .single();

      if (boardError || !board) {
        console.error('Error fetching board:', boardError);
        return false;
      }

      // If board is public, everyone can access
      if (!board.is_private) {
        return true;
      }

      // Private board - check if user is organization member
      const { data: user } = await supabaseAdmin
        .from('users')
        .select('id, organization_id')
        .eq('email', userEmail)
        .single();

      if (user && user.organization_id === board.organization_id) {
        return true;
      }

      // If tracked user, check if they engaged with THIS specific post
      if (trackingCode) {
        const { data: engagement } = await supabaseAdmin.rpc('check_user_engagement', {
          p_post_id: post.id,
          p_tracking_code: trackingCode
        });

        return engagement || false;
      }

      return false;
    } catch (error) {
      console.error('Error checking user access:', error);
      return false;
    }
  },

  /**
   * Check if user has been notified about a post
   */
  async hasBeenNotified(postId, userEmail) {
    try {
      const { data, error } = await supabaseAdmin.rpc('has_been_notified', {
        p_post_id: postId,
        p_email: userEmail
      });

      if (error) {
        console.error('Error checking notification history:', error);
        return false;
      }

      return data || false;
    } catch (error) {
      console.error('Error in hasBeenNotified:', error);
      return false;
    }
  },

  /**
   * Check user's notification preferences
   */
  async getUserPreferences(email) {
    try {
      const { data, error } = await supabaseAdmin
        .from('notification_preferences')
        .select('*')
        .eq('email', email)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
        console.error('Error fetching preferences:', error);
      }

      // Default preferences if none exist
      return data || {
        notify_on_completion: true,
        notify_on_progress: false,
        notify_on_comments: true,
        unsubscribed_all: false
      };
    } catch (error) {
      console.error('Error in getUserPreferences:', error);
      return {
        notify_on_completion: true,
        unsubscribed_all: false
      };
    }
  },

  /**
   * Group posts by user email for batched sending
   * @param {Array} posts - Array of post objects
   * @returns {Object} - { 'email@example.com': { posts: [], reasons: {} } }
   */
  async groupPostsByUser(posts) {
    console.log('\n╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  🔍 [DEBUG] groupPostsByUser - Starting user filtering          ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    console.log('   Total posts to process:', posts.length);
    posts.forEach((p, i) => console.log(`   [${i + 1}] Post: "${p.title}" (ID: ${p.id})`));
    
    const userPostsMap = {};

    for (const post of posts) {
      console.log('\n┌──────────────────────────────────────────────────────────────────┐');
      console.log(`│  Processing Post: "${post.title}"`);
      console.log(`│  Post ID: ${post.id}`);
      console.log('└──────────────────────────────────────────────────────────────────┘');
      
      // Get all interested users for this post
      const interestedUsers = await this.getInterestedUsers(post.id);
      
      console.log(`\n   📋 Processing ${interestedUsers.length} interested users for this post...`);

      for (const user of interestedUsers) {
        const { email, user_id, tracking_code, reasons } = user;
        
        console.log(`\n   ┌─ User: ${email} ─────────────────────────`);
        console.log(`   │  User ID: ${user_id || 'N/A'}`);
        console.log(`   │  Tracking Code: ${tracking_code || 'N/A'}`);
        console.log(`   │  Reasons: ${JSON.stringify(reasons)}`);

        // Check if already notified
        console.log(`   │  ⏳ Checking if already notified...`);
        const alreadyNotified = await this.hasBeenNotified(post.id, email);
        if (alreadyNotified) {
          console.log(`   │  ❌ SKIPPED: Already notified for this post`);
          console.log(`   └────────────────────────────────────────────`);
          continue;
        }
        console.log(`   │  ✅ Not yet notified`);

        // Check preferences
        console.log(`   │  ⏳ Checking notification preferences...`);
        const prefs = await this.getUserPreferences(email);
        console.log(`   │     - unsubscribed_all: ${prefs.unsubscribed_all}`);
        console.log(`   │     - notify_on_completion: ${prefs.notify_on_completion}`);
        if (prefs.unsubscribed_all || !prefs.notify_on_completion) {
          console.log(`   │  ❌ SKIPPED: User has disabled notifications`);
          console.log(`   └────────────────────────────────────────────`);
          continue;
        }
        console.log(`   │  ✅ Notifications enabled`);

        // Check access for private boards
        console.log(`   │  ⏳ Checking board access (is_private: ${post.is_private})...`);
        const hasAccess = await this.canUserAccessPost(post, email, tracking_code);
        if (!hasAccess) {
          console.log(`   │  ❌ SKIPPED: No access to this post/board`);
          console.log(`   └────────────────────────────────────────────`);
          continue;
        }
        console.log(`   │  ✅ Has access`);

        // Initialize user entry
        if (!userPostsMap[email]) {
          userPostsMap[email] = {
            email,
            userId: user_id,
            trackingCode: tracking_code,
            posts: [],
            reasonsMap: {}
          };
        }

        // Add post and reasons
        userPostsMap[email].posts.push(post);
        userPostsMap[email].reasonsMap[post.id] = reasons;
        console.log(`   │  ✅ ADDED to notification list!`);
        console.log(`   └────────────────────────────────────────────`);
      }
    }

    const finalUsers = Object.keys(userPostsMap);
    console.log('\n╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  📊 [DEBUG] groupPostsByUser - FINAL SUMMARY                    ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
    console.log(`   Total users who will receive emails: ${finalUsers.length}`);
    finalUsers.forEach(email => {
      const userData = userPostsMap[email];
      console.log(`   ✉️  ${email} → ${userData.posts.length} post(s)`);
    });
    console.log('══════════════════════════════════════════════════════════════════\n');

    return userPostsMap;
  },

  /**
   * Send batched completion emails to users
   */
  async sendBatchedNotifications(userPostsMap, organization) {
    const results = {
      sent: 0,
      failed: 0,
      errors: []
    };

    const emailPromises = [];

    for (const [email, userData] of Object.entries(userPostsMap)) {
      const { posts, reasonsMap, userId, trackingCode } = userData;

      // Get or create user name
      let userName = 'there';
      if (userId) {
        const { data: user } = await supabaseAdmin
          .from('users')
          .select('name, email')
          .eq('id', userId)
          .single();
        
        userName = user?.name || user?.email?.split('@')[0] || 'there';
      }

      // Generate email content
      const emailData = await emailTemplateService.generateBatchedCompletionEmail(
        posts,
        organization,
        userName,
        reasonsMap
      );

      // Queue email send (with rate limiting)
      const emailPromise = this.sendEmail(email, emailData.subject, emailData.html)
        .then(async (success) => {
          if (success) {
            results.sent++;
            
            // Log to notification history
            await this.logNotification({
              postIds: posts.map(p => p.id),
              recipientEmail: email,
              recipientUserId: userId,
              recipientTrackingCode: trackingCode,
              engagementReasons: reasonsMap,
              emailStatus: 'sent'
            });
          } else {
            results.failed++;
            
            // Log failure to notification history
            await this.logNotification({
              postIds: posts.map(p => p.id),
              recipientEmail: email,
              recipientUserId: userId,
              recipientTrackingCode: trackingCode,
              engagementReasons: reasonsMap,
              emailStatus: 'failed',
              errorMessage: 'Email service returned failure'
            });
          }
        })
        .catch((error) => {
          results.failed++;
          results.errors.push({ email, error: error.message });
          
          // Log error to notification history
          this.logNotification({
            postIds: posts.map(p => p.id),
            recipientEmail: email,
            recipientUserId: userId,
            recipientTrackingCode: trackingCode,
            engagementReasons: reasonsMap,
            emailStatus: 'failed',
            errorMessage: error.message
          }).catch(err => console.error('Failed to log error:', err));
        });

      emailPromises.push(emailPromise);
    }

    // Process all emails with concurrency limit
    await this.processEmailsWithRateLimit(emailPromises);

    return results;
  },

  /**
   * Send single email
   */
  async sendEmail(to, subject, html) {
    try {
      const result = await emailService.sendCompletionEmail(to, html, subject);
      
      // Check if email was actually sent
      if (result && result.success) {
        console.log(`✅ Email sent to ${to}`);
        return true;
      } else {
        console.error(`❌ Failed to send email to ${to}:`, result?.error || 'Unknown error');
        return false;
      }
    } catch (error) {
      console.error(`❌ Failed to send email to ${to}:`, error);
      return false;
    }
  },

  /**
   * Process emails with rate limiting (10 per second)
   */
  async processEmailsWithRateLimit(emailPromises) {
    const BATCH_SIZE = 10;
    const DELAY_MS = 1000;

    for (let i = 0; i < emailPromises.length; i += BATCH_SIZE) {
      const batch = emailPromises.slice(i, i + BATCH_SIZE);
      await Promise.all(batch);
      
      // Wait 1 second before next batch (rate limiting)
      if (i + BATCH_SIZE < emailPromises.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
    }
  },

  /**
   * Log notification to history
   */
  async logNotification({ postIds, recipientEmail, recipientUserId, recipientTrackingCode, engagementReasons, emailStatus, errorMessage }) {
    try {
      const { error } = await supabaseAdmin
        .from('notification_history')
        .insert({
          post_ids: postIds,
          recipient_email: recipientEmail,
          recipient_user_id: recipientUserId,
          recipient_tracking_code: recipientTrackingCode,
          notification_type: 'status_completed',
          engagement_reasons: engagementReasons,
          email_status: emailStatus,
          error_message: errorMessage
        });

      if (error) {
        console.error('Error logging notification:', error);
      }
    } catch (error) {
      console.error('Error in logNotification:', error);
    }
  }
};

module.exports = notificationService;
