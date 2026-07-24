import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { UsersService } from './users.service';

describe('UsersService', () => {
  const create = jest.fn();
  const service = new UsersService({
    user: { create },
  } as any);

  beforeEach(() => {
    create.mockReset();
  });

  it('rejects a user without a phone before hashing or persistence', async () => {
    await expect(service.create({
      name: 'Email Only',
      email: 'email-only@example.com',
      password: 'password123',
      role: Role.cashier,
    } as any)).rejects.toBeInstanceOf(BadRequestException);

    expect(create).not.toHaveBeenCalled();
  });

  it('normalizes the phone before persistence', async () => {
    create.mockResolvedValue({ id: 'user-id' });

    await service.create({
      name: 'Cashier',
      phone: '010 1234 5678',
      password: 'password123',
      role: Role.cashier,
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        phone: '01012345678',
      }),
    }));
  });
});
