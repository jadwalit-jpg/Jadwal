import { IsString, IsOptional, IsNotEmpty } from 'class-validator';

export class Pay2mCallbackDto {
  @IsString()
  @IsNotEmpty()
  err_code!: string;

  @IsOptional()
  @IsString()
  err_msg?: string;

  @IsString()
  @IsNotEmpty()
  basket_id!: string;

  @IsOptional()
  @IsString()
  order_date?: string;

  @IsOptional()
  @IsString()
  transaction_id?: string;

  @IsString()
  @IsNotEmpty()
  Response_Key!: string;

  @IsOptional()
  @IsString()
  PaymentName?: string;

  // Extra fields PAY2M may send — accept but ignore
  @IsOptional()
  @IsString()
  Rdv_Message_Key?: string;
}
