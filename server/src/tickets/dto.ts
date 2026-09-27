import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class BuyTicketDto {
  @IsIn(['single', 'loop', 'parent_child', 'accessible_priority'])
  type: 'single' | 'loop' | 'parent_child' | 'accessible_priority';

  @IsString() visitorName: string;
  @IsOptional() @IsString() phone?: string;

  @IsInt() @Min(1) originStationId: number;
  @IsInt() @Min(1) destStationId: number;

  @IsOptional() @IsInt() @Min(1) partySize?: number;
  @IsOptional() @IsBoolean() hasStroller?: boolean;
  @IsOptional() @IsBoolean() hasElder?: boolean;
  @IsOptional() @IsBoolean() hasChild?: boolean;
  @IsOptional() @IsBoolean() needWheelchair?: boolean;
  @IsOptional() @IsString() plannedRoute?: string;
}

export class RefundRequestDto {
  @IsString() reason: string;
  @IsOptional() @IsIn(['visitor', 'storm', 'vehicle', 'schedule', 'other'])
  faultTag?: 'visitor' | 'storm' | 'vehicle' | 'schedule' | 'other';
  @IsOptional() @IsString() applicantRole?: 'visitor' | 'staff' | 'system';
}
