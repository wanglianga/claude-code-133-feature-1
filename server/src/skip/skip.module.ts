import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  SkipRecord, Trip, Vehicle, Driver, Station, RouteLine, QueueEntry,
  Ticket, Incident, Weather, RoadControl, SafetyCheck, Broadcast,
} from '../entities';
import { SkipService } from './skip.service';
import { SkipController } from './skip.controller';
import { IncidentsModule } from '../incidents/incidents.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SkipRecord, Trip, Vehicle, Driver, Station, RouteLine, QueueEntry,
      Ticket, Incident, Weather, RoadControl, SafetyCheck, Broadcast,
    ]),
    IncidentsModule,
  ],
  providers: [SkipService],
  controllers: [SkipController],
  exports: [SkipService],
})
export class SkipModule {}
