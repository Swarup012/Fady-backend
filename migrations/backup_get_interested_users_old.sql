-- BACKUP: Original get_interested_users_for_post function
-- Saved before Phase 1 migration (org_end_users_phase1.sql)
-- Date: 2026-05-24

CREATE OR REPLACE FUNCTION public.get_interested_users_for_post(p_post_id uuid)
 RETURNS TABLE(email character varying, user_id uuid, tracking_code character varying, reasons text[])
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_organization_id UUID;
BEGIN
  -- Get the organization_id from the post's board
  SELECT b.organization_id INTO v_organization_id
  FROM posts p
  INNER JOIN boards b ON p.board_id = b.id
  WHERE p.id = p_post_id;

  RETURN QUERY
  WITH 
  -- =====================================================
  -- PART 1: REGISTERED USERS who engaged with this post
  -- =====================================================
  
  -- Post creator (registered user)
  registered_creators AS (
    SELECT 
      u.email as user_email,
      p.author_id as uid,
      NULL::VARCHAR(255) as tcode,
      'created'::TEXT as reason
    FROM posts p
    INNER JOIN users u ON p.author_id = u.id
    WHERE p.id = p_post_id 
      AND u.email IS NOT NULL
  ),
  
  -- Voters (registered users)
  registered_voters AS (
    SELECT 
      u.email as user_email,
      v.user_id as uid,
      NULL::VARCHAR(255) as tcode,
      'upvoted'::TEXT as reason
    FROM upvotes v
    INNER JOIN users u ON v.user_id = u.id
    WHERE v.post_id = p_post_id 
      AND u.email IS NOT NULL
  ),
  
  -- Commenters (registered users)
  registered_commenters AS (
    SELECT 
      u.email as user_email,
      c.author_id as uid,
      NULL::VARCHAR(255) as tcode,
      'commented'::TEXT as reason
    FROM comments c
    INNER JOIN users u ON c.author_id = u.id
    WHERE c.post_id = p_post_id 
      AND u.email IS NOT NULL
  ),
  
  -- =====================================================
  -- PART 2: EXTERNAL TRACKED USERS who engaged
  -- =====================================================
  
  -- Get registered emails to exclude from tracked users
  registered_emails AS (
    SELECT DISTINCT u.email as reg_email
    FROM users u 
    WHERE u.email IS NOT NULL
  ),
  
  -- External users who voted with tracking_code
  tracked_voters AS (
    SELECT 
      tu.user_identifier as user_email,
      NULL::UUID as uid,
      tu.tracking_code as tcode,
      'upvoted'::TEXT as reason
    FROM tracked_users tu
    INNER JOIN upvotes v ON v.tracking_code = tu.tracking_code
    WHERE v.post_id = p_post_id
      AND tu.organization_id = v_organization_id
      AND tu.tracking_code IS NOT NULL
      AND tu.user_identifier NOT IN (SELECT re.reg_email FROM registered_emails re WHERE re.reg_email IS NOT NULL)
  ),
  
  -- External users who commented with tracking_code
  tracked_commenters AS (
    SELECT 
      tu.user_identifier as user_email,
      NULL::UUID as uid,
      tu.tracking_code as tcode,
      'commented'::TEXT as reason
    FROM tracked_users tu
    INNER JOIN comments c ON c.tracking_code = tu.tracking_code
    WHERE c.post_id = p_post_id
      AND tu.organization_id = v_organization_id
      AND tu.tracking_code IS NOT NULL
      AND tu.user_identifier NOT IN (SELECT re.reg_email FROM registered_emails re WHERE re.reg_email IS NOT NULL)
  ),
  
  -- External users who created posts with tracking_code
  tracked_creators AS (
    SELECT 
      tu.user_identifier as user_email,
      NULL::UUID as uid,
      tu.tracking_code as tcode,
      'created'::TEXT as reason
    FROM tracked_users tu
    INNER JOIN posts p ON p.tracking_code = tu.tracking_code
    WHERE p.id = p_post_id
      AND tu.organization_id = v_organization_id
      AND tu.tracking_code IS NOT NULL
      AND tu.user_identifier NOT IN (SELECT re.reg_email FROM registered_emails re WHERE re.reg_email IS NOT NULL)
  ),
  
  -- =====================================================
  -- COMBINE ALL ENGAGEMENTS
  -- =====================================================
  all_engagements AS (
    -- Registered users
    SELECT * FROM registered_creators
    UNION ALL
    SELECT * FROM registered_voters
    UNION ALL
    SELECT * FROM registered_commenters
    -- External tracked users
    UNION ALL
    SELECT * FROM tracked_voters
    UNION ALL
    SELECT * FROM tracked_commenters
    UNION ALL
    SELECT * FROM tracked_creators
  )
  
  -- Final aggregation - group by email
  SELECT 
    ae.user_email::VARCHAR(255) as email,
    (array_agg(ae.uid) FILTER (WHERE ae.uid IS NOT NULL))[1] as user_id,
    MAX(ae.tcode)::VARCHAR(255) as tracking_code,
    array_agg(DISTINCT ae.reason ORDER BY ae.reason) as reasons
  FROM all_engagements ae
  WHERE ae.user_email IS NOT NULL
  GROUP BY ae.user_email;
END;
$function$
