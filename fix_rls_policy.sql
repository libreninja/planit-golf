-- Fix RLS policy to allow trip creators to view their own trips
-- Run this in your Supabase SQL editor

DROP POLICY IF EXISTS "Users can view trips they are invited to" ON trips;

CREATE POLICY "Users can view trips they are invited to"
    ON trips FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM memberships
            WHERE memberships.trip_id = trips.id
            AND memberships.user_id = auth.uid()
            AND memberships.status IN ('invited', 'accepted')
        )
        OR created_by = auth.uid()
    );

