import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { toFriendlyError } from './api-error.filter';

describe('friendly API errors', () => {
  it('maps login failures to a safe actionable message', () => {
    expect(toFriendlyError(new UnauthorizedException('Invalid credentials'))).toMatchObject({
      status: 401,
      code: 'LOGIN_INVALID',
      field: 'phone',
      message_ar: expect.stringContaining('غير صحيحة'),
    });
  });

  it('preserves validation details and identifies the field', () => {
    const error = toFriendlyError(new BadRequestException({
      message: ['name must be longer than or equal to 2 characters'],
    }));
    expect(error).toMatchObject({ code: 'VALIDATION_ERROR', field: 'name' });
    expect(error.details).toHaveLength(1);
  });

  it('explains stock conflicts without exposing a stack trace', () => {
    expect(toFriendlyError(new ConflictException('Insufficient stock for variant secret-id'))).toMatchObject({
      status: 409,
      code: 'INSUFFICIENT_STOCK',
      message_ar: expect.stringContaining('الكمية'),
    });
  });
});
