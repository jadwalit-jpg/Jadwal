-- One-time data migration: swap legacy CloudFront default hostname for the
-- new Cloudflare-fronted CDN domain in every column that stores image URLs.
--
-- Background: until 2026-05-06 the production CDN hostname was the AWS-default
-- d20ocwnwytrfe1.cloudfront.net. The web bundle's CSP and Next.js image
-- remotePatterns now allow only cdn.jadwal.qa, so existing rows with the old
-- hostname render as broken images for customers. New uploads since the env
-- swap already use cdn.jadwal.qa; this migration rewrites the historical rows.
--
-- Safety properties:
--   * REPLACE(col, OLD, NEW) is a literal substring substitution; rows whose
--     value does not contain OLD are returned unchanged. Cannot lose data.
--   * WHERE col LIKE 'OLD%' filters to rows that actually need updating, so
--     the migration is idempotent (re-running is a no-op).
--   * The DO $$ block is implicitly transactional; if any UPDATE fails the
--     whole block rolls back, leaving the table in its prior state.
--   * Reversible: swap the OLD/NEW arguments in every REPLACE() call and
--     re-run to roll back.
--
-- Affected columns:
--   users.profilePicture        text
--   categories.image            text
--   activities.coverImage       text
--   activities.gallery          text[]   (per-element rewrite via unnest)
--   trending_events.image       text

DO $$
DECLARE
  affected_users          INT;
  affected_categories     INT;
  affected_activities_cv  INT;
  affected_activities_gl  INT;
  affected_trending       INT;
BEGIN

  UPDATE "users"
     SET "profilePicture" = REPLACE("profilePicture",
                                    'https://d20ocwnwytrfe1.cloudfront.net',
                                    'https://cdn.jadwal.qa')
   WHERE "profilePicture" LIKE 'https://d20ocwnwytrfe1.cloudfront.net%';
  GET DIAGNOSTICS affected_users = ROW_COUNT;
  RAISE NOTICE 'cdn swap: users.profilePicture rows = %', affected_users;

  UPDATE "categories"
     SET "image" = REPLACE("image",
                           'https://d20ocwnwytrfe1.cloudfront.net',
                           'https://cdn.jadwal.qa')
   WHERE "image" LIKE 'https://d20ocwnwytrfe1.cloudfront.net%';
  GET DIAGNOSTICS affected_categories = ROW_COUNT;
  RAISE NOTICE 'cdn swap: categories.image rows = %', affected_categories;

  UPDATE "activities"
     SET "coverImage" = REPLACE("coverImage",
                                'https://d20ocwnwytrfe1.cloudfront.net',
                                'https://cdn.jadwal.qa')
   WHERE "coverImage" LIKE 'https://d20ocwnwytrfe1.cloudfront.net%';
  GET DIAGNOSTICS affected_activities_cv = ROW_COUNT;
  RAISE NOTICE 'cdn swap: activities.coverImage rows = %', affected_activities_cv;

  -- text[] gallery: rewrite each element. Only updates rows that contain at
  -- least one matching element, leaves rows with no old-host URLs alone.
  UPDATE "activities"
     SET "gallery" = ARRAY(
           SELECT REPLACE(elem,
                          'https://d20ocwnwytrfe1.cloudfront.net',
                          'https://cdn.jadwal.qa')
             FROM unnest("gallery") AS elem
         )
   WHERE EXISTS (
           SELECT 1 FROM unnest("gallery") AS elem
            WHERE elem LIKE 'https://d20ocwnwytrfe1.cloudfront.net%'
         );
  GET DIAGNOSTICS affected_activities_gl = ROW_COUNT;
  RAISE NOTICE 'cdn swap: activities.gallery rows = %', affected_activities_gl;

  UPDATE "trending_events"
     SET "image" = REPLACE("image",
                           'https://d20ocwnwytrfe1.cloudfront.net',
                           'https://cdn.jadwal.qa')
   WHERE "image" LIKE 'https://d20ocwnwytrfe1.cloudfront.net%';
  GET DIAGNOSTICS affected_trending = ROW_COUNT;
  RAISE NOTICE 'cdn swap: trending_events.image rows = %', affected_trending;

  RAISE NOTICE 'cdn swap totals: users=% categories=% activities.coverImage=% activities.gallery=% trending_events=%',
               affected_users, affected_categories, affected_activities_cv,
               affected_activities_gl, affected_trending;
END $$;
