# How to Add Users (Guests) to a Trip

## Overview

Users are added to trips through the **"Guests"** section in the trip edit page. When you add someone, they get a membership record that allows them to see and access the trip.

## Step-by-Step Process

### 1. Navigate to Trip Edit Page

1. **Go to "My Trips"** page (`/trips`)
2. **Click the edit icon** (pencil) on a trip you created
3. This opens the trip edit page (`/admin/trips/:id`)

### 2. Open the Guests Section

1. **Scroll down** to the **"Guests"** section
2. **Click to expand** the section (if collapsed)

### 3. Add Guests

You have two options:

#### Option A: Add Yourself as a Guest

1. **Check the checkbox**: "Add me as a guest to this trip"
   - This adds you (the trip creator) as a guest
   - Status: `accepted` (automatically accepted)
   - This lets you see the trip in "My Trips" even if you didn't create it

#### Option B: Add Someone by Email

1. **Enter an email address** in the "Add by Email" field
2. **Click "Add Guest"** button
   - Status: `invited` (they need to accept)
   - They'll need to sign up/login to see the trip

#### Option C: Both

- You can check the checkbox AND enter an email
- Both will be added at once

### 4. What Happens When You Add Someone

When you add a guest:

1. **A membership record is created** in the database with:
   - `trip_id`: The trip they're invited to
   - `invited_email`: Their email address
   - `user_id`: 
     - Set if they already have an account (matches email)
     - `null` if they don't have an account yet
   - `status`: 
     - `accepted` if it's you (the creator)
     - `invited` if it's someone else
   - `invite_token`: A unique token (currently not used for email invites)

2. **They can now see the trip**:
   - If they already have an account: They'll see it in "My Trips" immediately
   - If they don't have an account: They'll see it after they sign up with that email

### 5. View Current Guests

After adding guests, you'll see them listed in the **"Current Guests"** table showing:
- **Email**: Their invited email address
- **Status**: `invited`, `accepted`, or `declined`
- **Invited**: Date they were added
- **Accepted**: Date they accepted (if applicable)

## Important Notes

### No Email Invites Currently

- **Currently, no email is sent** when you add a guest
- They'll only see the trip if they:
  - Already have an account with that email
  - Sign up with that email later

### User Account Creation

- Users create accounts by **signing in with magic link**
- When they sign in with an email that matches an `invited_email` in memberships:
  - Their `user_id` gets linked to the membership
  - Status can change from `invited` to `accepted` (if they accept)

### Trip Creator Access

- **Trip creators** can always see and edit their trips (via edit icon)
- **Adding yourself as a guest** is optional - it just makes the trip appear in "My Trips" list

## Example Workflow

1. **You create a trip** called "Bandon Dunes 2026"
2. **You add guests**:
   - Check "Add me as a guest" (so you see it in My Trips)
   - Add `friend@example.com` by email
3. **Friend signs up**:
   - Friend goes to `planit.golf/login`
   - Enters `friend@example.com`
   - Gets magic link, signs in
   - Now sees "Bandon Dunes 2026" in their "My Trips" page
4. **Both of you** can now:
   - View trip details
   - See other guests
   - Make payments
   - RSVP (if implemented)

## Future: Email Invites

In the future, you might want to:
- Send email invites when adding guests
- Use the `invite_token` to create invite links
- Send reminder emails

But for now, users just need to sign up with the email you added.

