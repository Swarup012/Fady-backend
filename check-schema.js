require('dotenv').config();

async function checkSchema() {
  const url = `${process.env.SUPABASE_URL}/rest/v1/?apikey=${process.env.SUPABASE_SERVICE_KEY}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
      }
    });
    
    if (!response.ok) {
      console.error(`Failed to fetch schema: ${response.statusText}`);
      return;
    }
    
    const spec = await response.json();
    const tables = spec.definitions || spec.components?.schemas;
    
    if (!tables) {
      console.error("Could not find table definitions in OpenAPI spec");
      return;
    }

    // List of table:column mappings used in our policies
    const columnsToCheck = [
      { table: 'organizations', col: 'id' },
      { table: 'organization_members', col: 'organization_id' },
      { table: 'organization_members', col: 'user_id' },
      { table: 'organization_invitations', col: 'organization_id' },
      { table: 'organization_job_roles', col: 'organization_id' },
      { table: 'users', col: 'id' },
      { table: 'password_reset_tokens', col: 'user_id' },
      { table: 'boards', col: 'organization_id' },
      { table: 'posts', col: 'organization_id' },
      { table: 'posts', col: 'author_id' },
      { table: 'comments', col: 'post_id' },
      { table: 'comments', col: 'author_id' },
      { table: 'comment_likes', col: 'comment_id' },
      { table: 'comment_likes', col: 'user_id' },
      { table: 'upvotes', col: 'post_id' },
      { table: 'upvotes', col: 'user_id' },
      { table: 'status_history', col: 'post_id' },
      { table: 'tracked_users', col: 'organization_id' },
      { table: 'tracked_users_daily_peaks', col: 'organization_id' },
      { table: 'org_end_users', col: 'organization_id' },
      { table: 'widget_instances', col: 'organization_id' },
      { table: 'webhooks', col: 'organization_id' },
      { table: 'webhook_events', col: 'organization_id' },
      { table: 'webhook_deliveries', col: 'webhook_id' },
      { table: 'roadmaps', col: 'organization_id' },
      { table: 'roadmap_items', col: 'roadmap_id' },
      { table: 'roadmap_votes', col: 'roadmap_item_id' },
      { table: 'roadmap_votes', col: 'user_id' },
      { table: 'roadmap_comments', col: 'roadmap_item_id' },
      { table: 'roadmap_comments', col: 'author_id' },
      { table: 'roadmap_updates', col: 'roadmap_item_id' },
      { table: 'roadmap_feedback_links', col: 'roadmap_item_id' },
      { table: 'cluster_labels', col: 'board_id' },
      { table: 'notification_queue', col: 'post_id' }, 
      { table: 'notification_preferences', col: 'user_id' },
      { table: 'notification_history', col: 'recipient_user_id' },
      { table: 'subscription_history', col: 'organization_id' },
      { table: 'stripe_events', col: 'organization_id' },
      { table: 'overage_charges', col: 'organization_id' },
      { table: 'custom_domains', col: 'organization_id' },
      { table: 'changelogs', col: 'organization_id' },
      { table: 'changelogs', col: 'author_id' },
      { table: 'changelog_links', col: 'changelog_id' }
    ];

    let hasErrors = false;

    console.log("=== SCHEMA VERIFICATION ===");
    for (const { table, col } of columnsToCheck) {
      const tableDef = tables[table];
      if (!tableDef) {
        console.error(`❌ Table '${table}' does NOT exist in schema!`);
        hasErrors = true;
        continue;
      }
      
      const properties = tableDef.properties;
      if (!properties || !properties[col]) {
        console.error(`❌ Column '${col}' does NOT exist in table '${table}'!`);
        hasErrors = true;
      } else {
        console.log(`✅ ${table}.${col} exists`);
      }
    }

    if (!hasErrors) {
      console.log("\n✅ ALL TABLES AND COLUMNS VERIFIED SUCCESSFULLY.");
    } else {
      console.log("\n⚠️  MISMATCHES FOUND. SEE ERRORS ABOVE.");
    }
    
  } catch (err) {
    console.error(err);
  }
}

checkSchema();
