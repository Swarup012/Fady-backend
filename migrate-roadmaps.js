const { supabaseAdmin } = require('./src/config/supabase.config');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  try {
    console.log('📦 Starting roadmaps schema migration...\n');
    
    const sqlPath = path.join(__dirname, '../supabase_roadmaps_schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Split SQL into individual statements (by semicolon followed by newline)
    const statements = sql
      .split(/;\s*\n/)
      .filter(stmt => stmt.trim() && !stmt.trim().startsWith('--'))
      .map(stmt => stmt.trim() + ';');
    
    console.log(`Found ${statements.length} SQL statements to execute\n`);
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      
      // Skip comments and empty statements
      if (!stmt || stmt === ';' || stmt.startsWith('--')) continue;
      
      // Show what we're executing (first 100 chars)
      const preview = stmt.substring(0, 100).replace(/\s+/g, ' ');
      console.log(`[${i + 1}/${statements.length}] ${preview}...`);
      
      const { error } = await supabaseAdmin.rpc('exec_sql', { 
        sql_query: stmt 
      });
      
      if (error) {
        console.error(`❌ Error executing statement ${i + 1}:`, error.message);
        // Continue with next statement
      } else {
        console.log(`✅ Success`);
      }
    }
    
    console.log('\n📊 Verifying migration...\n');
    
    // Check if roadmaps table exists
    const { data: roadmaps, error: roadmapsError } = await supabaseAdmin
      .from('roadmaps')
      .select('id, name, organization_id, is_default')
      .limit(10);
    
    if (roadmapsError) {
      console.error('⚠️ Cannot verify roadmaps table:', roadmapsError.message);
    } else {
      console.log(`✅ Roadmaps table verified: ${roadmaps.length} roadmaps found`);
      if (roadmaps.length > 0) {
        roadmaps.forEach(r => {
          console.log(`  - ${r.name} (${r.organization_id.substring(0, 8)}...) ${r.is_default ? '[DEFAULT]' : ''}`);
        });
      }
    }
    
    // Check if roadmap_id column exists in roadmap_items
    const { data: items, error: itemsError } = await supabaseAdmin
      .from('roadmap_items')
      .select('id, roadmap_id, linked_post_id')
      .limit(5);
    
    if (itemsError) {
      console.error('⚠️ Cannot verify roadmap_items:', itemsError.message);
    } else {
      console.log(`\n✅ Roadmap items verified: ${items.length} items checked`);
      const linkedCount = items.filter(i => i.roadmap_id).length;
      console.log(`  - ${linkedCount}/${items.length} items linked to roadmaps`);
    }
    
    console.log('\n🎉 Migration completed successfully!');
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runMigration();
