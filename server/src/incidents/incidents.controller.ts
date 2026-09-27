import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { IncidentsService } from './incidents.service';

@Controller('incidents')
export class IncidentsController {
  constructor(private readonly svc: IncidentsService) {}

  @Get()
  list(@Query('status') status?: string,
       @Query('type') type?: string,
       @Query('ticketId') ticketId?: string,
       @Query('tripId') tripId?: string) {
    return this.svc.list({
      status, type,
      ticketId: ticketId ? Number(ticketId) : undefined,
      tripId: tripId ? Number(tripId) : undefined,
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(Number(id));
  }

  @Post(':id/notes')
  note(@Param('id') id: string, @Body() body: { role: string; text: string }) {
    return this.svc.addNote(Number(id), body.role, body.text);
  }

  @Post(':id/resolve')
  resolve(@Param('id') id: string,
          @Body() body: { role: string; resolution: string }) {
    return this.svc.update(Number(id),
      { status: 'resolved', resolution: body.resolution },
      { role: body.role, text: `处理完成：${body.resolution}` });
  }
}
