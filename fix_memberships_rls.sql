-- Fix RLS policy to allow trip creators to add memberships
-- Run this in your Supabase SQL editor

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Trip creators can add memberships" ON memberships;
DROP POLICY IF EXISTS "Users can accept invites" ON memberships;
DROP POLICY IF EXISTS "Trip creators can view trip memberships" ON memberships;

-- Allow trip creators to add memberships for their trips
CREATE POLICY "Trip creators can add memberships"
    ON memberships FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM trips
            WHERE trips.id = memberships.trip_id
            AND trips.created_by = auth.uid()
        )
    );

-- Allow users to insert their own membership when accepting invites
CREATE POLICY "Users can accept invites"
    ON memberships FOR INSERT
    WITH CHECK (
        user_id = auth.uid()
        AND invited_email = (auth.jwt() ->> 'email')
    );

-- Also allow trip creators to view all memberships for their trips
CREATE POLICY "Trip creators can view trip memberships"
    ON memberships FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM trips
            WHERE trips.id = memberships.trip_id
            AND trips.created_by = auth.uid()
        )
    );

