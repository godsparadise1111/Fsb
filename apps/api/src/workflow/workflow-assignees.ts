import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

export async function resolveWorkflowStepAssignees(
  manager: Pick<EntityManager, 'query'>,
  organizationId: string,
  tenantId: string,
  config: Record<string, unknown>,
): Promise<string[]> {
  const readIds = (field: string): string[] => {
    const value = config[field];
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
      throw new BadRequestException(`Invalid ${field} in published process step`);
    }
    return [...new Set(value as string[])];
  };
  const userIds = readIds('assigneeUserIds');
  const positionIds = readIds('assigneePositionIds');
  const unitIds = readIds('assigneeUnitIds');
  if (userIds.length + positionIds.length + unitIds.length === 0) {
    throw new BadRequestException('A workflow step must target users, positions or organizational units');
  }
  if (userIds.length + positionIds.length + unitIds.length > 50) {
    throw new BadRequestException('A workflow step cannot contain more than 50 assignment targets');
  }
  if (positionIds.length) {
    const [valid] = await manager.query(
      `SELECT count(*)::int AS count FROM positions p
        JOIN organization_units ou ON ou.id=p."organizationUnitId" AND ou."organizationId"=$1 AND ou."isActive"=true
       WHERE p.id=ANY($2::uuid[]) AND p."isActive"=true`,
      [organizationId, positionIds],
    );
    if (Number(valid?.count ?? 0) !== positionIds.length) {
      throw new BadRequestException('Every assigned position must be active and belong to the process organization');
    }
  }
  if (unitIds.length) {
    const [valid] = await manager.query(
      'SELECT count(*)::int AS count FROM organization_units WHERE id=ANY($2::uuid[]) AND "organizationId"=$1 AND "isActive"=true',
      [organizationId, unitIds],
    );
    if (Number(valid?.count ?? 0) !== unitIds.length) {
      throw new BadRequestException('Every assigned unit must be active and belong to the process organization');
    }
  }
  const resolved = await manager.query(
    `SELECT DISTINCT up."userId"
       FROM user_positions up
       JOIN positions p ON p.id=up."positionId" AND p."isActive"=true
       JOIN organization_units ou ON ou.id=p."organizationUnitId" AND ou."organizationId"=$1 AND ou."isActive"=true
       JOIN tenant_memberships tm ON tm."tenantId"=$2 AND tm."userId"=up."userId" AND tm."isActive"=true
       JOIN users u ON u.id=up."userId" AND u."isActive"=true
       JOIN organizations org ON org.id=ou."organizationId" AND org."tenantId"=$2 AND org."isActive"=true
       JOIN tenants t ON t.id=org."tenantId" AND t.status='ACTIVE'
      WHERE up."isActive"=true AND up."validFrom"<=now()
        AND (up."validUntil" IS NULL OR up."validUntil">=now())
        AND (up."userId"=ANY($3::uuid[]) OR p.id=ANY($4::uuid[]) OR ou.id=ANY($5::uuid[]))
      ORDER BY up."userId" LIMIT 51`,
    [organizationId, tenantId, userIds, positionIds, unitIds],
  ) as Array<{ userId: string }>;
  const resolvedIds = resolved.map(row => row.userId);
  if (!resolvedIds.length || resolvedIds.length > 50) {
    throw new BadRequestException('Assignment targets must resolve to between 1 and 50 active users in this organization');
  }
  const resolvedSet = new Set(resolvedIds);
  if (userIds.some(id => !resolvedSet.has(id))) {
    throw new BadRequestException('Every directly assigned user must have an active tenant membership and position in the process organization');
  }
  return resolvedIds;
}
