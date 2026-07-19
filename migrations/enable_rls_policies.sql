-- ============================================================
-- Migration: Enable RLS + Add Row-Level Security Policies
-- Purpose: Defense-in-depth against direct/anon Supabase access.
--          The backend's supabaseAdmin (service_role) bypasses all
--          policies below — existing functionality is unaffected.
--
-- Helper used by all tenant-scoped policies:
--   auth.uid()  → the Supabase Auth user ID (JWT sub)
--
-- Org-membership check function (created once, reused by policies):
-- ============================================================

BEGIN;

-- ─── 0. HELPER FUNCTIONS ────────────────────────────────────

-- Returns TRUE if auth.uid() is a member of the given organization_id
CREATE OR REPLACE FUNCTION is_org_member(org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = org_id
      AND user_id = auth.uid()
  );
$$;

-- Returns TRUE if auth.uid() is an owner OR admin of the given org
CREATE OR REPLACE FUNCTION is_org_admin(org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = org_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  );
$$;

-- Returns TRUE if auth.uid() is the owner of the given org
CREATE OR REPLACE FUNCTION is_org_owner(org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = org_id
      AND user_id = auth.uid()
      AND role = 'owner'
  );
$$;

GRANT EXECUTE ON FUNCTION is_org_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION is_org_admin(UUID)  TO authenticated;
GRANT EXECUTE ON FUNCTION is_org_owner(UUID)  TO authenticated;


-- ============================================================
-- 1. organizations
-- ============================================================
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- Any member of the org can read their org row
CREATE POLICY "org_select_member"
  ON organizations FOR SELECT
  TO authenticated
  USING (is_org_member(id));

-- Only the owner can update org settings
CREATE POLICY "org_update_owner"
  ON organizations FOR UPDATE
  TO authenticated
  USING (is_org_owner(id));

-- INSERT/DELETE are always done via service_role; block anon direct access
-- (no policy = deny for authenticated non-service_role)


-- ============================================================
-- 2. organization_members
-- ============================================================
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

-- Members can see all members of their own org
CREATE POLICY "org_members_select_member"
  ON organization_members FOR SELECT
  TO authenticated
  USING (is_org_member(organization_id));

-- Only owners can add/change/remove members (INSERT/UPDATE/DELETE)
CREATE POLICY "org_members_insert_owner"
  ON organization_members FOR INSERT
  TO authenticated
  WITH CHECK (is_org_owner(organization_id));

CREATE POLICY "org_members_update_owner"
  ON organization_members FOR UPDATE
  TO authenticated
  USING (is_org_owner(organization_id));

CREATE POLICY "org_members_delete_owner"
  ON organization_members FOR DELETE
  TO authenticated
  USING (is_org_owner(organization_id));


-- ============================================================
-- 3. organization_invitations
-- ============================================================
ALTER TABLE organization_invitations ENABLE ROW LEVEL SECURITY;

-- Admins/owners can read all pending invitations for their org
CREATE POLICY "org_invitations_select_admin"
  ON organization_invitations FOR SELECT
  TO authenticated
  USING (is_org_admin(organization_id));


-- Only admins/owners can create or revoke invitations
CREATE POLICY "org_invitations_insert_admin"
  ON organization_invitations FOR INSERT
  TO authenticated
  WITH CHECK (is_org_admin(organization_id));

CREATE POLICY "org_invitations_delete_admin"
  ON organization_invitations FOR DELETE
  TO authenticated
  USING (is_org_admin(organization_id));


-- ============================================================
-- 4. organization_job_roles
-- ============================================================
ALTER TABLE organization_job_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "job_roles_select_member"
  ON organization_job_roles FOR SELECT
  TO authenticated
  USING (is_org_member(organization_id));

CREATE POLICY "job_roles_insert_admin"
  ON organization_job_roles FOR INSERT
  TO authenticated
  WITH CHECK (is_org_admin(organization_id));

CREATE POLICY "job_roles_update_admin"
  ON organization_job_roles FOR UPDATE
  TO authenticated
  USING (is_org_admin(organization_id));

CREATE POLICY "job_roles_delete_admin"
  ON organization_job_roles FOR DELETE
  TO authenticated
  USING (is_org_admin(organization_id));


-- ============================================================
-- 5. users
--    (global table, but users should only see/edit themselves
--     or members of their shared org)
-- ============================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- A user can always read their own row
CREATE POLICY "users_select_self"
  ON users FOR SELECT
  TO authenticated
  USING (id = auth.uid());

-- Org members can see each other's profile rows (name, email, avatar_url)
-- Uses a sub-select to find orgs they share
CREATE POLICY "users_select_shared_org"
  ON users FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om1
      JOIN organization_members om2
        ON om1.organization_id = om2.organization_id
      WHERE om1.user_id = auth.uid()
        AND om2.user_id = users.id
    )
  );

-- A user can update only their own profile
CREATE POLICY "users_update_self"
  ON users FOR UPDATE
  TO authenticated
  USING (id = auth.uid());


-- ============================================================
-- 6. password_reset_tokens
--    (non-tenant; user-scoped)
-- ============================================================
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- Users can read only their own reset tokens
CREATE POLICY "prt_select_self"
  ON password_reset_tokens FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- No direct INSERT/DELETE from client — always via service_role


-- ============================================================
-- 7. boards
-- ============================================================
ALTER TABLE boards ENABLE ROW LEVEL SECURITY;

-- Members can see their org's boards
CREATE POLICY "boards_select_member"
  ON boards FOR SELECT
  TO authenticated
  USING (is_org_member(organization_id));

-- Admins/owners can create boards
CREATE POLICY "boards_insert_admin"
  ON boards FOR INSERT
  TO authenticated
  WITH CHECK (is_org_admin(organization_id));

-- Admins/owners can update boards
CREATE POLICY "boards_update_admin"
  ON boards FOR UPDATE
  TO authenticated
  USING (is_org_admin(organization_id));

-- Admins/owners can delete boards
CREATE POLICY "boards_delete_admin"
  ON boards FOR DELETE
  TO authenticated
  USING (is_org_admin(organization_id));


-- ============================================================
-- 8. posts
-- ============================================================
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

-- Members can see all non-archived posts in their org
CREATE POLICY "posts_select_member"
  ON posts FOR SELECT
  TO authenticated
  USING (is_org_member(organization_id));

-- Any authenticated user (including tracked users via service_role) can create posts
-- Direct client inserts are scoped to the user's org
CREATE POLICY "posts_insert_member"
  ON posts FOR INSERT
  TO authenticated
  WITH CHECK (is_org_member(organization_id));

-- Authors, admins, and owners can update
CREATE POLICY "posts_update_admin_or_author"
  ON posts FOR UPDATE
  TO authenticated
  USING (
    author_id = auth.uid()
    OR is_org_admin(organization_id)
  );

-- Admins/owners can delete; authors can delete their own
CREATE POLICY "posts_delete_admin_or_author"
  ON posts FOR DELETE
  TO authenticated
  USING (
    author_id = auth.uid()
    OR is_org_admin(organization_id)
  );


-- ============================================================
-- 9. comments
-- ============================================================
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

-- Members can see comments on posts in their org
CREATE POLICY "comments_select_member"
  ON comments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = comments.post_id
        AND is_org_member(p.organization_id)
    )
  );

-- Members can add comments
CREATE POLICY "comments_insert_member"
  ON comments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = post_id
        AND is_org_member(p.organization_id)
    )
  );

-- Authors and admins can update comments
CREATE POLICY "comments_update_admin_or_author"
  ON comments FOR UPDATE
  TO authenticated
  USING (
    author_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = comments.post_id
        AND is_org_admin(p.organization_id)
    )
  );

-- Authors and admins can delete comments
CREATE POLICY "comments_delete_admin_or_author"
  ON comments FOR DELETE
  TO authenticated
  USING (
    author_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = comments.post_id
        AND is_org_admin(p.organization_id)
    )
  );


-- ============================================================
-- 10. comment_likes
-- ============================================================
ALTER TABLE comment_likes ENABLE ROW LEVEL SECURITY;

-- Members can see likes on comments they can see
CREATE POLICY "comment_likes_select_member"
  ON comment_likes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM comments c
      JOIN posts p ON p.id = c.post_id
      WHERE c.id = comment_likes.comment_id
        AND is_org_member(p.organization_id)
    )
  );

-- A user can like/unlike
CREATE POLICY "comment_likes_insert_self"
  ON comment_likes FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "comment_likes_delete_self"
  ON comment_likes FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- ============================================================
-- 11. upvotes
-- ============================================================
ALTER TABLE upvotes ENABLE ROW LEVEL SECURITY;

-- Members can see upvotes for posts in their org
CREATE POLICY "upvotes_select_member"
  ON upvotes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = upvotes.post_id
        AND is_org_member(p.organization_id)
    )
  );

-- A user can upvote
CREATE POLICY "upvotes_insert_self"
  ON upvotes FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- A user can remove their own upvote
CREATE POLICY "upvotes_delete_self"
  ON upvotes FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- ============================================================
-- 12. status_history
-- ============================================================
ALTER TABLE status_history ENABLE ROW LEVEL SECURITY;

-- Members can see status history for posts in their org
CREATE POLICY "status_history_select_member"
  ON status_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = status_history.post_id
        AND is_org_member(p.organization_id)
    )
  );

-- Only admins/owners write status history (via service_role in practice)
CREATE POLICY "status_history_insert_admin"
  ON status_history FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = post_id
        AND is_org_admin(p.organization_id)
    )
  );


-- ============================================================
-- 13. tracked_users
-- ============================================================
ALTER TABLE tracked_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tracked_users_select_member"
  ON tracked_users FOR SELECT
  TO authenticated
  USING (is_org_member(organization_id));

CREATE POLICY "tracked_users_insert_admin"
  ON tracked_users FOR INSERT
  TO authenticated
  WITH CHECK (is_org_admin(organization_id));

CREATE POLICY "tracked_users_update_admin"
  ON tracked_users FOR UPDATE
  TO authenticated
  USING (is_org_admin(organization_id));

CREATE POLICY "tracked_users_delete_admin"
  ON tracked_users FOR DELETE
  TO authenticated
  USING (is_org_admin(organization_id));


-- ============================================================
-- 14. tracked_users_daily_peaks
-- ============================================================
ALTER TABLE tracked_users_daily_peaks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_peaks_select_admin"
  ON tracked_users_daily_peaks FOR SELECT
  TO authenticated
  USING (is_org_admin(organization_id));

-- INSERT/UPDATE only via service_role (billing jobs)


-- ============================================================
-- 15. org_end_users
-- ============================================================
ALTER TABLE org_end_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_end_users_select_member"
  ON org_end_users FOR SELECT
  TO authenticated
  USING (is_org_member(organization_id));

CREATE POLICY "org_end_users_insert_admin"
  ON org_end_users FOR INSERT
  TO authenticated
  WITH CHECK (is_org_admin(organization_id));

CREATE POLICY "org_end_users_update_admin"
  ON org_end_users FOR UPDATE
  TO authenticated
  USING (is_org_admin(organization_id));

CREATE POLICY "org_end_users_delete_admin"
  ON org_end_users FOR DELETE
  TO authenticated
  USING (is_org_admin(organization_id));


-- ============================================================
-- 16. widget_instances
-- ============================================================
ALTER TABLE widget_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "widget_instances_select_member"
  ON widget_instances FOR SELECT
  TO authenticated
  USING (is_org_member(organization_id));

CREATE POLICY "widget_instances_insert_admin"
  ON widget_instances FOR INSERT
  TO authenticated
  WITH CHECK (is_org_admin(organization_id));

CREATE POLICY "widget_instances_update_admin"
  ON widget_instances FOR UPDATE
  TO authenticated
  USING (is_org_admin(organization_id));

CREATE POLICY "widget_instances_delete_admin"
  ON widget_instances FOR DELETE
  TO authenticated
  USING (is_org_admin(organization_id));


-- ============================================================
-- 17. webhooks
-- ============================================================
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "webhooks_select_admin"
  ON webhooks FOR SELECT
  TO authenticated
  USING (is_org_admin(organization_id));

CREATE POLICY "webhooks_insert_admin"
  ON webhooks FOR INSERT
  TO authenticated
  WITH CHECK (is_org_admin(organization_id));

CREATE POLICY "webhooks_update_admin"
  ON webhooks FOR UPDATE
  TO authenticated
  USING (is_org_admin(organization_id));

CREATE POLICY "webhooks_delete_admin"
  ON webhooks FOR DELETE
  TO authenticated
  USING (is_org_admin(organization_id));


-- ============================================================
-- 18. webhook_events
-- ============================================================
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "webhook_events_select_admin"
  ON webhook_events FOR SELECT
  TO authenticated
  USING (is_org_admin(organization_id));

-- INSERT only via service_role (backend event emission)


-- ============================================================
-- 19. webhook_deliveries
-- ============================================================
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- Join through webhooks to get organization_id
CREATE POLICY "webhook_deliveries_select_admin"
  ON webhook_deliveries FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM webhooks w
      WHERE w.id = webhook_deliveries.webhook_id
        AND is_org_admin(w.organization_id)
    )
  );

-- INSERT/UPDATE only via service_role (delivery worker)


-- ============================================================
-- 20. roadmaps
-- ============================================================
ALTER TABLE roadmaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roadmaps_select_member"
  ON roadmaps FOR SELECT
  TO authenticated
  USING (is_org_member(organization_id));

CREATE POLICY "roadmaps_insert_admin"
  ON roadmaps FOR INSERT
  TO authenticated
  WITH CHECK (is_org_admin(organization_id));

CREATE POLICY "roadmaps_update_admin"
  ON roadmaps FOR UPDATE
  TO authenticated
  USING (is_org_admin(organization_id));

CREATE POLICY "roadmaps_delete_admin"
  ON roadmaps FOR DELETE
  TO authenticated
  USING (is_org_admin(organization_id));


-- ============================================================
-- 21. roadmap_items
-- ============================================================
ALTER TABLE roadmap_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roadmap_items_select_member"
  ON roadmap_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM roadmaps r
      WHERE r.id = roadmap_items.roadmap_id
        AND is_org_member(r.organization_id)
    )
  );

CREATE POLICY "roadmap_items_insert_admin"
  ON roadmap_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM roadmaps r
      WHERE r.id = roadmap_id
        AND is_org_admin(r.organization_id)
    )
  );

CREATE POLICY "roadmap_items_update_admin"
  ON roadmap_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM roadmaps r
      WHERE r.id = roadmap_items.roadmap_id
        AND is_org_admin(r.organization_id)
    )
  );

CREATE POLICY "roadmap_items_delete_admin"
  ON roadmap_items FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM roadmaps r
      WHERE r.id = roadmap_items.roadmap_id
        AND is_org_admin(r.organization_id)
    )
  );


-- ============================================================
-- 22. roadmap_votes
-- ============================================================
ALTER TABLE roadmap_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roadmap_votes_select_member"
  ON roadmap_votes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM roadmap_items ri
      JOIN roadmaps r ON r.id = ri.roadmap_id
      WHERE ri.id = roadmap_votes.roadmap_item_id
        AND is_org_member(r.organization_id)
    )
  );

CREATE POLICY "roadmap_votes_insert_self"
  ON roadmap_votes FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "roadmap_votes_delete_self"
  ON roadmap_votes FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- ============================================================
-- 23. roadmap_comments
-- ============================================================
ALTER TABLE roadmap_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roadmap_comments_select_member"
  ON roadmap_comments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM roadmap_items ri
      JOIN roadmaps r ON r.id = ri.roadmap_id
      WHERE ri.id = roadmap_comments.roadmap_item_id
        AND is_org_member(r.organization_id)
    )
  );

CREATE POLICY "roadmap_comments_insert_member"
  ON roadmap_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM roadmap_items ri
      JOIN roadmaps r ON r.id = ri.roadmap_id
      WHERE ri.id = roadmap_item_id
        AND is_org_member(r.organization_id)
    )
  );

CREATE POLICY "roadmap_comments_delete_admin_or_author"
  ON roadmap_comments FOR DELETE
  TO authenticated
  USING (
    author_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM roadmap_items ri
      JOIN roadmaps r ON r.id = ri.roadmap_id
      WHERE ri.id = roadmap_comments.roadmap_item_id
        AND is_org_admin(r.organization_id)
    )
  );


-- ============================================================
-- 24. roadmap_updates
-- ============================================================
ALTER TABLE roadmap_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roadmap_updates_select_member"
  ON roadmap_updates FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM roadmap_items ri
      JOIN roadmaps r ON r.id = ri.roadmap_id
      WHERE ri.id = roadmap_updates.roadmap_item_id
        AND is_org_member(r.organization_id)
    )
  );

CREATE POLICY "roadmap_updates_insert_admin"
  ON roadmap_updates FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM roadmap_items ri
      JOIN roadmaps r ON r.id = ri.roadmap_id
      WHERE ri.id = roadmap_item_id
        AND is_org_admin(r.organization_id)
    )
  );


-- ============================================================
-- 25. roadmap_feedback_links
-- ============================================================
ALTER TABLE roadmap_feedback_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roadmap_feedback_links_select_member"
  ON roadmap_feedback_links FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM roadmap_items ri
      JOIN roadmaps r ON r.id = ri.roadmap_id
      WHERE ri.id = roadmap_feedback_links.roadmap_item_id
        AND is_org_member(r.organization_id)
    )
  );

CREATE POLICY "roadmap_feedback_links_insert_admin"
  ON roadmap_feedback_links FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM roadmap_items ri
      JOIN roadmaps r ON r.id = ri.roadmap_id
      WHERE ri.id = roadmap_item_id
        AND is_org_admin(r.organization_id)
    )
  );

CREATE POLICY "roadmap_feedback_links_delete_admin"
  ON roadmap_feedback_links FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM roadmap_items ri
      JOIN roadmaps r ON r.id = ri.roadmap_id
      WHERE ri.id = roadmap_feedback_links.roadmap_item_id
        AND is_org_admin(r.organization_id)
    )
  );


-- ============================================================
-- 26. cluster_labels
-- ============================================================
ALTER TABLE cluster_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cluster_labels_select_member"
  ON cluster_labels FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM boards b
      WHERE b.id = cluster_labels.board_id
        AND is_org_member(b.organization_id)
    )
  );

-- INSERT/UPDATE/DELETE only via service_role (AI job)


-- ============================================================
-- 27. notification_queue
-- ============================================================
ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;

-- Admins/owners can see queue entries for posts in their org
CREATE POLICY "notification_queue_select_admin"
  ON notification_queue FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = notification_queue.post_id
        AND is_org_admin(p.organization_id)
    )
  );

-- INSERT/UPDATE/DELETE only via service_role (notification worker)


-- ============================================================
-- 28. notification_preferences
-- ============================================================
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_prefs_select_self"
  ON notification_preferences FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "notification_prefs_insert_self"
  ON notification_preferences FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "notification_prefs_update_self"
  ON notification_preferences FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());


-- ============================================================
-- 29. notification_history
-- ============================================================
ALTER TABLE notification_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_history_select_self"
  ON notification_history FOR SELECT
  TO authenticated
  USING (recipient_user_id = auth.uid());

-- INSERT only via service_role


-- ============================================================
-- 30. subscription_history
-- ============================================================
ALTER TABLE subscription_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscription_history_select_owner"
  ON subscription_history FOR SELECT
  TO authenticated
  USING (is_org_owner(organization_id));

-- INSERT only via service_role (billing/Paddle/Stripe webhooks)


-- ============================================================
-- 31. stripe_events
-- ============================================================
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;

-- Owners can view billing events for their org
CREATE POLICY "stripe_events_select_owner"
  ON stripe_events FOR SELECT
  TO authenticated
  USING (is_org_owner(organization_id));

-- INSERT only via service_role (webhook handler)


-- ============================================================
-- 32. overage_charges
-- ============================================================
ALTER TABLE overage_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "overage_charges_select_owner"
  ON overage_charges FOR SELECT
  TO authenticated
  USING (is_org_owner(organization_id));

-- INSERT/UPDATE only via service_role (billing job)


-- ============================================================
-- 33. custom_domains
-- ============================================================
ALTER TABLE custom_domains ENABLE ROW LEVEL SECURITY;

CREATE POLICY "custom_domains_select_admin"
  ON custom_domains FOR SELECT
  TO authenticated
  USING (is_org_admin(organization_id));

CREATE POLICY "custom_domains_insert_owner"
  ON custom_domains FOR INSERT
  TO authenticated
  WITH CHECK (is_org_owner(organization_id));

CREATE POLICY "custom_domains_update_owner"
  ON custom_domains FOR UPDATE
  TO authenticated
  USING (is_org_owner(organization_id));

CREATE POLICY "custom_domains_delete_owner"
  ON custom_domains FOR DELETE
  TO authenticated
  USING (is_org_owner(organization_id));

-- ============================================================
-- 34. changelogs
-- ============================================================
ALTER TABLE changelogs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "changelogs_select_member"
  ON changelogs FOR SELECT
  TO authenticated
  USING (is_org_member(organization_id));

CREATE POLICY "changelogs_insert_admin"
  ON changelogs FOR INSERT
  TO authenticated
  WITH CHECK (is_org_admin(organization_id));

CREATE POLICY "changelogs_update_admin_or_author"
  ON changelogs FOR UPDATE
  TO authenticated
  USING (
    author_id = auth.uid()
    OR is_org_admin(organization_id)
  );

CREATE POLICY "changelogs_delete_admin_or_author"
  ON changelogs FOR DELETE
  TO authenticated
  USING (
    author_id = auth.uid()
    OR is_org_admin(organization_id)
  );


-- ============================================================
-- 35. changelog_links
-- ============================================================
ALTER TABLE changelog_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "changelog_links_select_member"
  ON changelog_links FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM changelogs c
      WHERE c.id = changelog_links.changelog_id
        AND is_org_member(c.organization_id)
    )
  );

CREATE POLICY "changelog_links_insert_admin"
  ON changelog_links FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM changelogs c
      WHERE c.id = changelog_id
        AND is_org_admin(c.organization_id)
    )
  );

CREATE POLICY "changelog_links_delete_admin"
  ON changelog_links FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM changelogs c
      WHERE c.id = changelog_links.changelog_id
        AND is_org_admin(c.organization_id)
    )
  );



-- ============================================================
-- 28. ai_chat_conversations
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_chat_conversations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_conversations_org_id
  ON ai_chat_conversations(organization_id);

CREATE INDEX IF NOT EXISTS idx_ai_chat_conversations_user_id
  ON ai_chat_conversations(user_id);

ALTER TABLE ai_chat_conversations ENABLE ROW LEVEL SECURITY;

-- Org admins/owners can see ONLY THEIR OWN conversations in their org
CREATE POLICY "ai_chat_conversations_select_admin"
  ON ai_chat_conversations FOR SELECT
  TO authenticated
  USING (is_org_admin(organization_id) AND user_id = auth.uid());

-- Org admins/owners can insert conversations in their org
CREATE POLICY "ai_chat_conversations_insert_admin"
  ON ai_chat_conversations FOR INSERT
  TO authenticated
  WITH CHECK (is_org_admin(organization_id) AND user_id = auth.uid());

-- Owner of the conversation can update (e.g. rename title)
CREATE POLICY "ai_chat_conversations_update_owner"
  ON ai_chat_conversations FOR UPDATE
  TO authenticated
  USING (is_org_admin(organization_id) AND user_id = auth.uid());

-- Owner of the conversation can delete it
CREATE POLICY "ai_chat_conversations_delete_owner"
  ON ai_chat_conversations FOR DELETE
  TO authenticated
  USING (is_org_admin(organization_id) AND user_id = auth.uid());


-- ============================================================
-- 29. ai_chat_messages
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID        NOT NULL REFERENCES ai_chat_conversations(id) ON DELETE CASCADE,
  role            TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_conversation_id
  ON ai_chat_messages(conversation_id);

ALTER TABLE ai_chat_messages ENABLE ROW LEVEL SECURITY;

-- Messages are readable if you can read the parent conversation
-- (join through conversation → organization_id + user_id)
CREATE POLICY "ai_chat_messages_select_admin"
  ON ai_chat_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ai_chat_conversations c
      WHERE c.id = ai_chat_messages.conversation_id
        AND is_org_admin(c.organization_id)
        AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "ai_chat_messages_insert_admin"
  ON ai_chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ai_chat_conversations c
      WHERE c.id = conversation_id
        AND is_org_admin(c.organization_id)
        AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "ai_chat_messages_delete_admin"
  ON ai_chat_messages FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ai_chat_conversations c
      WHERE c.id = ai_chat_messages.conversation_id
        AND is_org_admin(c.organization_id)
        AND c.user_id = auth.uid()
    )
  );


COMMIT;


-- ============================================================
-- END OF MIGRATION
-- ============================================================
-- IMPORTANT NOTES:
-- 1. service_role key (used by supabaseAdmin in Fady-backend) bypasses
--    ALL policies above. Backend functionality is 100% unaffected.
-- 2. The `anon` role has no policies, so direct anonymous PostgREST
--    requests to any of these tables will be denied.
-- 3. Run this in the Supabase SQL Editor.
-- 4. This migration is wrapped in a single transaction (BEGIN/COMMIT).
--    If any table doesn't match your live schema exactly, Supabase will
--    throw an error and the ENTIRE script will roll back safely,
--    preventing a partial or broken RLS state.
-- ============================================================
