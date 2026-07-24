import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

const validUser = {
  name: 'Test Cashier',
  phone: '01012345678',
  email: 'cashier@example.com',
  password: 'password123',
  role: 'cashier',
};

describe('CreateUserDto', () => {
  it('rejects an email-only user with no phone', async () => {
    const dto = plainToInstance(CreateUserDto, {
      ...validUser,
      phone: undefined,
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'phone')).toBe(true);
  });

  it('normalizes spaces in a valid Egyptian mobile number', async () => {
    const dto = plainToInstance(CreateUserDto, {
      ...validUser,
      phone: '010 1234 5678',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.phone).toBe('01012345678');
  });
});
