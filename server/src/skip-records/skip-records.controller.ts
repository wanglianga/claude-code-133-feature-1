import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SkipRecordsService } from './skip-records.service';

@Controller('skip-records')
export class SkipRecordsController {
  constructor(private readonly svc: SkipRecordsService) {}

  /* 各端同步查看同一条跳站记录 */
  @Get()
  list(@Query('stationId') stationId?: string,
       @Query('status') status?: string,
       @Query('complaint') complaint?: string) {
    return this.svc.list({
      stationId: stationId ? Number(stationId) : undefined,
      status, complaint,
    });
  }

  @Get('by-ticket/:ticketId')
  byTicket(@Param('ticketId') ticketId: string) {
    return this.svc.byTicket(Number(ticketId));
  }

  @Get('open')
  open() {
    return this.svc.openRecords();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(Number(id));
  }

  /* 站务补录（电子围栏漏判等） */
  @Post('station/:stationId/manual')
  manual(@Param('stationId') stationId: string, @Body() body: {
    tripId?: number; vehicleId?: number;
    onboardCount?: number; reason?: string; nextEtaMinutes?: number;
  }) {
    return this.svc.manualCreate(Number(stationId), body);
  }

  /* 站点负责人确认 */
  @Post(':id/station-confirm')
  confirm(@Param('id') id: string,
          @Body() body: { note?: string; managerName?: string }) {
    return this.svc.stationConfirm(Number(id), body);
  }

  /* 站务重新组织排队：滞留游客转回候乘 */
  @Post(':id/requeue')
  requeue(@Param('id') id: string) {
    return this.svc.requeueAffected(Number(id));
  }

  /* 站点同步等候策略 */
  @Post(':id/waiting-policy')
  policy(@Param('id') id: string, @Body() body: { policy: string }) {
    return this.svc.updateWaitingPolicy(Number(id), body.policy);
  }

  /* 调度：临时增派空车 */
  @Post(':id/dispatch-extra-vehicle')
  extra(@Param('id') id: string,
        @Body() body: { vehicleId: number; driverId: number; note?: string }) {
    return this.svc.dispatchExtraVehicle(Number(id), body);
  }

  /* 调度：调整车辆不满载离站规则（为本站预留座位） */
  @Post(':id/seat-reserve')
  reserve(@Param('id') id: string,
          @Body() body: { seats: number; note?: string }) {
    return this.svc.setSeatReserve(Number(id), body);
  }

  /* 调度主管复核 */
  @Post(':id/dispatch-review')
  review(@Param('id') id: string,
         @Body() body: { note?: string; reviewerName?: string }) {
    return this.svc.dispatchReview(Number(id), body);
  }

  @Post(':id/close')
  close(@Param('id') id: string, @Body() body: { note?: string }) {
    return this.svc.close(Number(id), body.note);
  }

  /* 游客：就本次跳站发起投诉/咨询（客服用同一记录处理） */
  @Post(':id/complaint')
  complaint(@Param('id') id: string, @Body() body: {
    ticketId?: number; visitorName?: string; note: string;
  }) {
    return this.svc.openComplaint(Number(id), body);
  }

  /* 客服：办结投诉 */
  @Post(':id/complaint/handle')
  handleComplaint(@Param('id') id: string, @Body() body: {
    note: string;
    resolution: 'compensation' | 'transfer' | 'refund_guide' | 'explain';
    agentName?: string;
  }) {
    return this.svc.handleComplaint(Number(id), body);
  }
}
