import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Station, RouteLine, QueueEntry, Ticket, Trip, Vehicle, Weather,
  Broadcast, RoadControl, GeofenceEvent, Incident, SkipRecord,
} from '../entities';
import { StationsService } from './stations.service';
import { StationsController } from './stations.controller';
import { IncidentsModule } from '../incidents/incidents.module';
import { SkipModule } from '../skip/skip.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Station, RouteLine, QueueEntry, Ticket, Trip, Vehicle, Weather,
      Broadcast, RoadControl, GeofenceEvent, Incident, SkipRecord,
    ]),
    IncidentsModule,
    SkipModule,
  ],
  providers: [StationsService],
  controllers: [StationsController],
  exports: [StationsService],
})
export class StationsModule {}
