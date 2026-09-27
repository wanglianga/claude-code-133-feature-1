import { Controller, Get } from '@nestjs/common';
import { OpsService } from './ops.service';

@Controller('ops')
export class OpsController {
  constructor(private readonly svc: OpsService) {}

  @Get('report')
  report() {
    return this.svc.report();
  }
}
