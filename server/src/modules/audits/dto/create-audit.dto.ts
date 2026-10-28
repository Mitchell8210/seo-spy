import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAuditDto {
  @IsIn(['demo', 'homepage'])
  @ApiProperty({ enum: ['demo', 'homepage'], example: 'demo', description: 'demo simulates results; homepage collects the business website HTML.' })
  scope!: 'demo' | 'homepage';
}
