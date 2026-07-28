-- Enable RLS on Vercel's GitHub trigger log table
-- This table is created by Vercel for GitHub integration webhooks

-- Enable RLS
ALTER TABLE IF EXISTS gh_trigger_log ENABLE ROW LEVEL SECURITY;

-- Only admins should access trigger logs
CREATE POLICY "Admins can view trigger logs"
    ON gh_trigger_log FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND (profiles.is_admin = true OR profiles.is_system_admin = true)
        )
    );
