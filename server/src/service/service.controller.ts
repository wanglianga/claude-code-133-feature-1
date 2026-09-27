import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ServiceService } from './service.service';

@Controller()
export class ServiceController {
  constructor(private readonly svc: ServiceService) {}

  @Get('service/workbench')
  workbench() {
    return this.svc.workbench();
  }

  @Post('refunds/:id/approve')
  approve(@Param('id') id: string, @Body() body: { note: string }) {
    return this.svc.approve(Number(id), body.note);
  }

  @Post('refunds/:id/reject')
  reject(@Param('id') id: string, @Body() body: { note: string }) {
    return this.svc.reject(Number(id), body.note);
  }

  @Post('refunds/:id/escalate')
  escalate(@Param('id') id: string, @Body() body: { note: string }) {
    return this.svc.escalate(Number(id), body.note);
  }

  @Post('refunds/:id/supervisor-decide')
  supervisor(@Param('id') id: string,
             @Body() body: { approve: boolean; note: string }) {
    return this.svc.supervisorDecide(Number(id), body);
  }

  @Post('refunds/:id/pay')
  pay(@Param('id') id: string, @Body() body: { note?: string }) {
    return this.svc.pay(Number(id), body.note);
  }

  @Post('incidents/:id/take')
  take(@Param('id') id: string, @Body() body: { role: 'service' | 'dispatch' | 'staff' }) {
    return this.svc.takeIncident(Number(id), body.role);
  }
}
