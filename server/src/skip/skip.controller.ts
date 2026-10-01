import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SkipService } from './skip.service';

@Controller()
export class SkipController {
  constructor(private readonly svc: SkipService) {}

  /* 跳站记录列表（站务/调度/客服/运营共用） */
  @Get('skip-records')
  list(@Query('stationId') stationId?: string,
       @Query('status') status?: string,
       @Query('open') open?: string) {
    return this.svc.list({
      stationId: stationId ? Number(stationId) : undefined,
      status,
      open: open === 'true' || open === '1',
    });
  }

  @Get('skip-records/:id')
  get(@Param('id') id: string) {
    return this.svc.get(Number(id));
  }

  /* 站点端：同步等候策略 */
  @Post('skip-records/:id/wait-policy')
  waitPolicy(@Param('id') id: string, @Body() body: { waitPolicy: string; leaderName?: string }) {
    return this.svc.syncWaitPolicy(Number(id), body);
  }

  /* 站点端：站点负责人确认 */
  @Post('skip-records/:id/confirm')
  confirm(@Param('id') id: string,
          @Body() body: { leaderName: string; note?: string; waitPolicy?: string }) {
    return this.svc.confirm(Number(id), body);
  }

  /* 站点端：跳站游客转回排队（下一班到站也会自动转回） */
  @Post('skip-records/:id/restore-queue')
  restore(@Param('id') id: string) {
    return this.svc.restoreQueue(Number(id));
  }

  /* 调度端：临时增派空车 */
  @Post('skip-records/:id/dispatch-extra')
  extra(@Param('id') id: string,
        @Body() body: { vehicleId: number; driverId: number; note?: string }) {
    return this.svc.dispatchExtra(Number(id), body);
  }

  /* 调度端：调整车辆不满载离站规则 */
  @Post('skip-records/:id/rule')
  rule(@Param('id') id: string,
       @Body() body: { rule: 'full_load_skip' | 'reserve_seats'; reserveSeats?: number; note?: string }) {
    return this.svc.adjustRule(Number(id), body);
  }

  /* 调度端：调度主管复核 */
  @Post('skip-records/:id/review')
  review(@Param('id') id: string,
         @Body() body: { reviewer: string; note: string }) {
    return this.svc.review(Number(id), body);
  }

  /* 客服端：基于同一记录登记投诉 / 处理投诉 */
  @Post('skip-records/:id/complaint')
  complaint(@Param('id') id: string,
            @Body() body: { visitorName: string; content: string }) {
    return this.svc.addComplaint(Number(id), body);
  }

  @Post('skip-records/:id/complaint-resolve')
  complaintResolve(@Param('id') id: string, @Body() body: { note: string }) {
    return this.svc.resolveComplaint(Number(id), body);
  }
}
