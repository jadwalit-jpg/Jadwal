/**
 * Public catalog GETs: browsers must revalidate, the edge keeps its rules.
 *
 * `Cache-Control: no-cache` goes to browsers (a stale copy is never reused
 * without a conditional request), and the previous edge values travel in
 * `CDN-Cache-Control`, which Cloudflare honours ahead of `Cache-Control`.
 * Pins every public catalog route so a new endpoint cannot quietly go back
 * to `s-maxage` in `Cache-Control` only.
 */
jest.mock('../../src/common/services/upload.service', () => ({
  UploadService: class {},
  ALLOWED_MIME: [], MIME_TO_EXT: {}, ALLOWED_EXT: [],
}));

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as request from 'supertest';
import { CatalogController } from '../../src/catalog/catalog.controller';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ReferenceDataCacheService } from '../../src/redis/reference-data-cache.service';
import { makePrismaMock } from '../mocks/prisma.mock';

const LONG = 'public, s-maxage=3600, stale-while-revalidate=86400';
const SHORT = 'public, s-maxage=300,  stale-while-revalidate=3600';
const LISTING = 'public, s-maxage=120,  stale-while-revalidate=600';

describe('catalog cache headers', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const prisma = makePrismaMock();
    prisma._client.platformSettings.findUnique.mockResolvedValue({ id: 'default', platformName: 'Jadwal' });
    const moduleRef = await Test.createTestingModule({
      controllers: [CatalogController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: ReferenceDataCacheService, useValue: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined) } },
        { provide: ConfigService, useValue: { get: (_k: string, fb?: string) => fb } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterAll(async () => { await app?.close(); });

  it.each([
    ['/catalog/activities', LISTING],
    ['/catalog/activities?featured=true&limit=20', LISTING],
    ['/catalog/trending', SHORT],
    ['/catalog/sitemap-urls', SHORT],
    ['/catalog/countries', LONG],
    ['/catalog/categories', LONG],
    ['/catalog/cities', LONG],
  ])('%s: browsers get no-cache, the edge gets %s', async (url, edge) => {
    const res = await request(app.getHttpServer()).get(url);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['cdn-cache-control']).toBe(edge);
    // Revalidation stays cheap: Express still sends an ETag for the 304 round-trip.
    expect(res.headers['etag']).toBeTruthy();
  });

  it('no public catalog response carries s-maxage in Cache-Control any more', async () => {
    for (const url of ['/catalog/activities', '/catalog/trending', '/catalog/countries']) {
      const res = await request(app.getHttpServer()).get(url);
      expect(res.headers['cache-control']).not.toMatch(/s-maxage|stale-while-revalidate/);
    }
  });
});
