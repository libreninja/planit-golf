-- Fix memberships INSERT policy to avoid querying auth.users table
-- Run this in your Supabase SQL editor

DROP POLICY IF EXISTS "Users can accept invites" ON memberships;

-- Allow users to insert their own membership when accepting invites
-- Use JWT email instead of querying auth.users table
CREATE POLICY "Users can accept invites"
    ON memberships FOR INSERT
    WITH CHECK (
        user_id = auth.uid()
        AND invited_email = (auth.jwt() ->> 'email')
    );

