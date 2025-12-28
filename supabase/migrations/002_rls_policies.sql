-- Enable Row Level Security on all tables
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE rsvps ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- ============================================
-- TRIPS POLICIES
-- ============================================

-- SELECT: Users can view trips if they created them OR if they have a membership
-- Check created_by first to avoid recursion
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

-- INSERT/UPDATE/DELETE: Only the creator (admin) can modify trips
CREATE POLICY "Admins can create trips"
    ON trips FOR INSERT
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "Admins can update their own trips"
    ON trips FOR UPDATE
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "Admins can delete their own trips"
    ON trips FOR DELETE
    USING (created_by = auth.uid());

-- ============================================
-- MEMBERSHIPS POLICIES
-- ============================================

-- SELECT: Users can view their own memberships
CREATE POLICY "Users can view their own memberships"
    ON memberships FOR SELECT
    USING (user_id = auth.uid() OR user_id IS NULL);

-- UPDATE: Users can only update their own membership status
CREATE POLICY "Users can update their own membership status"
    ON memberships FOR UPDATE
    USING (user_id = auth.uid() OR user_id IS NULL)
    WITH CHECK (
        user_id = auth.uid() OR user_id IS NULL
    );

-- INSERT: Trip creators can add memberships for their trips
CREATE POLICY "Trip creators can add memberships"
    ON memberships FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM trips
            WHERE trips.id = memberships.trip_id
            AND trips.created_by = auth.uid()
        )
    );

-- Users can insert their own membership if invited (for accepting invites)
CREATE POLICY "Users can accept invites"
    ON memberships FOR INSERT
    WITH CHECK (
        user_id = auth.uid()
        AND invited_email = (SELECT email FROM auth.users WHERE id = auth.uid())
    );

-- DELETE: Only via service role (handled in API routes if needed)

-- ============================================
-- RSVPS POLICIES
-- ============================================

-- SELECT: Users can view their own RSVPs, admins can view all for their trips
CREATE POLICY "Users can view their own RSVPs"
    ON rsvps FOR SELECT
    USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM trips
            WHERE trips.id = rsvps.trip_id
            AND trips.created_by = auth.uid()
        )
    );

-- INSERT/UPDATE: Users can create/update their own RSVPs, admins can manage all for their trips
CREATE POLICY "Users can manage their own RSVPs"
    ON rsvps FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own RSVPs"
    ON rsvps FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can manage RSVPs for their trips"
    ON rsvps FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM trips
            WHERE trips.id = rsvps.trip_id
            AND trips.created_by = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM trips
            WHERE trips.id = rsvps.trip_id
            AND trips.created_by = auth.uid()
        )
    );

-- ============================================
-- PAYMENTS POLICIES
-- ============================================

-- SELECT: Users can view their own payments, admins can view all for their trips
CREATE POLICY "Users can view their own payments"
    ON payments FOR SELECT
    USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM trips
            WHERE trips.id = payments.trip_id
            AND trips.created_by = auth.uid()
        )
    );

-- INSERT: Users can create their own payments
CREATE POLICY "Users can create their own payments"
    ON payments FOR INSERT
    WITH CHECK (user_id = auth.uid());

-- UPDATE: Users can update their own unverified payments, admins can verify payments
CREATE POLICY "Users can update their own unverified payments"
    ON payments FOR UPDATE
    USING (
        user_id = auth.uid()
        AND verified_at IS NULL
    )
    WITH CHECK (
        user_id = auth.uid()
        AND verified_at IS NULL
    );

CREATE POLICY "Admins can verify payments for their trips"
    ON payments FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM trips
            WHERE trips.id = payments.trip_id
            AND trips.created_by = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM trips
            WHERE trips.id = payments.trip_id
            AND trips.created_by = auth.uid()
        )
    );

