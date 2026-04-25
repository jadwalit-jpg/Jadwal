import { IsString, IsOptional, MaxLength, ValidateNested, Matches } from 'class-validator';
import { Type } from 'class-transformer';

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
  businessNameEn?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
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
