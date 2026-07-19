import { IsString, Matches, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  // @Matches(/^(?:\+20|0)1[0125]\d{8}$/, { message: 'phone must be a valid Egyptian mobile number' })
  phone: string;

  @IsString()
  @MinLength(8)
  password: string;
}
