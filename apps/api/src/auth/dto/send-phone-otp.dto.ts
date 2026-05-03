import { IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class SendPhoneOtpDto {
  @IsString()
  @MaxLength(20)
  @Transform(({ value }) => typeof value === 'string' ? value.replace(/[\s\-()]/g, '') : value)
  @Matches(/^\+[0-9]{7,15}$/, { message: 'Phone must be in E.164 format (e.g. +97412345678)' })
  phone!: string;
}
