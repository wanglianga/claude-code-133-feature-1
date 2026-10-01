import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Refund, Ticket, Incident, Trip } from '../entities';
import { ServiceService } from './service.service';
import { ServiceController } from './service.controller';
import { IncidentsModule } from '../incidents/incidents.module';
import { SkipRecordsModule } from '../skip-records/skip-records.module';

@Module({
  imports: [TypeOrmModule.forFeature([Refund, Ticket, Incident, Trip]), IncidentsModule, SkipRecordsModule],
  providers: [ServiceService],
  controllers: [ServiceController],
})
export class ServiceModule {}
