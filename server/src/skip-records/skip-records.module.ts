import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  SkipRecord, Station, Trip, Vehicle, QueueEntry, Ticket, RouteLine,
  Incident, Driver, GeofenceEvent,
} from '../entities';
import { SkipRecordsService } from './skip-records.service';
import { SkipRecordsController } from './skip-records.controller';
import { IncidentsModule } from '../incidents/incidents.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SkipRecord, Station, Trip, Vehicle, QueueEntry, Ticket, RouteLine,
      Incident, Driver, GeofenceEvent,
    ]),
    IncidentsModule,
  ],
  providers: [SkipRecordsService],
  controllers: [SkipRecordsController],
  exports: [SkipRecordsService],
})
export class SkipRecordsModule {}
