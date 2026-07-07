/**
 * UploadService unit tests — validation + processing + storage selection.
 *
 * Mocks:
 *   - `file-type` (ESM) → controlled detected.mime return value
 *   - `sharp`           → pipeline returns a fixed Buffer
 *   - `fs/promises`     → no real disk IO
 *   - `fs` (sync)       → stub existsSync + mkdirSync
 *   - `@aws-sdk/client-s3` (dynamic require in production path)
 */

// ─── Mocks BEFORE src import ────────────────────────────────────────────────

// file-type is ESM — stub as a plain object
jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { fileTypeFromBuffer } = require('file-type') as { fileTypeFromBuffer: jest.Mock };

// sharp — chainable pipeline that ends in toBuffer().
// `import * as sharp from 'sharp'` binds to the module namespace; in production
// the namespace itself is callable because sharp's module.exports is a fn.
// Recreate that by returning a callable that also has properties (via Proxy).
jest.mock('sharp', () => {
  const toBuffer = jest.fn().mockResolvedValue(Buffer.from('PROCESSED-WEBP'));
  const chain: any = {
    rotate: jest.fn().mockReturnThis(),
    resize: jest.fn().mockReturnThis(),
    webp: jest.fn().mockReturnThis(),
    toBuffer,
  };
  const fn: any = jest.fn().mockReturnValue(chain);
  fn.default = fn;
  return fn;
});

// fs/promises — intercept reads/writes
jest.mock('fs/promises', () => ({
  readFile: jest.fn().mockResolvedValue(Buffer.from('RAW-JPG')),
  writeFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fsp = require('fs/promises') as any;

// fs — stub sync helpers so disk IO never touches the test runner
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return { ...actual, existsSync: jest.fn().mockReturnValue(true), mkdirSync: jest.fn() };
});

// @aws-sdk/client-s3 — not installed (service does dynamic require()); mark virtual
jest.mock(
  '@aws-sdk/client-s3',
  () => {
    const sendMock = jest.fn().mockResolvedValue({});
    const S3Client = jest.fn().mockImplementation(() => ({ send: sendMock }));
    const PutObjectCommand = jest.fn().mockImplementation((args: any) => ({ __cmd: 'Put', args }));
    return { S3Client, PutObjectCommand, __sendMock: sendMock };
  },
  { virtual: true },
);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const s3Mocks = require('@aws-sdk/client-s3') as any;

import { UploadService } from '../../src/common/services/upload.service';
import { BadRequestException } from '@nestjs/common';

function makeConfig(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    STORAGE_DRIVER: 'local',
    API_URL: 'https://api.jadwal.test',
    S3_BUCKET: '',
    S3_REGION: 'eu-central-1',
    CDN_URL: '',
    UPLOAD_MAX_SIZE_MB: '10',
    UPLOAD_MAX_DIMENSION: '1920',
    UPLOAD_WEBP_QUALITY: '82',
  };
  const merged = { ...defaults, ...overrides };
  return {
    get: <T = string>(k: string, fallback?: T): T => (merged[k] ?? (fallback as any)) as T,
    getOrThrow: <T = string>(k: string): T => {
      if (merged[k] === undefined) throw new Error(`Missing: ${k}`);
      return merged[k] as any;
    },
  };
}

function fakeMulter(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'photo.jpg',
    encoding: '7bit',
    mimetype: 'image/jpeg',
    destination: '/tmp',
    filename: 'tempname.jpg',
    path: '/tmp/tempname.jpg',
    size: 1024,
    buffer: Buffer.from(''),
    stream: null as any,
    ...overrides,
  } as any;
}

describe('UploadService.generateBlurFromUrl — SSRF guard + best-effort', () => {
  const cfg = makeConfig({ CDN_URL: 'https://cdn.jadwal.test' });

  test('null / empty input → null (no work)', async () => {
    const svc = new UploadService(cfg as any);
    expect(await svc.generateBlurFromUrl(null)).toBeNull();
    expect(await svc.generateBlurFromUrl('')).toBeNull();
  });

  test('SSRF: a NON-own host (metadata endpoint / arbitrary site) → null WITHOUT any fetch', async () => {
    const svc = new UploadService(cfg as any);
    const fetchSpy = jest
      .spyOn(global as any, 'fetch')
      .mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as any);
    try {
      expect(await svc.generateBlurFromUrl('http://169.254.169.254/latest/meta-data')).toBeNull();
      expect(await svc.generateBlurFromUrl('https://evil.example.com/x.webp')).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled(); // the host guard blocks BEFORE the network
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('own CDN host → fetches + returns a webp data URI', async () => {
    const svc = new UploadService(cfg as any);
    const fetchSpy = jest
      .spyOn(global as any, 'fetch')
      .mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as any);
    try {
      const uri = await svc.generateBlurFromUrl('https://cdn.jadwal.test/activities/x.webp');
      expect(fetchSpy).toHaveBeenCalled();
      expect(uri).toMatch(/^data:image\/webp;base64,/);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('fetch failure → null (best-effort, never throws)', async () => {
    const svc = new UploadService(cfg as any);
    const fetchSpy = jest.spyOn(global as any, 'fetch').mockRejectedValue(new Error('network'));
    try {
      expect(await svc.generateBlurFromUrl('https://cdn.jadwal.test/x.webp')).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('fetch uses redirect:"error" (an allowlisted host cannot 3xx-redirect to an off-host target)', async () => {
    const svc = new UploadService(cfg as any);
    const fetchSpy = jest
      .spyOn(global as any, 'fetch')
      .mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as any);
    try {
      await svc.generateBlurFromUrl('https://cdn.jadwal.test/x.webp');
      expect(fetchSpy).toHaveBeenCalledWith('https://cdn.jadwal.test/x.webp', expect.objectContaining({ redirect: 'error' }));
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('UploadService — construction', () => {
  const ORIG = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = ORIG; });

  test('STORAGE_DRIVER=s3 without S3_BUCKET → throws (fail-fast)', () => {
    expect(() => new UploadService(makeConfig({ STORAGE_DRIVER: 's3', S3_BUCKET: '' }) as any))
      .toThrow(/FATAL.*S3_BUCKET/);
  });

  test('STORAGE_DRIVER=local in production → throws (fail-fast)', () => {
    process.env.NODE_ENV = 'production';
    expect(() => new UploadService(makeConfig({ STORAGE_DRIVER: 'local' }) as any))
      .toThrow(/Local storage.*not permitted/);
  });

  test('local in dev or s3 with bucket → constructs without throwing', () => {
    expect(() => new UploadService(makeConfig({ STORAGE_DRIVER: 'local' }) as any)).not.toThrow();
    expect(() => new UploadService(makeConfig({ STORAGE_DRIVER: 's3', S3_BUCKET: 'my-bucket' }) as any))
      .not.toThrow();
  });
});

describe('UploadService.validateFile', () => {
  const svc = new UploadService(makeConfig() as any);

  test('null file → BadRequest "No file uploaded"', () => {
    expect(() => svc.validateFile(null as any)).toThrow(/no file uploaded/i);
  });

  test('disallowed mimetype → BadRequest', () => {
    const f = fakeMulter({ mimetype: 'application/pdf' });
    expect(() => svc.validateFile(f)).toThrow(/JPEG|PNG|WebP|GIF/i);
  });

  test('disallowed extension even with valid mimetype → BadRequest', () => {
    const f = fakeMulter({ originalname: 'hack.exe', mimetype: 'image/jpeg' });
    expect(() => svc.validateFile(f)).toThrow(/extension/i);
  });

  test('file over size limit → BadRequest', () => {
    const svc2 = new UploadService(makeConfig({ UPLOAD_MAX_SIZE_MB: '1' }) as any);
    const f = fakeMulter({ size: 2 * 1024 * 1024 });
    expect(() => svc2.validateFile(f)).toThrow(/too large/i);
  });

  test('valid jpg/png/webp/gif all pass', () => {
    for (const m of ['image/jpeg', 'image/png', 'image/webp', 'image/gif']) {
      const ext = m === 'image/jpeg' ? '.jpg' : m.replace('image/', '.');
      expect(() => svc.validateFile(fakeMulter({ mimetype: m, originalname: `p${ext}` }))).not.toThrow();
    }
  });
});

describe('UploadService.upload — magic-byte sniffing + sharp pipeline', () => {
  beforeEach(() => {
    fileTypeFromBuffer.mockReset();
    fsp.writeFile.mockClear();
    fsp.unlink.mockClear();
  });

  test('detected.mime outside ALLOWED_MIME → BadRequest "not a valid image"', async () => {
    fileTypeFromBuffer.mockResolvedValueOnce({ mime: 'application/pdf', ext: 'pdf' });
    const svc = new UploadService(makeConfig() as any);
    await expect(svc.upload(fakeMulter(), 'activities'))
      .rejects.toThrow(BadRequestException);
    await expect(svc.upload(fakeMulter(), 'activities'))
      .rejects.toThrow(/not a valid image/i);
  });

  test('no detected type at all → BadRequest', async () => {
    fileTypeFromBuffer.mockResolvedValueOnce(null);
    const svc = new UploadService(makeConfig() as any);
    await expect(svc.upload(fakeMulter(), 'activities')).rejects.toThrow(BadRequestException);
  });

  test('local driver: happy path → writes processed webp, returns API URL', async () => {
    fileTypeFromBuffer.mockResolvedValue({ mime: 'image/jpeg', ext: 'jpg' });
    const svc = new UploadService(makeConfig() as any);
    const url = await svc.upload(fakeMulter(), 'activities');

    expect(fsp.writeFile).toHaveBeenCalledTimes(1);
    expect(fsp.unlink).toHaveBeenCalled(); // cleans up temp multer file
    expect(url).toMatch(/^https:\/\/api\.jadwal\.test\/uploads\/activities\//);
    expect(url.endsWith('.webp')).toBe(true);
  });

  test('s3 driver: uploads via PutObjectCommand, returns direct S3 URL', async () => {
    fileTypeFromBuffer.mockResolvedValue({ mime: 'image/png', ext: 'png' });
    s3Mocks.__sendMock.mockClear();
    s3Mocks.PutObjectCommand.mockClear();

    const svc = new UploadService(makeConfig({
      STORAGE_DRIVER: 's3', S3_BUCKET: 'my-bucket', S3_REGION: 'eu-west-1',
    }) as any);
    const url = await svc.upload(fakeMulter(), 'categories');

    expect(s3Mocks.PutObjectCommand).toHaveBeenCalledTimes(1);
    const args = s3Mocks.PutObjectCommand.mock.calls[0][0];
    expect(args.Bucket).toBe('my-bucket');
    expect(args.Key).toMatch(/^categories\//);
    expect(args.Key.endsWith('.webp')).toBe(true);
    expect(args.ContentType).toBe('image/webp');
    expect(args.CacheControl).toMatch(/immutable/);
    expect(url).toBe(`https://my-bucket.s3.eu-west-1.amazonaws.com/${args.Key}`);
  });

  test('s3 driver + CDN_URL → returns CDN URL instead of raw S3 URL', async () => {
    fileTypeFromBuffer.mockResolvedValue({ mime: 'image/webp', ext: 'webp' });
    const svc = new UploadService(makeConfig({
      STORAGE_DRIVER: 's3', S3_BUCKET: 'b', CDN_URL: 'https://cdn.jadwal.qa',
    }) as any);
    const url = await svc.upload(fakeMulter(), 'vendors');
    expect(url).toMatch(/^https:\/\/cdn\.jadwal\.qa\/vendors\//);
  });
});

describe('UploadService.diskStorageConfig — multer factory', () => {
  test('returns config with fileSize from UPLOAD_MAX_SIZE_MB', () => {
    process.env.UPLOAD_MAX_SIZE_MB = '5';
    const cfg = UploadService.diskStorageConfig('foo');
    expect(cfg.limits.fileSize).toBe(5 * 1024 * 1024);
    delete process.env.UPLOAD_MAX_SIZE_MB;
  });

  test('fileFilter rejects pdf mimetype', () => {
    const cfg = UploadService.diskStorageConfig('foo');
    const cb = jest.fn();
    cfg.fileFilter({} as any, { mimetype: 'application/pdf', originalname: 'x.pdf' } as any, cb);
    expect(cb).toHaveBeenCalledWith(expect.any(BadRequestException), false);
  });

  test('fileFilter accepts valid jpg', () => {
    const cfg = UploadService.diskStorageConfig('foo');
    const cb = jest.fn();
    cfg.fileFilter({} as any, { mimetype: 'image/jpeg', originalname: 'x.jpg' } as any, cb);
    expect(cb).toHaveBeenCalledWith(null, true);
  });

  test('fileFilter rejects mismatched extension even with valid mimetype', () => {
    const cfg = UploadService.diskStorageConfig('foo');
    const cb = jest.fn();
    cfg.fileFilter({} as any, { mimetype: 'image/jpeg', originalname: 'x.sh' } as any, cb);
    expect(cb).toHaveBeenCalledWith(expect.any(BadRequestException), false);
  });
});
