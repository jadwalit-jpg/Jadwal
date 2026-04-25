import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { diskStorage } from 'multer';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { readFile, unlink, writeFile } from 'fs/promises';
import * as crypto from 'crypto';
import * as sharp from 'sharp';

// `file-type` v19 is ESM-only. Our tsconfig is CommonJS, so a static
// `import { fileTypeFromBuffer } from 'file-type'` compiles to `require()`,
// which crashes the Nest process at boot with ERR_PACKAGE_PATH_NOT_EXPORTED.
//
// At runtime we use a dynamic import hidden from the TS compiler via
// `new Function()` — otherwise tsc rewrites `import()` to `require()` too.
// Under Jest (where file-type is remapped to a CJS stub), stay on require()
// so `jest.mock('file-type', …)` continues to work.
type FileTypeModule = {
  fileTypeFromBuffer: (
    buf: Buffer | Uint8Array,
  ) => Promise<{ mime: string; ext: string } | undefined>;
};
// Jest sets `JEST_WORKER_ID` on every worker process. It is the most reliable
// cross-version signal that we are running under jest (the `jest` global isn't
// on `globalThis` in module scope).
const IS_JEST = typeof process.env.JEST_WORKER_ID !== 'undefined';
const importEsm: <T = unknown>(specifier: string) => Promise<T> = new Function(
  'specifier',
  'return import(specifier)',
) as never;
async function loadFileType(): Promise<FileTypeModule> {
  if (IS_JEST) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('file-type') as FileTypeModule;
  }
  return importEsm<FileTypeModule>('file-type');
}

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

export { ALLOWED_MIME, MIME_TO_EXT, ALLOWED_EXT };

@Injectable()
export class UploadService {
  private readonly driver: 'local' | 's3';
  private readonly apiUrl: string;
  private readonly s3Bucket: string;
  private readonly s3Region: string;
  private readonly cdnUrl: string;
  private readonly maxFileSize: number;
  private readonly maxDimension: number;
  private readonly webpQuality: number;
  private s3Client: any;

  constructor(config: ConfigService) {
    this.driver = (config.get<string>('STORAGE_DRIVER', 'local')) as 'local' | 's3';
    this.apiUrl = config.getOrThrow<string>('API_URL');
    this.s3Bucket = config.get<string>('S3_BUCKET', '');
    this.s3Region = config.get<string>('S3_REGION', 'me-south-1');
    this.cdnUrl = config.get<string>('CDN_URL', '');
    this.maxFileSize = Number(config.get<string>('UPLOAD_MAX_SIZE_MB', '10')) * 1024 * 1024;
    this.maxDimension = Number(config.get<string>('UPLOAD_MAX_DIMENSION', '1920'));
    this.webpQuality = Number(config.get<string>('UPLOAD_WEBP_QUALITY', '82'));

    // Fail fast: never allow S3 driver without a bucket — would 500 at first upload.
    // Error messages reference the var name only, never the value.
    if (this.driver === 's3' && !this.s3Bucket) {
      throw new Error('[FATAL] STORAGE_DRIVER is s3 but S3_BUCKET is not set');
    }
    // Defence-in-depth: never allow local driver in production (main.ts also guards this)
    if (this.driver === 'local' && process.env.NODE_ENV === 'production') {
      throw new Error('[FATAL] Local storage driver is not permitted in production');
    }
  }

  /**
   * Lazily initialise the S3 client only when needed.
   * @aws-sdk/client-s3 is loaded dynamically so it's not required in dev.
   */
  private async getS3Client() {
    if (this.s3Client) return this.s3Client;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { S3Client } = require('@aws-sdk/client-s3');
    this.s3Client = new S3Client({ region: this.s3Region });
    return this.s3Client;
  }

  /**
   * Validate a Multer file (MIME, extension, size).
   */
  validateFile(file: Express.Multer.File): void {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      throw new BadRequestException('Only JPEG, PNG, WebP, or GIF images are allowed');
    }
    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXT.includes(`.${ext}`)) {
      throw new BadRequestException('Invalid file extension');
    }
    if (file.size > this.maxFileSize) {
      throw new BadRequestException(`File too large (max ${Math.round(this.maxFileSize / 1024 / 1024)} MB)`);
    }
  }

  /**
   * Process image through sharp:
   * - Detect real file type via `file-type` (magic-byte inspection) —
   *   blocks polyglot files that lie about their `Content-Type`. The
   *   client-supplied `file.mimetype` is never trusted.
   * - Strip EXIF/GPS metadata (privacy)
   * - Resize to fit within maxDimension (maintain aspect ratio)
   * - Convert to WebP at configured quality
   * - Re-encode from scratch (destroys any embedded malicious payloads)
   */
  private async processImage(inputPath: string): Promise<Buffer> {
    const raw = await readFile(inputPath);
    const { fileTypeFromBuffer } = await loadFileType();
    const detected = await fileTypeFromBuffer(raw);
    if (!detected || !ALLOWED_MIME.includes(detected.mime)) {
      throw new BadRequestException('Uploaded file is not a valid image');
    }
    return sharp(raw)
      .rotate()           // auto-orient from EXIF before stripping
      .resize(this.maxDimension, this.maxDimension, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: this.webpQuality })
      .toBuffer();
  }

  /**
   * Upload a file to the configured storage backend.
   * The image is processed through sharp (resize, compress, strip metadata)
   * before being stored — regardless of storage driver.
   *
   * @param file   Multer file (already saved to disk by diskStorage)
   * @param folder Sub-folder, e.g. 'categories', 'activities'
   * @returns Public URL for the processed image
   */
  async upload(file: Express.Multer.File, folder: string): Promise<string> {
    // Process through sharp — the safety net regardless of what the client sent
    const processed = await this.processImage(file.path);

    if (this.driver === 's3') {
      return this.uploadToS3(processed, file, folder);
    }
    return this.saveLocal(processed, file, folder);
  }

  // ─── Local (development) ───────────────────────────────────────────────

  private async saveLocal(buffer: Buffer, file: Express.Multer.File, folder: string): Promise<string> {
    // Overwrite the original file with the processed WebP
    const dir = join(process.cwd(), 'uploads', folder);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const unique = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const filename = `${unique}.webp`;
    const outPath = join(dir, filename);

    await writeFile(outPath, buffer);

    // Remove the original multer temp file (it's the raw upload, not processed)
    if (file.path !== outPath) {
      await unlink(file.path).catch(() => {});
    }

    return `${this.apiUrl}/uploads/${folder}/${filename}`;
  }

  // ─── S3 (production) ──────────────────────────────────────────────────

  private async uploadToS3(buffer: Buffer, file: Express.Multer.File, folder: string): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const client = await this.getS3Client();

    const key = `${folder}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.webp`;

    await client.send(
      new PutObjectCommand({
        Bucket: this.s3Bucket,
        Key: key,
        Body: buffer,
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    // Clean up local temp file (diskStorage wrote it to disk first)
    await unlink(file.path).catch(() => {});

    // Return CDN URL if configured, otherwise direct S3 URL
    if (this.cdnUrl) {
      return `${this.cdnUrl}/${key}`;
    }
    return `https://${this.s3Bucket}.s3.${this.s3Region}.amazonaws.com/${key}`;
  }

  /**
   * Helper: build multer diskStorage config for a given folder.
   * Used by FileInterceptor in controllers.
   * Files are saved to a temp location — the `upload()` method processes
   * and moves them to the final destination.
   */
  static diskStorageConfig(folder: string) {
    const maxSize = Number(process.env.UPLOAD_MAX_SIZE_MB || '10') * 1024 * 1024;
    return {
      storage: diskStorage({
        destination: (_req: any, _file: any, cb: any) => {
          const dir = join(process.cwd(), 'uploads', folder);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req: any, file: any, cb: any) => {
          const unique = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
          const safeExt = MIME_TO_EXT[file.mimetype] || '.jpg';
          cb(null, `${unique}${safeExt}`);
        },
      }),
      limits: { fileSize: maxSize },
      fileFilter: (_req: any, file: any, cb: any) => {
        if (!ALLOWED_MIME.includes(file.mimetype)) {
          return cb(new BadRequestException('Only JPEG, PNG, WebP, or GIF images are allowed'), false);
        }
        const ext = (file.originalname.split('.').pop() || '').toLowerCase();
        if (!ALLOWED_EXT.includes(`.${ext}`)) {
          return cb(new BadRequestException('Invalid file extension'), false);
        }
        cb(null, true);
      },
    };
  }
}
