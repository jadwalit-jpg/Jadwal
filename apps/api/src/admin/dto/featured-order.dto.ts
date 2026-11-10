import { ArrayMaxSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

/** How many listings the homepage Featured row shows (its request uses limit=20). */
export const HOMEPAGE_FEATURED_LIMIT = 20;

/**
 * PUT /admin/activities/featured/order — the COMPLETE ordered list of featured
 * listing ids, first on the homepage first. The service checks that the set is
 * exactly the listings featured right now (409 otherwise), so a page that is
 * out of date cannot overwrite someone else's star clicks.
 */
export class FeaturedOrderDto {
  @IsArray({ message: 'ids must be an array of activity ids' })
  @ArrayMaxSize(500, { message: 'ids must hold at most 500 entries' })
  @ArrayUnique({ message: 'ids must not repeat' })
  @IsUUID('all', { each: true, message: 'each id must be a UUID' })
  ids!: string[];
}
