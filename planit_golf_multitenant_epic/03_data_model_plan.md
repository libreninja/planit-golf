# Data Model Plan

This is a proposed model. Codex should inspect the current schema and adapt names to the existing codebase.

## Core concepts

### profiles

Use the existing `profiles` table as the user/account model for this epic.

Reason:
- it already represents the signed-in app user
- it already links to Supabase Auth
- it already stores app-specific fields
- it avoids a risky dual-user-model migration

This epic should not introduce a second canonical user table like `app_users` unless a future dedicated migration is approved.

### tenants

Represents public-facing organizations or league/course identities.

Suggested fields:
- id
- slug
- name
- short_name
- description
- visibility: public/private
- created_at
- updated_at

Example:
- slug: `igc`
- name: `Interbay Golf Club`
- short_name: `IGC`

### groups

Represents operational groups that users can belong to.

Suggested fields:
- id
- tenant_id nullable
- slug nullable
- name
- type: league/course_club/friend_group/trip_group
- visibility: public/private/invite_only
- created_at
- updated_at

A tenant may have one or more groups.

Concrete examples:
- `igc-mens` group under tenant `igc`
- `igc-womens` group under tenant `igc`
- `big-deal` private friend group with `tenant_id = null`

### memberships

Represents user membership in a group.

Suggested fields:
- id
- profile_id
- group_id
- role: owner/admin/member/viewer
- status: active/invited/disabled
- created_at
- updated_at

Important invariant:
- membership rows join `profiles` to `groups`
- do not put both `tenant_id` and `group_id` on the membership row
- tenant association should be derived through the group when applicable

### feature_entitlements

Preserves special access for existing users.

Suggested fields:
- id
- profile_id
- feature_key
- enabled
- source
- created_at
- updated_at

Example feature keys:
- `legacy_special_features`
- `tee_time_preference_tools`
- `trip_manager`
- `league_admin_tools`

## Migration strategy for existing special users

1. Identify existing users with special access.
2. Confirm the corresponding `profiles` records exist and are linked correctly.
3. Add `feature_entitlements` rows for those users.
4. Move the existing feature UI to `/me/special`.
5. Guard the route by checking the entitlement server side.
6. Keep old route as a redirect during migration if needed.

## Public data strategy

Public IGC landing page should read from public-safe views or API endpoints.

Recommended:
- create curated public server APIs first, or use tightly scoped public-safe views when clearly safe
- avoid exposing private member data
- return only fields intended for public display

Preferred first implementation:
- route handlers or server loaders that shape public response DTOs
- cached or revalidated reads for leaderboard/newsletter/announcements
- no direct client access to private operational tables

Example views:
- `public_league_leaderboard`
- `public_newsletter_posts`
- `public_tenant_landing_summary`

## Important rule

Do not bake tenant or group behavior into auth user IDs.

Use internal IDs and join tables so a user can belong to:
- IGC
- West Seattle
- a Bandon friend group
- a Palm Springs trip group
- Big Deal while also belonging to Interbay league groups
