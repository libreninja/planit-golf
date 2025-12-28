-- Fix infinite recursion in trips and memberships SELECT policies
-- Run this in your Supabase SQL editor

-- Create a SECURITY DEFINER function to check trip ownership without triggering RLS
CREATE OR REPLACE FUNCTION is_trip_creator(trip_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM trips
    WHERE trips.id = trip_id
    AND trips.created_by = auth.uid()
  );
$$;

-- Drop all conflicting policies
DROP POLICY IF EXISTS "Users can view trips they are invited to" ON trips;
DROP POLICY IF EXISTS "Users can view their own memberships" ON memberships;
DROP POLICY IF EXISTS "Trip creators can view trip memberships" ON memberships;

-- Trips SELECT: Check created_by first (no recursion), then check memberships
CREATE POLICY "Users can view trips they are invited to"
    ON trips FOR SELECT
    USING (
        created_by = auth.uid()
        OR EXISTS (
            SELECT 1 FROM memberships
            WHERE memberships.trip_id = trips.id
            AND memberships.user_id = auth.uid()
            AND memberships.status IN ('invited', 'accepted')
        )
    );

-- Memberships SELECT: Users can view their own memberships OR if they're the trip creator
-- Note: We can't query auth.users table, so we check user_id and invited_email directly
CREATE POLICY "Users can view their own memberships"
    ON memberships FOR SELECT
    USING (
        user_id = auth.uid() 
        OR invited_email = auth.jwt() ->> 'email'  -- Get email from JWT, not users table
        OR is_trip_creator(memberships.trip_id)  -- Use function to avoid recursion
    );

