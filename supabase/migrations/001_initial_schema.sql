-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trips table
CREATE TABLE trips (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text UNIQUE NOT NULL,
    title text NOT NULL,
    location_name text,
    start_date date,
    end_date date,
    overview text,
    itinerary jsonb,
    deposit_amount_cents int NOT NULL DEFAULT 0,
    deposit_due_date date,
    venmo_handle text,
    venmo_qr_url text,
    zelle_recipient text,
    required_memo_template text,
    created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT NOW(),
    updated_at timestamptz DEFAULT NOW()
);

-- Create updated_at trigger for trips
CREATE TRIGGER update_trips_updated_at BEFORE UPDATE ON trips
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create memberships table
CREATE TABLE memberships (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    invited_email text NOT NULL,
    role text NOT NULL DEFAULT 'guest',
    status text NOT NULL DEFAULT 'invited',
    invite_token text UNIQUE NOT NULL,
    invited_at timestamptz DEFAULT NOW(),
    accepted_at timestamptz
);

-- Create rsvps table
CREATE TABLE rsvps (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status text NOT NULL,
    arrival_at timestamptz,
    departure_at timestamptz,
    walking_pref text,
    notes text,
    updated_at timestamptz DEFAULT NOW(),
    UNIQUE(trip_id, user_id)
);

-- Create updated_at trigger for rsvps
CREATE TRIGGER update_rsvps_updated_at BEFORE UPDATE ON rsvps
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create payments table
CREATE TABLE payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type text NOT NULL DEFAULT 'deposit',
    amount_cents int NOT NULL,
    method text NOT NULL,
    identifier text,
    memo text,
    reported_at timestamptz DEFAULT NOW(),
    verified_at timestamptz,
    verified_by uuid REFERENCES auth.users(id),
    UNIQUE(trip_id, user_id, type)
);

-- Create indexes
CREATE INDEX idx_trips_created_by ON trips(created_by);
CREATE INDEX idx_trips_slug ON trips(slug);
CREATE INDEX idx_memberships_trip_id ON memberships(trip_id);
CREATE INDEX idx_memberships_user_id ON memberships(user_id);
CREATE INDEX idx_memberships_invite_token ON memberships(invite_token);
CREATE INDEX idx_memberships_invited_email ON memberships(invited_email);
CREATE INDEX idx_rsvps_trip_id ON rsvps(trip_id);
CREATE INDEX idx_rsvps_user_id ON rsvps(user_id);
CREATE INDEX idx_payments_trip_id ON payments(trip_id);
CREATE INDEX idx_payments_user_id ON payments(user_id);

