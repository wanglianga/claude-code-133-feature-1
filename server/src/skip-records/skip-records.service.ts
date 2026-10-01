import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  SkipRecord, Station, Trip, Vehicle, QueueEntry, Ticket, RouteLine,
  Incident, Driver, GeofenceEvent,
} from '../entities';
import { IncidentsService } from '../incidents/incidents.service';
import { now, seqCode } from '../common';

/**
 * 满载跳站解释记录：站务、调度、游客、客服围绕同一条记录协同。
 * 记录链路：系统/站务登记（原因+车内人数+下一班ETA）
 *   → 站点负责人确认 → 调度处置（增派空车/留座规则）→ 调度主管复核
 *   →（游客投诉时）客服用同一记录办结 → 自动闭环。
 */
@Injectable()
export class SkipRecordsService {
  constructor(
    @InjectRepository(SkipRecord) private readonly repo: Repository<SkipRecord>,
    @InjectRepository(Station) private readonly stations: Repository<Station>,
    @InjectRepository(Trip) private readonly trips: Repository<Trip>,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(QueueEntry) private readonly queue: Repository<QueueEntry>,
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @InjectRepository(RouteLine) private readonly routes: Repository<RouteLine>,
    @InjectRepository(Incident) private readonly incidents: Repository<Incident>,
    @InjectRepository(Driver) private readonly drivers: Repository<Driver>,
    @InjectRepository(GeofenceEvent) private readonly geofence: Repository<GeofenceEvent>,
    private readonly incidentSvc: IncidentsService,
  ) {}

  /* ================= 登记（车辆到站满载自动触发，也可站务补录） ================= */

  async recordFromArrival(input: {
    trip: Trip; vehicle: Vehicle; station: Station;
    waiting: QueueEntry[]; reason?: string; raisedByRole?: Incident['raisedByRole'];
  }): Promise<SkipRecord> {
    const { trip, vehicle, station } = input;
    const waitingPeople = input.waiting.reduce((a, e) => a + e.partySize, 0);
    const eta = await this.nextEta(station, trip.id, trip.routeId);
    const neighbors = await this.neighborStations(station);
    const compensation = eta.minutes >= 15
      ? `候车预计约 ${eta.minutes} 分钟（≥15 分钟）：每位等候游客发放矿泉水 1 瓶 + 下次乘车 8 折等待补偿券；不愿继续等候者可由站务引导全额退票或改签当日后续班次`
      : `候车预计约 ${eta.minutes} 分钟：每位等候游客发放矿泉水 1 瓶/候车小礼品；如需离园可联系站务改签当日后续班次`;
    const transferAdvice = `赶时间的游客可步行约 6–10 分钟至相邻站「${neighbors.prev}」或「${neighbors.next}」乘坐对向/后续班次；行动不便及轮椅游客请在原地优先通道等候，站务可安排电瓶车短驳`;

    const rec = await this.repo.save(this.repo.create({
      code: seqCode('SR'),
      stationId: station.id, tripId: trip.id, vehicleId: vehicle.id,
      reason: input.reason || '车辆到达本站时座位余量为 0（已满载），按调度规则越站通过，站台游客无法上车',
      onboardCount: trip.seatsSold, capacity: vehicle.capacity,
      waitingGroups: input.waiting.length, waitingPeople,
      nextTripCode: eta.tripCode, nextEtaAt: eta.at, nextEtaMinutes: eta.minutes,
      compensation, transferAdvice,
      waitingPolicy: '原地等候下一班，优先组仍按「优先组优先 + 同组 FIFO」叫号；站务已广播说明，下一班将优先接走本站滞留游客',
      timeline: [
        { at: now(), role: input.raisedByRole || 'system',
          text: `电子围栏识别 ${vehicle.code} 到站满载（车内 ${trip.seatsSold}/${vehicle.capacity} 人），自动登记跳站；${input.waiting.length} 组/${waitingPeople} 人未能上车并转回候乘` },
      ],
      createdAt: now(),
    }));

    // 站台候乘游客转回排队（保留 skipRecordId，供车票时间线/统计追溯）
    for (const e of input.waiting) {
      e.status = 'skipped';
      e.skipRecordId = rec.id;
      await this.queue.save(e);
    }

    const inc = await this.incidentSvc.create({
      type: 'skip_station', severity: 'critical',
      title: `满载跳站：${trip.code} 越过 ${station.name}`,
      detail: `跳站记录 ${rec.code}：车内 ${trip.seatsSold}/${vehicle.capacity} 人已满载，站台 ${waitingPeople} 人等待；下一班 ${eta.tripCode || '（按计划间隔）'} 预计 ${eta.minutes} 分钟到达。游客侧已推送等待补偿与换乘建议，等待站点负责人确认、调度主管复核`,
      tripId: trip.id, stationId: station.id, vehicleId: vehicle.id,
      raisedByRole: input.raisedByRole || 'system', ownerRole: 'dispatch',
      firstNote: `已生成跳站解释记录 ${rec.code}，站务/调度/游客/客服共用同一条记录`,
    });
    rec.incidentId = inc.id;
    await this.repo.save(rec);
    return this.get(rec.id) as Promise<SkipRecord>;
  }

  /** 站务补录（围栏漏判等情况） */
  async manualCreate(stationId: number, body: {
    tripId?: number; vehicleId?: number;
    onboardCount?: number; reason?: string; nextEtaMinutes?: number;
  }) {
    const station = await this.stations.findOne({ where: { id: stationId } });
    if (!station) throw new NotFoundException('站点不存在');
    let trip: Trip | null = null;
    let vehicle: Vehicle | null = null;
    if (body.tripId) {
      trip = await this.trips.findOne({ where: { id: body.tripId } });
      if (!trip) throw new NotFoundException('班次不存在');
      vehicle = await this.vehicles.findOne({ where: { id: trip.vehicleId } });
    } else if (body.vehicleId) {
      vehicle = await this.vehicles.findOne({ where: { id: body.vehicleId } });
      if (!vehicle) throw new NotFoundException('车辆不存在');
    }
    if (!trip || !vehicle) throw new BadRequestException('请指定跳站班次（或车辆）');
    const waiting = await this.queue.find({
      where: { stationId, status: In(['waiting', 'called']) },
    });
    return this.recordFromArrival({
      trip, vehicle, station, waiting,
      reason: body.reason, raisedByRole: 'staff',
    });
  }

  /* ================= 查询（各端同步查看同一条记录） ================= */

  async list(filter: { stationId?: number; status?: string; complaint?: string } = {}) {
    const rows = await this.repo.find({ order: { id: 'DESC' }, take: 50 });
    const decorated = await this.decorateMany(rows);
    return decorated.filter(r =>
      (!filter.stationId || r.stationId === Number(filter.stationId))
      && (!filter.status || r.status === filter.status)
      && (!filter.complaint || r.complaintStatus === filter.complaint));
  }

  async get(id: number) {
    const rec = await this.repo.findOne({ where: { id } });
    if (!rec) return null;
    return this.decorate(rec);
  }

  async byTicket(ticketId: number) {
    const entries = await this.queue.find({ where: { ticketId } });
    const ids = Array.from(new Set(entries.map(e => e.skipRecordId).filter(Boolean))) as number[];
    if (!ids.length) return [];
    const rows = await this.repo.find({ where: { id: In(ids) }, order: { id: 'ASC' } });
    return this.decorateMany(rows);
  }

  async activeForStation(stationId: number) {
    const rows = await this.repo.find({
      where: { stationId },
      order: { id: 'DESC' },
      take: 10,
    });
    return this.decorateMany(rows.filter(r => r.status !== 'closed'));
  }

  /** 调度看板：未闭环的跳站记录 */
  async openRecords() {
    const rows = await this.repo.find({
      where: { status: In(['recorded', 'station_confirmed', 'dispatch_reviewed']) },
      order: { id: 'DESC' },
    });
    return this.decorateMany(rows);
  }

  private async decorateMany(rows: SkipRecord[]) {
    return Promise.all(rows.map(r => this.decorate(r)));
  }

  private async decorate(rec: SkipRecord) {
    const [station, trip, vehicle, reliefTrip, incident] = await Promise.all([
      this.stations.findOne({ where: { id: rec.stationId } }),
      this.trips.findOne({ where: { id: rec.tripId } }),
      this.vehicles.findOne({ where: { id: rec.vehicleId } }),
      rec.reliefTripId ? this.trips.findOne({ where: { id: rec.reliefTripId } }) : null,
      rec.incidentId ? this.incidents.findOne({ where: { id: rec.incidentId } }) : null,
    ]);
    const route = station
      ? await this.routes.findOne({ where: { id: station.routeId } })
      : null;
    const affectedEntries = await this.queue.find({ where: { skipRecordId: rec.id } });
    const ticketRows = await this.tickets.find({
      where: { id: In(affectedEntries.map(e => e.ticketId)) },
    });
    return {
      ...rec,
      stationName: station?.name || `#${rec.stationId}`,
      routeName: route?.name || '',
      tripCode: trip?.code || '',
      vehicleCode: vehicle?.code || '',
      reliefTripCode: reliefTrip?.code || '',
      incidentCode: incident?.code || '',
      incidentStatus: incident?.status || null,
      affectedGroups: affectedEntries.map(e => ({
        entryId: e.id, ticketId: e.ticketId, partySize: e.partySize,
        priority: e.priority, queueStatus: e.status,
        visitorName: ticketRows.find(t => t.id === e.ticketId)?.visitorName || '',
        ticketCode: ticketRows.find(t => t.id === e.ticketId)?.code || '',
      })),
    };
  }

  /* ================= 站点负责人确认 / 站务重新组织排队 ================= */

  async stationConfirm(id: number, body: { note?: string; managerName?: string }) {
    const rec = await this.require(id);
    if (rec.stationConfirmedAt) throw new BadRequestException('站点负责人已确认，请勿重复提交');
    rec.stationConfirmedAt = now();
    rec.stationConfirmedBy = body.managerName || '站点负责人';
    rec.stationManagerNote = body.note || '情况属实：车辆满载越站，已按等候策略安抚滞留游客并广播';
    if (rec.status === 'recorded') rec.status = 'station_confirmed';
    await this.push(rec, 'staff',
      `站点负责人 ${rec.stationConfirmedBy} 确认：${rec.stationManagerNote}`);
    return this.saveAndGet(rec);
  }

  /** 站务把受影响游客重新放回候乘队列（下一班非满载到站也会自动转回） */
  async requeueAffected(id: number) {
    const rec = await this.require(id);
    const entries = await this.queue.find({ where: { skipRecordId: rec.id, status: 'skipped' } });
    for (const e of entries) { e.status = 'waiting'; await this.queue.save(e); }
    await this.push(rec, 'staff', `站务将 ${entries.length} 组滞留游客重新转回候乘队列，等待下一班/增派空车`);
    return { requeued: entries.length };
  }

  /** 站务更新本站等候策略（游客端/调度端同步） */
  async updateWaitingPolicy(id: number, policy: string) {
    const rec = await this.require(id);
    rec.waitingPolicy = policy;
    await this.push(rec, 'staff', `站点更新等候策略：${policy}`);
    return this.saveAndGet(rec);
  }

  /* ================= 调度处置：临时增派空车 / 不满载离站留座规则 ================= */

  /** 临时增派空车：以本站为起点立即开一班空车接驳，并把滞留游客转回排队 */
  async dispatchExtraVehicle(id: number, body: { vehicleId: number; driverId: number; note?: string }) {
    const rec = await this.require(id);
    const [station, v, d] = await Promise.all([
      this.stations.findOne({ where: { id: rec.stationId } }),
      this.vehicles.findOne({ where: { id: body.vehicleId } }),
      this.drivers.findOne({ where: { id: body.driverId } }),
    ]);
    if (!station) throw new NotFoundException('站点不存在');
    if (!v || !d) throw new NotFoundException('车辆或司机不存在');

    const blockers: string[] = [];
    if (v.status !== 'idle') blockers.push(`车辆 ${v.code} 当前${vStatus(v.status)}，非待命状态不可临时增派`);
    if (v.reservedForCharter) blockers.push(`车辆 ${v.code} 已被包车预留`);
    if (v.battery < 20) blockers.push(`车辆电量 ${v.battery}% 低于 20%`);
    if (['off', 'rest', 'handover'].includes(d.status)) blockers.push(`司机 ${d.name} 当前不可驾驶（${d.status}）`);
    if (d.restRequired) blockers.push(`司机 ${d.name} 连续驾驶超时须先休息`);
    if (blockers.length) throw new BadRequestException(blockers.join('；'));

    const routeStations = await this.stations.find({
      where: { routeId: station.routeId }, order: { seq: 'ASC' },
    });
    const dest = routeStations[routeStations.length - 1];

    const trip = await this.trips.save(this.trips.create({
      code: seqCode('TR'),
      routeId: station.routeId, vehicleId: v.id, driverId: d.id,
      direction: 'forward', status: 'boarding',
      originStationId: station.id, destStationId: dest.id,
      departAt: now(), seatsTotal: v.capacity, seatsSold: 0,
      wheelchairHeld: 0, boardedCount: 0,
      skippedStations: [], reservedForStations: [station.id],
      delayReason: '',
    }));
    v.status = 'running'; v.currentTripId = trip.id; v.currentStationId = station.id;
    await this.vehicles.save(v);
    d.status = 'driving'; d.currentVehicleId = v.id;
    await this.drivers.save(d);
    await this.geofence.save(this.geofence.create({
      vehicleId: v.id, stationId: station.id, kind: 'enter',
      lat: station.lat, lng: station.lng, at: now(),
    }));

    // 滞留游客自动转回排队，接驳车优先接走
    const entries = await this.queue.find({ where: { skipRecordId: rec.id, status: 'skipped' } });
    for (const e of entries) { e.status = 'waiting'; await this.queue.save(e); }

    rec.reliefTripId = trip.id;
    rec.dispatchAction = `临时增派空车 ${v.code}（司机 ${d.name}）${trip.code} 前往 ${station.name} 接驳滞留游客`;
    rec.dispatchHandledAt = now();
    await this.push(rec, 'dispatch',
      `${rec.dispatchAction}；${entries.length} 组游客已自动转回排队优先检票。${body.note ? `备注：${body.note}` : ''}`);
    return this.saveAndGet(rec);
  }

  /**
   * 调整「车辆不满载离站」规则：为本站设置每辆下行车必须保留的座位数，
   * 上游站检票时自动锁定留座（不得卖满），保证车到本站有余座可上客。
   */
  async setSeatReserve(id: number, body: { seats: number; note?: string }) {
    const rec = await this.require(id);
    const seats = Math.max(0, Number(body.seats) || 0);
    const station = await this.stations.findOne({ where: { id: rec.stationId } });
    if (!station) throw new NotFoundException('站点不存在');
    if (seats > station.platformCapacity) {
      throw new BadRequestException(`留座数 ${seats} 超过站台容量 ${station.platformCapacity}`);
    }
    station.dispatchSeatReserve = seats;
    await this.stations.save(station);
    rec.seatReserveSet = seats;
    rec.dispatchHandledAt = now();
    const text = seats === 0
      ? '调度解除本站留座规则，后续车辆可满载离站'
      : `调度启用不满载离站规则：途经本站的后续车辆在上游站必须预留 ${seats} 个座位（检票链路自动锁定，余座不足时停止上客）`;
    rec.dispatchAction = rec.dispatchAction ? `${rec.dispatchAction}；${text}` : text;
    await this.push(rec, 'dispatch', `${text}。${body.note ? `备注：${body.note}` : ''}`);
    return this.saveAndGet(rec);
  }

  /** 调度主管复核（须站点负责人已确认） */
  async dispatchReview(id: number, body: { note?: string; reviewerName?: string }) {
    const rec = await this.require(id);
    if (!rec.stationConfirmedAt) {
      throw new BadRequestException('请先由站点负责人确认跳站情况，再提交调度主管复核');
    }
    rec.dispatchReviewedAt = now();
    rec.dispatchReviewedBy = body.reviewerName || '调度主管';
    rec.dispatchSupervisorNote = body.note || '复核通过：跳站原因、补偿与调度处置均已落实';
    rec.status = 'dispatch_reviewed';
    await this.push(rec, 'dispatch_supervisor',
      `调度主管 ${rec.dispatchReviewedBy} 复核：${rec.dispatchSupervisorNote}`);
    await this.tryAutoClose(rec);
    return this.saveAndGet(rec);
  }

  async close(id: number, note?: string) {
    const rec = await this.require(id);
    rec.status = 'closed';
    rec.closedAt = now();
    await this.push(rec, 'dispatch', note || '跳站记录闭环');
    return this.saveAndGet(rec);
  }

  /* ================= 游客投诉 → 客服用同一条记录处理 ================= */

  async openComplaint(id: number, body: { ticketId?: number; visitorName?: string; note: string }) {
    const rec = await this.require(id);
    rec.complaintStatus = 'open';
    await this.push(rec, 'visitor',
      `游客${body.visitorName ? ` ${body.visitorName}` : ''}就本次跳站发起投诉/咨询：${body.note}（客服将基于同一条跳站记录处理）`);
    if (rec.incidentId) {
      await this.incidents.update(
        { id: rec.incidentId },
        { status: rec.status === 'closed' ? 'processing' as any : rec.status as any, ownerRole: 'service' as any },
      );
      await this.incidentSvc.addNote(rec.incidentId, 'visitor',
        `关联跳站投诉：${body.note}`);
    }
    return this.saveAndGet(rec);
  }

  async handleComplaint(id: number, body: {
    note: string; resolution: 'compensation' | 'transfer' | 'refund_guide' | 'explain';
    agentName?: string;
  }) {
    const rec = await this.require(id);
    if (rec.complaintStatus === 'none') throw new BadRequestException('该记录暂无待处理投诉');
    const resolutionText: Record<string, string> = {
      compensation: '按等待补偿标准发放补偿券与礼品',
      transfer: '已为游客安排相邻站换乘/电瓶车短驳',
      refund_guide: '引导游客提交全额退票申请，客服将按调度责任核准',
      explain: '已向游客解释跳站原因、下一班时刻与等候策略',
    };
    rec.complaintStatus = 'closed';
    rec.complaintNote = `${resolutionText[body.resolution] || ''}；${body.note}`;
    rec.complaintHandledAt = now();
    await this.push(rec, 'service',
      `客服 ${body.agentName || ''} 办结投诉：${rec.complaintNote}`);
    await this.tryAutoClose(rec);
    return this.saveAndGet(rec);
  }

  /* ---------------- 内部工具 ---------------- */

  private async require(id: number): Promise<SkipRecord> {
    const rec = await this.repo.findOne({ where: { id } });
    if (!rec) throw new NotFoundException('跳站记录不存在');
    return rec;
  }

  private async push(rec: SkipRecord, role: string, text: string) {
    const tl = rec.timeline || [];
    tl.push({ at: now(), role, text });
    rec.timeline = tl;
  }

  private async saveAndGet(rec: SkipRecord) {
    const saved = await this.repo.save(rec);
    return this.get(saved.id);
  }

  private async tryAutoClose(rec: SkipRecord) {
    if (rec.dispatchReviewedAt && rec.complaintStatus !== 'open' && rec.complaintStatus !== 'handling') {
      rec.status = 'closed';
      rec.closedAt = now();
      await this.push(rec, 'system', '调度主管已复核且无未决投诉，跳站记录自动闭环');
    }
  }

  /** 下一班预计到达：优先取同线路在途/计划班，按车辆当前站位估算；否则按计划发车间隔 */
  private async nextEta(station: Station, excludeTripId: number, routeId: number) {
    const route = await this.routes.findOne({ where: { id: routeId } });
    const routeStations = await this.stations.find({ where: { routeId }, order: { seq: 'ASC' } });
    const seqMap = new Map(routeStations.map(s => [s.id, s.seq]));
    const here = seqMap.get(station.id) || 0;

    const candidates = (await this.trips.find({
      where: { routeId, status: In(['boarding', 'running', 'scheduled']) },
      order: { id: 'ASC' },
    })).filter(t => t.id !== excludeTripId);

    let best: { trip: Trip; minutes: number } | null = null;
    for (const t of candidates) {
      const v = await this.vehicles.findOne({ where: { id: t.vehicleId } });
      const curSeq = v?.currentStationId ? seqMap.get(v.currentStationId) : undefined;
      const minutes = curSeq != null
        ? Math.max(2, (here - curSeq) * 3)
        : (route?.intervalMinutes || 12);
      if (!best || minutes < best.minutes) best = { trip: t, minutes };
    }
    if (best) {
      return {
        tripCode: best.trip.code,
        minutes: best.minutes,
        at: new Date(Date.now() + best.minutes * 60000).toISOString(),
      };
    }
    const minutes = route?.intervalMinutes || 12;
    return {
      tripCode: '',
      minutes,
      at: new Date(Date.now() + minutes * 60000).toISOString(),
    };
  }

  private async neighborStations(station: Station) {
    const list = await this.stations.find({ where: { routeId: station.routeId }, order: { seq: 'ASC' } });
    const idx = list.findIndex(s => s.id === station.id);
    const prev = list[idx - 1]?.name || list[list.length - 1]?.name || '邻近站点';
    const next = list[idx + 1]?.name || list[0]?.name || '邻近站点';
    return { prev, next };
  }
}

// 车辆状态中文标签
function vStatus(s: string) {
  return ({ idle: '待命', running: '在运', charging: '充电中', maintenance: '维保', breakdown: '故障' } as Record<string, string>)[s] || s;
}
