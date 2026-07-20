import { ForbiddenException } from '@nestjs/common'
import { AuthenticatedUser } from './authenticated-user'
import {
  assertBranchAccess,
  resolveBranchScope,
} from './branch-access'

describe('branch access for POS operations', () => {
  const cashier: AuthenticatedUser = {
    sub: 'cashier-1',
    role: 'cashier',
    branch_id: 'branch-a',
  }

  it('scopes a cashier list request to the cashier branch', () => {
    expect(resolveBranchScope(cashier)).toBe('branch-a')
    expect(resolveBranchScope(cashier, 'branch-a')).toBe(
      'branch-a',
    )
  })

  it('rejects a cashier request for another branch', () => {
    expect(() =>
      resolveBranchScope(cashier, 'branch-b'),
    ).toThrow(ForbiddenException)

    expect(() =>
      assertBranchAccess(cashier, 'branch-b'),
    ).toThrow(ForbiddenException)
  })

  it('allows a cashier to read records from the assigned branch', () => {
    expect(() =>
      assertBranchAccess(cashier, 'branch-a'),
    ).not.toThrow()
  })
})
