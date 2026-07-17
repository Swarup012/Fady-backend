/**
 * Job Roles Service
 * Manages per-organization custom job roles.
 * Keys are immutable after creation; deletion is blocked for is_deletable=false rows.
 */

const { supabaseAdmin } = require('../config/supabase.config');

// ----------------------------------------------------------------
// Allowed Lucide icon names (whitelist for create / update)
// ----------------------------------------------------------------
const ALLOWED_ICONS = new Set([
  'User', 'UserCircle', 'Users', 'Briefcase', 'Rocket', 'Code', 'Code2',
  'Palette', 'TrendingUp', 'BarChart', 'BarChart2', 'BarChart3', 'LineChart',
  'PieChart', 'Headphones', 'Headset', 'MoreHorizontal', 'Wrench', 'Settings',
  'Settings2', 'Cog', 'Star', 'Heart', 'Zap', 'Shield', 'ShieldCheck', 'Crown',
  'Award', 'Trophy', 'Target', 'Crosshair', 'Globe', 'Globe2', 'Map', 'MapPin',
  'Flag', 'Bookmark', 'Tag', 'Hash', 'AtSign', 'Mail', 'MessageSquare',
  'MessageCircle', 'Phone', 'Video', 'Camera', 'Image', 'File', 'FileText',
  'Folder', 'Database', 'Server', 'Cloud', 'CloudUpload', 'Download', 'Upload',
  'Link', 'ExternalLink', 'Search', 'Bell', 'Home', 'Building', 'Building2',
  'Laptop', 'Smartphone', 'Tablet', 'Monitor', 'Cpu', 'HardDrive', 'Network',
  'Wifi', 'Bluetooth', 'Key', 'Lock', 'Unlock', 'Eye', 'EyeOff', 'Pencil',
  'Pen', 'Edit', 'Edit2', 'Edit3', 'Trash', 'Trash2', 'Plus', 'Minus',
  'Check', 'X', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'ChevronRight',
  'ChevronLeft', 'ChevronUp', 'ChevronDown', 'RefreshCw', 'RotateCw', 'Copy',
  'Clipboard', 'Package', 'Box', 'Archive', 'Inbox', 'Send', 'Share', 'Share2',
  'Megaphone', 'Speaker', 'Volume', 'Volume2', 'Music', 'Radio', 'Podcast',
  'BookOpen', 'Book', 'Library', 'GraduationCap', 'Lightbulb', 'Brain',
  'Microscope', 'FlaskConical', 'Stethoscope', 'Pill', 'Activity', 'Pulse',
  'Flame', 'Leaf', 'Tree', 'Sun', 'Moon', 'Cloud', 'Snowflake', 'Droplet',
  'Wind', 'Thermometer', 'Coffee', 'Pizza', 'ShoppingCart', 'ShoppingBag',
  'CreditCard', 'DollarSign', 'Euro', 'Wallet', 'Coins', 'HandshakeIcon',
  'Handshake', 'ThumbsUp', 'ThumbsDown', 'Smile', 'Frown', 'Meh',
  'HelpCircle', 'Info', 'AlertCircle', 'AlertTriangle', 'CheckCircle',
  'XCircle', 'Clock', 'Calendar', 'CalendarDays', 'Timer', 'Hourglass',
  'Gauge', 'Sliders', 'ToggleLeft', 'ToggleRight', 'Switch',
]);

const MAX_ROLES_PER_ORG = 20;

// Default roles seeded on org creation
const DEFAULT_ROLES = [
  { name: 'Founder / CEO',   key: 'founder',         icon: 'Rocket',     is_deletable: true  },
  { name: 'Product Manager', key: 'product_manager',  icon: 'Briefcase',  is_deletable: true  },
  { name: 'Developer',       key: 'developer',        icon: 'Code',       is_deletable: true  },
  { name: 'Designer',        key: 'designer',         icon: 'Palette',    is_deletable: true  },
  { name: 'Marketer',        key: 'marketer',         icon: 'TrendingUp', is_deletable: true  },
  { name: 'Other',           key: 'other',            icon: 'UserCircle', is_deletable: false },
];

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

/**
 * Slugify a human name to a snake_case key.
 * "Customer Success / Support" → "customer_success_support"
 */
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 60);
}

/**
 * Given a base key, find a non-colliding key within the org.
 * e.g. "marketing" → "marketing_2" if "marketing" already exists.
 */
async function generateUniqueKey(organizationId, baseKey) {
  let candidate = baseKey;
  let suffix = 2;

  while (true) {
    const { data } = await supabaseAdmin
      .from('organization_job_roles')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('key', candidate)
      .maybeSingle();

    if (!data) return candidate; // available
    candidate = `${baseKey}_${suffix++}`;
  }
}

// ----------------------------------------------------------------
// Service object
// ----------------------------------------------------------------
const jobRolesService = {

  /**
   * Seed default roles for a newly-created organization.
   * Called inside organizationService.createOrganization (after org is created).
   */
  async seedDefaultRoles(organizationId) {
    const rows = DEFAULT_ROLES.map(r => ({ ...r, organization_id: organizationId }));
    const { error } = await supabaseAdmin
      .from('organization_job_roles')
      .insert(rows);

    if (error) {
      console.error('❌ Failed to seed default job roles:', error);
      throw error;
    }
    console.log(`✅ Seeded ${rows.length} default job roles for org ${organizationId}`);
  },

  /**
   * GET /job-roles  — list all roles for an org (any member)
   */
  async listRoles(organizationId) {
    const { data, error } = await supabaseAdmin
      .from('organization_job_roles')
      .select('id, name, key, icon, is_deletable, created_at')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  },

  /**
   * POST /job-roles  — create a custom role (admin/owner only)
   */
  async createRole(organizationId, { name, icon }) {
    // Validate name
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw Object.assign(new Error('name is required'), { status: 400 });
    }
    const trimmedName = name.trim().substring(0, 100);

    // Validate icon
    if (!icon || !ALLOWED_ICONS.has(icon)) {
      throw Object.assign(
        new Error(`Invalid icon "${icon}". Must be one of the allowed Lucide icon names.`),
        { status: 400 }
      );
    }

    // Enforce org cap
    const { count } = await supabaseAdmin
      .from('organization_job_roles')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId);

    if (count >= MAX_ROLES_PER_ORG) {
      throw Object.assign(
        new Error(`Role limit reached. Organizations can have at most ${MAX_ROLES_PER_ORG} job roles.`),
        { status: 400 }
      );
    }

    // Generate a unique, collision-safe key
    const baseKey = slugify(trimmedName);
    const key = await generateUniqueKey(organizationId, baseKey);

    const { data, error } = await supabaseAdmin
      .from('organization_job_roles')
      .insert({ organization_id: organizationId, name: trimmedName, key, icon, is_deletable: true })
      .select()
      .single();

    if (error) throw error;
    console.log(`✅ Created job role "${data.name}" (${data.key}) for org ${organizationId}`);
    return data;
  },

  /**
   * PUT /job-roles/:roleId  — update name and/or icon only (key is immutable)
   */
  async updateRole(organizationId, roleId, { name, icon }) {
    // Fetch existing role to verify ownership + get current values
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('organization_job_roles')
      .select('*')
      .eq('id', roleId)
      .eq('organization_id', organizationId)
      .single();

    if (fetchErr || !existing) {
      throw Object.assign(new Error('Job role not found'), { status: 404 });
    }

    const updates = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        throw Object.assign(new Error('name cannot be empty'), { status: 400 });
      }
      updates.name = name.trim().substring(0, 100);
    }

    if (icon !== undefined) {
      if (!ALLOWED_ICONS.has(icon)) {
        throw Object.assign(
          new Error(`Invalid icon "${icon}". Must be one of the allowed Lucide icon names.`),
          { status: 400 }
        );
      }
      updates.icon = icon;
    }

    if (Object.keys(updates).length === 0) {
      return existing; // nothing to update
    }

    const { data, error } = await supabaseAdmin
      .from('organization_job_roles')
      .update(updates)
      .eq('id', roleId)
      .eq('organization_id', organizationId)
      .select()
      .single();

    if (error) throw error;
    console.log(`✅ Updated job role "${data.name}" for org ${organizationId}`);
    return data;
  },

  /**
   * DELETE /job-roles/:roleId  — remove a role (admin/owner only)
   * Runs cleanup in a pseudo-transaction (Supabase JS doesn't expose real txns,
   * so we do ordered updates + delete).
   */
  async deleteRole(organizationId, roleId) {
    // Fetch role
    const { data: role, error: fetchErr } = await supabaseAdmin
      .from('organization_job_roles')
      .select('*')
      .eq('id', roleId)
      .eq('organization_id', organizationId)
      .single();

    if (fetchErr || !role) {
      throw Object.assign(new Error('Job role not found'), { status: 404 });
    }

    // Block deletion of non-deletable roles (e.g. 'other')
    if (!role.is_deletable) {
      throw Object.assign(
        new Error(`The "${role.name}" role cannot be deleted.`),
        { status: 400 }
      );
    }

    // 1. Reassign members who have this role → 'other'
    await supabaseAdmin
      .from('organization_members')
      .update({ job_role: 'other' })
      .eq('organization_id', organizationId)
      .eq('job_role', role.key);

    // 2. Remove the key from all board visibility arrays in this org
    // Supabase doesn't support array_remove via .update() directly, so we use rpc or raw SQL.
    // We'll use a stored procedure if available, otherwise do an in-JS approach with select+update.
    const { data: affectedBoards } = await supabaseAdmin
      .from('boards')
      .select('id, visible_to_roles')
      .eq('organization_id', organizationId)
      .contains('visible_to_roles', [role.key]);

    if (affectedBoards && affectedBoards.length > 0) {
      for (const board of affectedBoards) {
        const newRoles = (board.visible_to_roles || []).filter(r => r !== role.key);
        await supabaseAdmin
          .from('boards')
          .update({ visible_to_roles: newRoles })
          .eq('id', board.id);
      }
      console.log(`✅ Removed role "${role.key}" from ${affectedBoards.length} board(s)`);
    }

    // 3. Delete the role itself
    const { error: delErr } = await supabaseAdmin
      .from('organization_job_roles')
      .delete()
      .eq('id', roleId)
      .eq('organization_id', organizationId);

    if (delErr) throw delErr;
    console.log(`🗑️ Deleted job role "${role.name}" (${role.key}) from org ${organizationId}`);
    return { success: true, deletedKey: role.key };
  },

  // ----------------------------------------------------------------
  // Expose helpers for other services
  // ----------------------------------------------------------------
  ALLOWED_ICONS,
  DEFAULT_ROLES,
};

module.exports = jobRolesService;
