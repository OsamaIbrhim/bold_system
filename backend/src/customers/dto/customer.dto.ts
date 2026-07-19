import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateCustomerDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @Matches(/^(?:\+20|0)1[0125]\d{8}$/, { message: 'phone must be a valid Egyptian mobile number' })
  phone: string;

  @IsOptional()
  @Matches(/^(?:\+20|0)1[0125]\d{8}$/)
  whatsapp?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @Matches(/^(?:\+20|0)1[0125]\d{8}$/)
  phone?: string;

  @IsOptional()
  @Matches(/^(?:\+20|0)1[0125]\d{8}$/)
  whatsapp?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

export class SetCustomerVipDto {
  @IsBoolean()
  is_vip: boolean;

  @IsOptional()
  @IsIn(['cost_plus_overhead'])
  vip_price_tier?: string;
}
