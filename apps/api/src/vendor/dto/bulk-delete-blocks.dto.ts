import { IsArray, ArrayNotEmpty, ArrayMaxSize, IsUUID } from 'class-validator';

/**
 * Remove several availability blocks at once (e.g. a whole recurring weekday
 * series). Soft-deletes are scoped to the activity + vendor in the service, so
 * a foreign id is simply ignored, never another vendor's row. Ids must be UUIDs
 * (block PKs are uuid) — rejects malformed input at the edge.
 */
export class BulkDeleteBlocksDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(400)
  @IsUUID('4', { each: true })
  ids!: string[];
}
