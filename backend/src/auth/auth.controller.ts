import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}
  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) { return this.auth.login(dto.phone, dto.password); }
  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) { return this.auth.refresh(dto.refresh_token); }
  @Public()
  @Post('logout')
  logout(@Body() dto: RefreshTokenDto) { return this.auth.logout(dto.refresh_token); }
}
