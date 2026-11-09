import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { DataSource, Repository } from 'typeorm';
import { FileAttachment } from './entities/file-attachment.entity';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED = new Map<string, { mime: string; signature: (b: Buffer) => boolean }>([
  ['.pdf', { mime: 'application/pdf', signature: b => b.length >= 5 && b.subarray(0, 5).toString() === '%PDF-' }],
  ['.png', { mime: 'image/png', signature: b => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) }],
  ['.jpg', { mime: 'image/jpeg', signature: b => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff }],
  ['.jpeg', { mime: 'image/jpeg', signature: b => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff }],
  ['.webp', { mime: 'image/webp', signature: b => b.length >= 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' }],
]);

@Injectable()
export class FileAttachmentsService {
  private readonly storageRoot = resolve(process.env.FSB_FILE_STORAGE_PATH ?? 'var/private-files');

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(FileAttachment) private readonly attachments: Repository<FileAttachment>,
  ) {}

  private getStoragePath(key: string) {
    if (!/^[0-9a-f-]{36}$/i.test(key)) throw new NotFoundException('Attachment not found');
    const target = resolve(this.storageRoot, key);
    if (!target.startsWith(this.storageRoot + sep)) throw new NotFoundException('Attachment not found');
    return target;
  }

  async upload(versionId: string, submissionId: string, tenantId: string | null | undefined, userId: string, file?: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    if (!file?.buffer?.length) throw new BadRequestException('A file is required');
    if (file.size > MAX_FILE_SIZE || file.buffer.length > MAX_FILE_SIZE) throw new BadRequestException('Maximum file size is 10 MB');

    const ext = file.originalname.slice(file.originalname.lastIndexOf('.')).toLowerCase();
    const policy = ALLOWED.get(ext);
    if (!policy || !policy.signature(file.buffer)) throw new BadRequestException('Only valid PDF, PNG, JPEG and WEBP files are accepted');
    if (file.mimetype && file.mimetype !== policy.mime && file.mimetype !== 'application/octet-stream') {
      throw new BadRequestException('File content type does not match its extension');
    }

    const submission = await this.dataSource.query(
      `SELECT fs.id, fs."tenantId"
         FROM form_submissions fs
         INNER JOIN form_versions fv ON fv.id = fs."formVersionId"
         INNER JOIN form_definitions fd ON fd.id = fv."definitionId"
         INNER JOIN organizations o ON o.id = fd."organizationId"
         INNER JOIN tenants t ON t.id = o."tenantId"
        WHERE fs.id = $1 AND fv.id = $2 AND fs."tenantId" = $3
          AND o."tenantId" = $3 AND o."isActive" = true AND t.status = 'ACTIVE'`,
      [submissionId, versionId, tenantId],
    );
    if (!submission.length) throw new NotFoundException('Submission not found in the active customer account');
    const id = randomUUID();
    const storageKey = randomUUID();
    const safeName = Array.from(file.originalname).map(char => { const code = char.charCodeAt(0); return char === '/' || char === '\\' || code <= 31 || code === 127 ? '_' : char; }).join('').slice(0, 255) || 'attachment';
    const hash = createHash('sha256').update(file.buffer).digest('hex');
    await mkdir(this.storageRoot, { recursive: true, mode: 0o700 });
    await chmod(this.storageRoot, 0o700);
    const path = this.getStoragePath(storageKey);
    try {
      const saved = await this.dataSource.transaction(async manager => {
        const [entitlement] = await manager.query(
          `SELECT p.limits,s.status,s."currentPeriodEnd",s."trialEndsAt"
             FROM tenants t
             JOIN tenant_subscriptions s ON s."tenantId"=t.id
             JOIN commercial_plans p ON p.code=s."planCode"
            WHERE t.id=$1 AND t.status='ACTIVE'
              AND s.status IN ('ACTIVE','TRIALING')
              AND (s."currentPeriodEnd" IS NULL OR s."currentPeriodEnd">now())
              AND (s.status<>'TRIALING' OR s."trialEndsAt" IS NULL OR s."trialEndsAt">now())
            FOR UPDATE OF t,s`,
          [tenantId],
        );
        if (!entitlement) throw new ForbiddenException('Tenant subscription is not eligible for file uploads');
        const maxStorage = BigInt(String(entitlement.limits?.maxStorageBytes ?? 0));
        if (maxStorage <= 0n) throw new ForbiddenException('File storage is not enabled for this tenant plan');
        const [usage] = await manager.query(
          'SELECT COALESCE(sum(size::numeric),0)::text AS bytes FROM file_attachments WHERE "tenantId"=$1',
          [tenantId],
        );
        const usedBytes = BigInt(usage?.bytes ?? '0');
        if (usedBytes + BigInt(file.buffer.length) > maxStorage) {
          throw new BadRequestException('The active subscription file storage quota has been reached');
        }
        await writeFile(path, file.buffer, { flag: 'wx', mode: 0o600 });
        const repository = manager.getRepository(FileAttachment);
        return repository.save(repository.create({
          id, submissionId, uploadedByUserId: userId, originalName: safeName,
          storageKey, mimeType: policy.mime, size: String(file.buffer.length), sha256: hash,
        }));
      });
      return { id: saved.id, submissionId: saved.submissionId, originalName: saved.originalName, mimeType: saved.mimeType, size: Number(saved.size), sha256: saved.sha256, createdAt: saved.createdAt };
    } catch (error) {
      await unlink(path).catch(() => undefined);
      throw error;
    }
  }


  async list(versionId: string, submissionId: string, tenantId: string | null | undefined) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    const rows = await this.attachments.createQueryBuilder('attachment')
      .innerJoin('attachment.submission', 'submission')
      .innerJoin('submission.formVersion', 'version')
      .innerJoin('version.definition', 'definition')
      .innerJoin('definition.organization', 'organization')
      .innerJoin('organization.tenant', 'tenant')
      .where('submission.id = :submissionId', { submissionId })
      .andWhere('version.id = :versionId', { versionId })
      .andWhere('attachment.tenantId = :tenantId', { tenantId })
      .andWhere('organization.tenantId = :tenantId', { tenantId })
      .andWhere('tenant.status = :status', { status: 'ACTIVE' })
      .andWhere('organization.isActive = true')
      .orderBy('attachment.createdAt', 'DESC')
      .getMany();
    return rows.map(item => ({
      id: item.id, submissionId: item.submissionId, originalName: item.originalName,
      mimeType: item.mimeType, size: Number(item.size), sha256: item.sha256, createdAt: item.createdAt,
    }));
  }

  async getForDownload(versionId: string, submissionId: string, attachmentId: string, tenantId: string | null | undefined) {
    if (!tenantId) throw new ForbiddenException('An active tenant context is required');
    const attachment = await this.attachments.createQueryBuilder('attachment')
      .innerJoin('attachment.submission', 'submission')
      .innerJoin('submission.formVersion', 'version')
      .innerJoin('version.definition', 'definition')
      .innerJoin('definition.organization', 'organization')
      .innerJoin('organization.tenant', 'tenant')
      .where('attachment.id = :attachmentId', { attachmentId })
      .andWhere('submission.id = :submissionId', { submissionId })
      .andWhere('version.id = :versionId', { versionId })
      .andWhere('attachment.tenantId = :tenantId', { tenantId })
      .andWhere('tenant.status = :status', { status: 'ACTIVE' })
      .andWhere('organization.isActive = true')
      .getOne();
    if (!attachment) throw new NotFoundException('Attachment not found');
    const buffer = await readFile(this.getStoragePath(attachment.storageKey)).catch(() => { throw new NotFoundException('Attachment content is unavailable'); });
    const digest = createHash('sha256').update(buffer).digest('hex');
    if (digest !== attachment.sha256 || buffer.length !== Number(attachment.size)) {
      throw new BadRequestException('Stored attachment integrity check failed');
    }
    return { attachment, buffer };
  }
}
