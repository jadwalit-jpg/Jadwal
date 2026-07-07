import { IsString, IsOptional, MaxLength, ValidateNested, Matches } from 'class-validator';
import { Type } from 'class-transformer';
import {
  BUSINESS_NAME_EN_REGEX, BUSINESS_NAME_EN_MESSAGE,
  BUSINESS_NAME_AR_REGEX, BUSINESS_NAME_AR_MESSAGE,
} from '../../common/validators/name-allowlist';

export class BankDetailsDto {
  @IsString()
  @MaxLength(100)
  bankName!: string;

  @IsString()
  @MaxLength(100)
  accountHolder!: string;

  @IsString()
  @MaxLength(34)
  @Matches(/^[A-Z]{2}\d{2}[A-Z0-9]{4,30}$/, { message: 'IBAN must be a valid format (e.g., QA58DOHB00001234567890ABCDEFG)' })
  iban!: string;
}

export class UpdateVendorSettingsDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  @Matches(BUSINESS_NAME_EN_REGEX, { message: BUSINESS_NAME_EN_MESSAGE })
  businessNameEn?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  @Matches(BUSINESS_NAME_AR_REGEX, { message: BUSINESS_NAME_AR_MESSAGE })
  businessNameAr?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  descriptionEn?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  descriptionAr?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  phone?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  whatsapp?: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  website?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BankDetailsDto)
  bankDetails?: BankDetailsDto;
}
