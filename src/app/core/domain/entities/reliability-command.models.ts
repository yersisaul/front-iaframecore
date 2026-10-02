import { parseUtcDate } from '../../utils/date-utils';

export type CommandStatus = 'PENDING' | 'DISPATCHED' | 'SENT' | 'ACKED' | 'APPLIED' | 'VERIFIED' | 'FAILED' | string;

export interface ReliabilityCommandDTO {
  command_id: string;
  correlation_id: string | null;
  command_type: string;
  action: string;
  schedule_id: string | null;
  analytic_id: string | null;
  fingerprint_host: string | null;
  desired_state: string | null;
  status: CommandStatus;
  attempt: number;
  max_attempts: number;
  ack_count: number;
  late_ack: boolean;
  sent_by: string | null;
  last_error: string | null;
  leader_epoch: number | null;
  created_at: string;
  last_dispatched_at: string | null;
  sent_at: string | null;
  acked_at: string | null;
  applied_at: string | null;
  verified_at: string | null;
  failed_at: string | null;
  next_attempt_at: string | null;
  updated_at: string | null;
}

export interface ReliabilityCommand {
  id: string;
  correlationId: string | null;
  commandType: string;
  action: string;
  scheduleId: string | null;
  analyticId: string | null;
  fingerprintHost: string | null;
  desiredState: string | null;
  status: CommandStatus;
  attempt: number;
  maxAttempts: number;
  ackCount: number;
  lateAck: boolean;
  sentBy: string | null;
  lastError: string | null;
  leaderEpoch: number | null;
  createdAt: Date;
  lastDispatchedAt: Date | null;
  sentAt: Date | null;
  ackedAt: Date | null;
  appliedAt: Date | null;
  verifiedAt: Date | null;
  failedAt: Date | null;
  nextAttemptAt: Date | null;
  updatedAt: Date | null;
  rawJson: ReliabilityCommandDTO;
}

export interface ReliabilityCommandQueryParams {
  analytic_id?: string;
  fingerprint_host?: string;
  schedule_id?: string;
  correlation_id?: string;
  status?: string;
  since?: string;
  until?: string;
  limit?: number;
}

export class ReliabilityCommandMapper {
  static toDomain(dto: ReliabilityCommandDTO): ReliabilityCommand {
    return {
      id: dto.command_id,
      correlationId: dto.correlation_id || null,
      commandType: dto.command_type || '',
      action: dto.action || '',
      scheduleId: dto.schedule_id || null,
      analyticId: dto.analytic_id || null,
      fingerprintHost: dto.fingerprint_host || null,
      desiredState: dto.desired_state || null,
      status: (dto.status || 'PENDING').toUpperCase(),
      attempt: dto.attempt ?? 1,
      maxAttempts: dto.max_attempts ?? 5,
      ackCount: dto.ack_count ?? 0,
      lateAck: !!dto.late_ack,
      sentBy: dto.sent_by || null,
      lastError: dto.last_error || null,
      leaderEpoch: dto.leader_epoch ?? null,
      createdAt: parseUtcDate(dto.created_at),
      lastDispatchedAt: dto.last_dispatched_at ? parseUtcDate(dto.last_dispatched_at) : null,
      sentAt: dto.sent_at ? parseUtcDate(dto.sent_at) : null,
      ackedAt: dto.acked_at ? parseUtcDate(dto.acked_at) : null,
      appliedAt: dto.applied_at ? parseUtcDate(dto.applied_at) : null,
      verifiedAt: dto.verified_at ? parseUtcDate(dto.verified_at) : null,
      failedAt: dto.failed_at ? parseUtcDate(dto.failed_at) : null,
      nextAttemptAt: dto.next_attempt_at ? parseUtcDate(dto.next_attempt_at) : null,
      updatedAt: dto.updated_at ? parseUtcDate(dto.updated_at) : null,
      rawJson: dto
    };
  }
}
