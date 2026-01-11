// src/jobs/scheduler.js

/**
 * =====================================================
 * CRON JOB SCHEDULER
 * =====================================================
 * Central scheduler for all recurring jobs
 * Uses node-cron for reliable scheduling
 * =====================================================
 */

const cron = require('node-cron');
const { 
  resetMonthlyTrackedUsersCache, 
  verifyReset 
} = require('./tracked-users-reset.job');
const notificationQueueService = require('../services/notification-queue.service');
const overageService = require('../services/overage.service');
const trialService = require('../services/trial.service');

/**
 * Initialize all scheduled jobs
 */
function initializeScheduler() {
  console.log('🕐 Initializing cron scheduler...');
  
  // ============================================
  // MONTHLY RESET JOB
  // ============================================
  // Schedule: 1st day of every month at 00:01 UTC
  // Cron: '1 0 1 * *' = minute=1, hour=0, day=1, any month, any day-of-week
  // ============================================
  const monthlyResetJob = cron.schedule('1 0 1 * *', async () => {
    console.log('\n' + '='.repeat(60));
    console.log('🔄 MONTHLY RESET JOB TRIGGERED');
    console.log('='.repeat(60) + '\n');
    
    try {
      // Run reset
      const result = await resetMonthlyTrackedUsersCache();
      
      // Verify it worked
      const verified = await verifyReset();
      
      if (!verified) {
        console.error('⚠️  Reset verification failed! Manual check required.');
      }
      
      console.log('\n' + '='.repeat(60));
      console.log('✅ MONTHLY RESET JOB COMPLETED');
      console.log('='.repeat(60) + '\n');
      
    } catch (error) {
      console.error('\n' + '='.repeat(60));
      console.error('❌ MONTHLY RESET JOB FAILED');
      console.error('='.repeat(60));
      console.error('Error:', error);
      console.error('\n');
      
      // TODO: Send alert to admin (email/Slack/Discord)
      // await sendAdminAlert('Monthly reset failed', error);
    }
  }, {
    scheduled: true,
    timezone: "UTC" // Always use UTC for consistency
  });
  
  console.log('✅ Monthly reset job scheduled (1st of month at 00:01 UTC)');
  
  // ============================================
  // NOTIFICATION QUEUE PROCESSOR
  // ============================================
  // Schedule: Every minute
  // Cron: '* * * * *' = every minute
  // Processes pending email notifications in batches
  // ============================================
  const notificationQueueJob = cron.schedule('* * * * *', async () => {
    try {
      await notificationQueueService.processNotificationQueue();
    } catch (error) {
      console.error('❌ Notification queue processing failed:', error);
    }
  }, {
    scheduled: true,
    timezone: "UTC"
  });
  
  console.log('✅ Notification queue processor scheduled (every minute)');
  
  // ============================================
  // CLEANUP OLD NOTIFICATIONS
  // ============================================
  // Schedule: Daily at 02:00 UTC
  // Cron: '0 2 * * *' = minute=0, hour=2, every day
  // Cleans up old processed notifications (older than 30 days)
  // ============================================
  const notificationCleanupJob = cron.schedule('0 2 * * *', async () => {
    console.log('🧹 Running notification cleanup job...');
    try {
      await notificationQueueService.cleanupOldNotifications();
    } catch (error) {
      console.error('❌ Notification cleanup failed:', error);
    }
  }, {
    scheduled: true,
    timezone: "UTC"
  });
  
  console.log('✅ Notification cleanup job scheduled (daily at 02:00 UTC)');
  
  // ============================================
  // DAILY PEAK TRACKING (Overage Billing)
  // ============================================
  // Schedule: Daily at 00:00 UTC (midnight)
  // Cron: '0 0 * * *' = minute=0, hour=0, every day
  // Updates peak tracked users for all organizations
  // ============================================
  const dailyPeakJob = cron.schedule('0 0 * * *', async () => {
    console.log('📊 Running daily peak tracking update...');
    try {
      await overageService.updateAllPeaks();
      console.log('✅ Daily peak tracking complete');
    } catch (error) {
      console.error('❌ Daily peak tracking failed:', error);
    }
  }, {
    scheduled: true,
    timezone: "UTC"
  });
  
  console.log('✅ Daily peak tracking job scheduled (daily at 00:00 UTC)');
  
  // ============================================
  // MONTHLY OVERAGE BILLING
  // ============================================
  // Schedule: 1st day of every month at 00:05 UTC
  // Cron: '5 0 1 * *' = minute=5, hour=0, day=1
  // Calculates overage charges and reports to Stripe
  // ============================================
  const monthlyBillingJob = cron.schedule('5 0 1 * *', async () => {
    console.log('\n' + '='.repeat(60));
    console.log('💰 MONTHLY BILLING JOB TRIGGERED');
    console.log('='.repeat(60) + '\n');
    
    try {
      const results = await overageService.processMonthlyBilling();
      
      console.log('\n' + '='.repeat(60));
      console.log('✅ MONTHLY BILLING JOB COMPLETED');
      console.log(`   Total: ${results.total} | Charged: ${results.charged} | No Charge: ${results.noCharge} | Errors: ${results.errors}`);
      console.log('='.repeat(60) + '\n');
      
    } catch (error) {
      console.error('\n' + '='.repeat(60));
      console.error('❌ MONTHLY BILLING JOB FAILED');
      console.error('='.repeat(60));
      console.error('Error:', error);
      console.error('\n');
    }
  }, {
    scheduled: true,
    timezone: "UTC"
  });
  
  console.log('✅ Monthly billing job scheduled (1st of month at 00:05 UTC)');
  
  // ============================================
  // TRIAL REMINDERS
  // ============================================
  // Schedule: Daily at 10:00 UTC
  // Cron: '0 10 * * *' = minute=0, hour=10, every day
  // Sends trial reminder emails (7 days, 3 days, 1 day before end)
  // ============================================
  const trialRemindersJob = cron.schedule('0 10 * * *', async () => {
    console.log('📧 Running trial reminder check...');
    try {
      await trialService.sendTrialReminders();
      console.log('✅ Trial reminders processed');
    } catch (error) {
      console.error('❌ Trial reminders failed:', error);
    }
  }, {
    scheduled: true,
    timezone: "UTC"
  });
  
  console.log('✅ Trial reminders job scheduled (daily at 10:00 UTC)');
  
  // ============================================
  // EXPIRED TRIALS CHECK
  // ============================================
  // Schedule: Every 6 hours
  // Cron: '0 */6 * * *' = minute=0, every 6 hours
  // Checks for expired trials and converts/cancels them
  // ============================================
  const expiredTrialsJob = cron.schedule('0 */6 * * *', async () => {
    console.log('🔍 Checking for expired trials...');
    try {
      await trialService.checkExpiredTrials();
      console.log('✅ Expired trials check complete');
    } catch (error) {
      console.error('❌ Expired trials check failed:', error);
    }
  }, {
    scheduled: true,
    timezone: "UTC"
  });
  
  console.log('✅ Expired trials check scheduled (every 6 hours)');
  
  // ============================================
  // FUTURE JOBS (Commented out - implement when needed)
  // ============================================
  
  // Daily cache verification (optional)
  // const dailyVerificationJob = cron.schedule('0 3 * * *', async () => {
  //   console.log('🔍 Running daily cache verification...');
  //   await verifyReset();
  // }, { timezone: "UTC" });
  
  // Weekly analytics report (optional)
  // const weeklyReportJob = cron.schedule('0 9 * * 1', async () => {
  //   console.log('📊 Generating weekly analytics report...');
  //   // await generateWeeklyReport();
  // }, { timezone: "UTC" });
  
  console.log('✅ Scheduler initialized successfully\n');
  
  return {
    monthlyResetJob,
    notificationQueueJob,
    notificationCleanupJob,
    dailyPeakJob,
    monthlyBillingJob,
    trialRemindersJob,
    expiredTrialsJob
  };
}

/**
 * Stop all scheduled jobs (for graceful shutdown)
 */
function stopScheduler(jobs) {
  console.log('🛑 Stopping scheduled jobs...');
  
  if (jobs?.monthlyResetJob) {
    jobs.monthlyResetJob.stop();
    console.log('  - Monthly reset job stopped');
  }
  
  if (jobs?.notificationQueueJob) {
    jobs.notificationQueueJob.stop();
    console.log('  - Notification queue job stopped');
  }
  
  if (jobs?.notificationCleanupJob) {
    jobs.notificationCleanupJob.stop();
    console.log('  - Notification cleanup job stopped');
  }
  
  if (jobs?.dailyPeakJob) {
    jobs.dailyPeakJob.stop();
    console.log('  - Daily peak tracking job stopped');
  }
  
  if (jobs?.monthlyBillingJob) {
    jobs.monthlyBillingJob.stop();
    console.log('  - Monthly billing job stopped');
  }
  
  if (jobs?.trialRemindersJob) {
    jobs.trialRemindersJob.stop();
    console.log('  - Trial reminders job stopped');
  }
  
  if (jobs?.expiredTrialsJob) {
    jobs.expiredTrialsJob.stop();
    console.log('  - Expired trials job stopped');
  }
  
  console.log('✅ All jobs stopped');
}

/**
 * Get next run time for a cron expression
 */
function getNextRunTime(cronExpression) {
  try {
    const job = cron.schedule(cronExpression, () => {}, { scheduled: false });
    // node-cron doesn't expose next run time directly
    // This is a placeholder - you'd need a library like cron-parser for exact times
    return 'Next run: 1st of next month at 00:01 UTC';
  } catch (error) {
    return 'Invalid cron expression';
  }
}

/**
 * Manual trigger for testing (use with care in production)
 */
async function manualTriggerReset() {
  console.log('⚠️  MANUAL TRIGGER - Running monthly reset immediately...');
  
  try {
    const result = await resetMonthlyTrackedUsersCache();
    const verified = await verifyReset();
    
    return {
      success: true,
      result,
      verified
    };
  } catch (error) {
    console.error('❌ Manual trigger failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  initializeScheduler,
  stopScheduler,
  getNextRunTime,
  manualTriggerReset
};
