import 'server-only';
import {
  AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand,
  GetObjectCommand, PutObjectCommand, S3Client, UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export type Part = { n: number; etag: string; size: number };

export interface Storage {
  createMultipart(key: string, mime: string): Promise<string>;
  uploadPart(key: string, uploadId: string, n: number, body: Buffer): Promise<string>;
  completeMultipart(key: string, uploadId: string, parts: Part[]): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
  put(key: string, body: Buffer, mime: string): Promise<void>;
  getBuffer(key: string): Promise<Buffer>;
  // Ссылка на скачивание с коротким сроком жизни (S3) или null, если файл отдаёт сам сервер.
  signedUrl(key: string, opts: { filename: string; mime: string; inline: boolean }): Promise<string | null>;
  // Отдача файла сервером (локальный режим), с поддержкой Range для видео.
  serve(key: string, range: string | null): Promise<{ status: number; headers: Record<string, string>; body: ReadableStream }>;
}

/* ---------------- S3 (Yandex Object Storage) ---------------- */

class S3Storage implements Storage {
  private client: S3Client;
  private bucket: string;

  constructor() {
    this.bucket = must('S3_BUCKET');
    this.client = new S3Client({
      endpoint: process.env.S3_ENDPOINT || 'https://storage.yandexcloud.net',
      region: process.env.S3_REGION || 'ru-central1',
      credentials: { accessKeyId: must('S3_ACCESS_KEY_ID'), secretAccessKey: must('S3_SECRET_ACCESS_KEY') },
      forcePathStyle: true,
    });
  }

  async createMultipart(key: string, mime: string) {
    const r = await this.client.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: mime }));
    if (!r.UploadId) throw new Error('Хранилище не вернуло UploadId');
    return r.UploadId;
  }

  async uploadPart(key: string, uploadId: string, n: number, body: Buffer) {
    const r = await this.client.send(new UploadPartCommand({
      Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: n, Body: body, ContentLength: body.length,
    }));
    if (!r.ETag) throw new Error('Хранилище не вернуло ETag');
    return r.ETag;
  }

  async completeMultipart(key: string, uploadId: string, parts: Part[]) {
    await this.client.send(new CompleteMultipartUploadCommand({
      Bucket: this.bucket, Key: key, UploadId: uploadId,
      MultipartUpload: { Parts: [...parts].sort((a, b) => a.n - b.n).map(p => ({ PartNumber: p.n, ETag: p.etag })) },
    }));
  }

  async abortMultipart(key: string, uploadId: string) {
    await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }));
  }

  async put(key: string, body: Buffer, mime: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: mime }));
  }

  async getBuffer(key: string) {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }

  async signedUrl(key: string, opts: { filename: string; mime: string; inline: boolean }) {
    return getSignedUrl(this.client, new GetObjectCommand({
      Bucket: this.bucket, Key: key,
      ResponseContentType: opts.mime,
      ResponseContentDisposition: contentDisposition(opts.filename, opts.inline),
    }), { expiresIn: 300 });
  }

  serve(): never {
    throw new Error('S3: используйте signedUrl');
  }
}

/* ---------------- Локальная папка (разработка) ---------------- */

class LocalStorage implements Storage {
  private root = path.resolve(process.env.STORAGE_LOCAL_DIR || '.data/files');

  private file(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error('Недопустимый путь');
    return p;
  }
  private partsDir(uploadId: string) {
    return path.join(this.root, '.multipart', uploadId.replace(/[^\w-]/g, ''));
  }

  async createMultipart() {
    const id = createHash('sha1').update(String(Math.random()) + Date.now()).digest('hex');
    await mkdir(this.partsDir(id), { recursive: true });
    return id;
  }

  async uploadPart(_key: string, uploadId: string, n: number, body: Buffer) {
    await writeFile(path.join(this.partsDir(uploadId), String(n).padStart(5, '0')), body);
    return '"' + createHash('md5').update(body).digest('hex') + '"';
  }

  async completeMultipart(key: string, uploadId: string, parts: Part[]) {
    const dir = this.partsDir(uploadId);
    const dest = this.file(key);
    await mkdir(path.dirname(dest), { recursive: true });
    const out = createWriteStream(dest);
    for (const p of [...parts].sort((a, b) => a.n - b.n)) {
      await pipeline(createReadStream(path.join(dir, String(p.n).padStart(5, '0'))), out, { end: false });
    }
    await new Promise<void>((res, rej) => out.end((e?: Error | null) => (e ? rej(e) : res())));
    await rm(dir, { recursive: true, force: true });
  }

  async abortMultipart(_key: string, uploadId: string) {
    await rm(this.partsDir(uploadId), { recursive: true, force: true });
  }

  async put(key: string, body: Buffer) {
    const dest = this.file(key);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, body);
  }

  async getBuffer(key: string) {
    return readFile(this.file(key));
  }

  async signedUrl() {
    return null;
  }

  async serve(key: string, range: string | null): Promise<{ status: number; headers: Record<string, string>; body: ReadableStream }> {
    const p = this.file(key);
    const { size } = await stat(p);
    const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : size - Number(m[2]);
      let end = m[1] && m[2] ? Number(m[2]) : size - 1;
      start = Math.max(0, start);
      end = Math.min(size - 1, end);
      if (start > end) {
        return { status: 416, headers: { 'Content-Range': `bytes */${size}` }, body: emptyStream() };
      }
      return {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' },
        body: Readable.toWeb(createReadStream(p, { start, end })) as ReadableStream,
      };
    }
    return {
      status: 200,
      headers: { 'Content-Length': String(size), 'Accept-Ranges': 'bytes' },
      body: Readable.toWeb(createReadStream(p)) as ReadableStream,
    };
  }

  // для тестов
  async listAll() {
    return readdir(this.root, { recursive: true });
  }
}

function emptyStream() {
  return new ReadableStream({ start: c => c.close() });
}

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Не задана переменная окружения ${name}`);
  return v;
}

export function contentDisposition(filename: string, inline: boolean) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

let instance: Storage | null = null;
export function storage(): Storage {
  if (!instance) instance = process.env.STORAGE_DRIVER === 's3' ? new S3Storage() : new LocalStorage();
  return instance;
}
