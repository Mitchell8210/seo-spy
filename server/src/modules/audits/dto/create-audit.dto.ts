import { IsIn, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAuditDto {
  @IsIn(['demo', 'homepage', 'lighthouse'])
  @ApiProperty({ enum: ['demo', 'homepage', 'lighthouse'], example: 'lighthouse', description: 'demo simulates results; homepage collects HTML; lighthouse adds Google PageSpeed Insights measurements to HTML checks.' })
  scope!: 'demo' | 'homepage' | 'lighthouse';

  @ValidateIf((body: CreateAuditDto) => body.strategy !== undefined)
  @IsIn(['mobile', 'desktop'])
  @ApiPropertyOptional({ enum: ['mobile', 'desktop'], default: 'mobile', description: 'Only supported with lighthouse scope.' })
  strategy?: 'mobile' | 'desktop';
}
