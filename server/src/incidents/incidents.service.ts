import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Incident, IncidentType } from '../entities';
import { now, seqCode } from '../common';

export interface CreateIncidentInput {
  type: IncidentType;
  title: string;
  detail?: string;
  severity?: 'info' | 'warn' | 'critical';
  ticketId?: number | null;
  tripId?: number | null;
  stationId?: number | null;
  vehicleId?: number | null;
  refundId?: number | null;
  skipRecordId?: number | null;
  raisedByRole?: Incident['raisedByRole'];
  ownerRole?: Incident['ownerRole'];
  status?: Incident['status'];
  firstNote?: string;
}

@Injectable()
export class IncidentsService {
  constructor(
    @InjectRepository(Incident) private readonly repo: Repository<Incident>,
  ) {}

  async create(input: CreateIncidentInput): Promise<Incident> {
    const at = now();
    const inc = this.repo.create({
      code: seqCode('IN'),
      type: input.type,
      severity: input.severity || 'warn',
      title: input.title,
      detail: input.detail || '',
      ticketId: input.ticketId ?? null,
      tripId: input.tripId ?? null,
      stationId: input.stationId ?? null,
      vehicleId: input.vehicleId ?? null,
      refundId: input.refundId ?? null,
      skipRecordId: input.skipRecordId ?? null,
      raisedByRole: input.raisedByRole || 'system',
      ownerRole: input.ownerRole || 'dispatch',
      status: input.status || 'open',
      resolution: '',
      timeline: input.firstNote
        ? [{ at, role: input.raisedByRole || 'system', text: input.firstNote }]
        : [],
      createdAt: at,
    });
    return this.repo.save(inc);
  }

  async addNote(id: number, role: string, text: string) {
    const inc = await this.repo.findOne({ where: { id } });
    if (!inc) return null;
    const tl = inc.timeline || [];
    tl.push({ at: now(), role, text });
    inc.timeline = tl;
    return this.repo.save(inc);
  }

  async list(filter: {
    status?: string; ticketId?: number; tripId?: number; type?: string;
  } = {}): Promise<Incident[]> {
    const qb = this.repo.createQueryBuilder('i').orderBy('i.id', 'DESC');
    if (filter.status) qb.andWhere('i.status = :s', { s: filter.status });
    if (filter.type) qb.andWhere('i.type = :t', { t: filter.type });
    if (filter.ticketId) qb.andWhere('i.ticketId = :tid', { tid: filter.ticketId });
    if (filter.tripId) qb.andWhere('i.tripId = :pid', { pid: filter.tripId });
    return qb.getMany();
  }

  async byTicketOrTrip(ticketId?: number, tripId?: number): Promise<Incident[]> {
    const qb = this.repo.createQueryBuilder('i').orderBy('i.id', 'ASC');
    if (ticketId) qb.andWhere('i.ticketId = :tid', { tid: ticketId });
    if (tripId) qb.orWhere('i.tripId = :pid', { pid: tripId });
    return qb.getMany();
  }

  async update(id: number, patch: Partial<Incident>, note?: { role: string; text: string }) {
    const inc = await this.repo.findOne({ where: { id } });
    if (!inc) return null;
    Object.assign(inc, patch);
    if (note) {
      const tl = inc.timeline || [];
      tl.push({ at: now(), role: note.role, text: note.text });
      inc.timeline = tl;
    }
    return this.repo.save(inc);
  }

  async get(id: number): Promise<Incident | null> {
    return this.repo.findOne({ where: { id } });
  }
}
