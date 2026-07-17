/**
 * Job Roles Controller
 * Handles CRUD for per-organization custom job roles.
 * All routes require authentication; write routes require admin or owner.
 */

const jobRolesService = require('../services/job-roles.service');
const { supabaseAdmin } = require('../config/supabase.config');

// ----------------------------------------------------------------
// Auth helper: verify the requesting user is admin or owner in the org
// ----------------------------------------------------------------
async function requireAdminOrOwner(userId, organizationId) {
  const { data: membership, error } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .single();

  if (error || !membership) {
    throw Object.assign(new Error('You are not a member of this organization'), { status: 403 });
  }

  if (!['owner', 'admin'].includes(membership.role)) {
    throw Object.assign(new Error('Only admins and owners can manage job roles'), { status: 403 });
  }
}

// ----------------------------------------------------------------
// GET /api/organizations/:orgId/job-roles
// ----------------------------------------------------------------
exports.listJobRoles = async (req, res) => {
  try {
    const { orgId } = req.params;
    const roles = await jobRolesService.listRoles(orgId);
    res.json({ success: true, data: { roles } });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

// ----------------------------------------------------------------
// POST /api/organizations/:orgId/job-roles
// ----------------------------------------------------------------
exports.createJobRole = async (req, res) => {
  try {
    const { orgId } = req.params;
    const userId = req.user.id;

    await requireAdminOrOwner(userId, orgId);

    // Silently ignore 'key' in body — it's server-generated
    const { name, icon } = req.body;

    const role = await jobRolesService.createRole(orgId, { name, icon });
    res.status(201).json({ success: true, data: { role } });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

// ----------------------------------------------------------------
// PUT /api/organizations/:orgId/job-roles/:roleId
// ----------------------------------------------------------------
exports.updateJobRole = async (req, res) => {
  try {
    const { orgId, roleId } = req.params;
    const userId = req.user.id;

    await requireAdminOrOwner(userId, orgId);

    // key is immutable — 400 if caller tried to change it
    if (req.body.key !== undefined) {
      return res.status(400).json({
        success: false,
        error: 'The "key" field is immutable and cannot be updated after creation.',
      });
    }

    const { name, icon } = req.body;
    const role = await jobRolesService.updateRole(orgId, roleId, { name, icon });
    res.json({ success: true, data: { role } });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

// ----------------------------------------------------------------
// DELETE /api/organizations/:orgId/job-roles/:roleId
// ----------------------------------------------------------------
exports.deleteJobRole = async (req, res) => {
  try {
    const { orgId, roleId } = req.params;
    const userId = req.user.id;

    await requireAdminOrOwner(userId, orgId);

    const result = await jobRolesService.deleteRole(orgId, roleId);
    res.json({ success: true, data: result });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
};
