import { Body, Controller, Get, Param, Post, Patch, Query } from '@nestjs/common';
import { Station } from '../entities';
import { StationsService } from './stations.service';

@Controller()
export class StationsController {
  constructor(private readonly svc: StationsService) {}

  @Get('overview')
  overview() {
    return this.svc.overview();
  }

  @Get('routes')
  routes() {
    return this.svc.listRoutes();
  }

  @Get('stations/:id/board')
  board(@Param('id') id: string) {
    return this.svc.board(Number(id));
  }

  @Post('stations/:id/enqueue')
  enqueue(@Param('id') id: string, @Body() body: { ticketCode: string }) {
    return this.svc.enqueue(Number(id), body.ticketCode);
  }

  @Post('stations/:id/board-next')
  boardNext(@Param('id') id: string, @Body() body: { tripId: number }) {
    return this.svc.boardNext(Number(id), Number(body.tripId));
  }

  @Post('queue/:entryId/board')
  boardEntry(@Param('entryId') entryId: string,
             @Body() body: { tripId: number; force?: boolean }) {
    return this.svc.boardEntry(Number(entryId), Number(body.tripId), { force: !!body.force });
  }

  @Post('queue/:entryId/leave')
  leave(@Param('entryId') entryId: string) {
    return this.svc.leaveQueue(Number(entryId));
  }

  @Post('queue/:entryId/dispute')
  dispute(@Param('entryId') entryId: string, @Body() body: { detail: string }) {
    return this.svc.raisePriorityDispute(Number(entryId), body.detail);
  }

  @Post('broadcasts')
  broadcast(@Body() body: { stationId?: number; content: string; spokenByRole?: string }) {
    return this.svc.broadcast(body.stationId ?? 0, body.content, body.spokenByRole || 'staff');
  }

  @Get('broadcasts')
  listBroadcasts(@Query('stationId') stationId?: string) {
    return this.svc.listBroadcasts(stationId ? Number(stationId) : undefined);
  }

  @Patch('stations/:id')
  updateStation(@Param('id') id: string,
                @Body() patch: { flowLimitPerHour?: number; status?: Station['status']; isHot?: boolean }) {
    return this.svc.updateStation(Number(id), patch);
  }
}
